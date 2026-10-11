import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, cacheKey, type KVLike } from '../src/worker/index.ts';
import { createEdgeRouter } from '../src/worker/router.ts';
import { artworkFinder, sameTitle } from '../src/providers/artwork.ts';

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const TOKEN = 'eyJSECRETtmdbTOKEN1234567890';
const ORIGIN = 'https://saitejavoonna.github.io';
const req = (path: string, headers: Record<string, string> = {}, method = 'GET') => new Request(`https://mmde-api.example.workers.dev${path}`, { method, headers });
const memoryKv = (): KVLike & { store: Map<string, string> } => { const store = new Map<string, string>(); return { store, get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } }; };
const ctx = () => { const pending: Promise<unknown>[] = []; return { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, done: () => Promise.all(pending) }; };

test('CORS: only the listed origin may call; preflight answers; unknown origin is refused before any work', async () => {
  let upstream = 0;
  const w = createWorker({ fetchImpl: (async () => { upstream++; return json({}); }) as typeof fetch });
  const env = { MMDE_WEB_ORIGIN: ORIGIN };
  const ok = await w.fetch(req('/api/health', { origin: ORIGIN }), env);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(ok.headers.get('vary'), 'Origin');
  const pre = await w.fetch(req('/api/search', { origin: ORIGIN }, 'OPTIONS'), env);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods') ?? '', /GET/);
  const evil = await w.fetch(req('/api/search?q=x', { origin: 'https://evil.example' }), env);
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.equal(upstream, 0, 'a refused origin must not trigger upstream calls');
  // No Origin header (curl, health checks) is fine.
  assert.equal((await w.fetch(req('/api/health'), env)).status, 200);
});

test('only GET is served; non-API paths are 404; security headers are set', async () => {
  const w = createWorker({ fetchImpl: (async () => json({})) as typeof fetch });
  assert.equal((await w.fetch(req('/api/search?q=a', {}, 'POST'), {})).status, 405);
  const nf = await w.fetch(req('/index.html'), {});
  assert.equal(nf.status, 404);
  const h = await w.fetch(req('/api/health'), {});
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(h.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(h.headers.get('cache-control'), 'no-store');
});

test('the TMDB token reaches only TMDB and never appears in any response or error', async () => {
  const sent: Array<{ host: string; auth: string | null }> = [];
  const fakeFetch = (async (u: string | URL, init?: RequestInit) => {
    const url = new URL(String(u));
    const headers = new Headers(init?.headers);
    sent.push({ host: url.host, auth: headers.get('authorization') });
    if (url.host === 'api.themoviedb.org') return new Response(`denied for ${TOKEN}`, { status: 401 });
    return json({ data: { Page: { media: [] } }, search: [], query: { pages: [] } });
  }) as typeof fetch;
  const w = createWorker({ fetchImpl: fakeFetch });
  const env = { TMDB_READ_ACCESS_TOKEN: TOKEN };
  for (const path of ['/api/health', '/api/search?q=rrr', '/api/details/tmdb-movie-1', '/api/seasons/tmdb-tv-1', '/api/trending']) {
    const res = await w.fetch(req(path), env);
    const text = await res.text();
    assert.ok(!text.includes(TOKEN), `${path} leaked the token`);
    for (const [k, v] of res.headers) assert.ok(!v.includes(TOKEN), `${path} leaked the token in header ${k}`);
  }
  for (const s of sent) if (s.host !== 'api.themoviedb.org') assert.ok(!s.auth || !s.auth.includes(TOKEN), `token sent to ${s.host}`);
  assert.ok(sent.some((s) => s.host === 'api.themoviedb.org' && s.auth === `Bearer ${TOKEN}`), 'TMDB should get the bearer token');
});

test('upstream error text containing the credential is redacted', async () => {
  const router = createEdgeRouter({ tmdbToken: TOKEN, userAgent: 'test', fetchImpl: (async () => { throw new Error(`socket hang up for ${TOKEN}`); }) as typeof fetch });
  const a = await router.handle('/api/details/tmdb-movie-5');
  assert.equal(a.status, 502);
  assert.ok(!JSON.stringify(a.body).includes(TOKEN));
  assert.match(JSON.stringify(a.body), /redacted/);
});

test('input validation: bad ids, short titles and unknown routes get clear 4xx answers', async () => {
  const router = createEdgeRouter({ userAgent: 'test', fetchImpl: (async () => json({})) as typeof fetch });
  assert.equal((await router.handle('/api/details/not-an-id')).status, 400);
  assert.equal((await router.handle('/api/details/tmdb-movie-abc')).status, 400);
  assert.equal((await router.handle('/api/details/tmdb-movie-1')).status, 503, 'TMDB ids need the token');
  assert.equal((await router.handle('/api/seasons/tmdb-tv-1')).status, 503);
  assert.equal((await router.handle('/api/soundtrack-merged?title=a')).status, 400);
  assert.equal((await router.handle('/api/deezer-isrc?id=abc')).status, 400);
  assert.equal((await router.handle('/api/album-tracks?platform=spotify&id=1')).status, 400);
  assert.equal((await router.handle('/api/artwork?title=x')).status, 400);
  assert.equal((await router.handle('/api/nope')).status, 404);
  assert.equal((await router.handle(`/api/search?q=${'x'.repeat(200)}`)).status, 400);
});

test('rate limits: per client, heavy lookups stricter, health exempt, 429 carries Retry-After and CORS', async () => {
  const w = createWorker({ fetchImpl: (async () => json({})) as typeof fetch, limits: { general: 5, heavy: 2 } });
  const env = { MMDE_WEB_ORIGIN: ORIGIN };
  const as = (ip: string, path: string) => w.fetch(req(path, { 'cf-connecting-ip': ip, origin: ORIGIN }), env);
  assert.equal((await as('1.1.1.1', '/api/albums?title=Fire Force')).status, 200);
  assert.equal((await as('1.1.1.1', '/api/albums?title=Fire Force')).status, 200);
  const third = await as('1.1.1.1', '/api/albums?title=Fire Force');
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get('retry-after')) >= 1);
  assert.equal(third.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal((await as('2.2.2.2', '/api/albums?title=Fire Force')).status, 200, 'another client is unaffected');
  for (let i = 0; i < 20; i++) assert.equal((await as('3.3.3.3', '/api/health')).status, 200, 'health is never limited');
});

test('shared cache: a repeated lookup is served from KV without calling upstream; fresh=1 and errors bypass it', async () => {
  let upstream = 0;
  const fakeFetch = (async (u: string | URL) => {
    upstream++;
    const url = new URL(String(u));
    if (url.host === 'itunes.apple.com') return json({ results: [{ collectionId: 7, collectionName: 'Fire Force (Original Soundtrack)', artistName: 'Someone', artworkUrl100: 'https://is1.example/100x100bb.jpg', collectionViewUrl: 'https://music.apple.com/x', trackCount: 10, releaseDate: '2019-07-01T07:00:00Z' }] });
    return json({ results: [], search: [], query: { pages: [] }, data: [] });
  }) as typeof fetch;
  const kv = memoryKv();
  const w = createWorker({ fetchImpl: fakeFetch });
  const c1 = ctx();
  const first = await w.fetch(req('/api/albums?title=Fire%20Force&year=2019'), { CACHE: kv }, c1);
  await c1.done();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-mmde-cache'), 'miss');
  const afterFirst = upstream;
  assert.ok(afterFirst > 0 && kv.store.size === 1);
  const second = await w.fetch(req('/api/albums?year=2019&title=Fire%20Force'), { CACHE: kv }, ctx());
  assert.equal(second.headers.get('x-mmde-cache'), 'hit', 'query order must not matter');
  assert.equal(upstream, afterFirst, 'no upstream call on a hit');
  assert.deepEqual(await second.json(), await (await w.fetch(req('/api/albums?title=Fire%20Force&year=2019'), { CACHE: kv }, ctx())).json());
  const skipped = await w.fetch(req('/api/albums?title=Fire%20Force&year=2019&fresh=1'), { CACHE: kv }, ctx());
  assert.equal(skipped.headers.get('x-mmde-cache'), 'miss', 'fresh=1 skips the shared cache');
  // Errors are never stored.
  const bad = await w.fetch(req('/api/albums?title=x'), { CACHE: kv }, ctx());
  assert.equal(bad.status, 400);
  assert.equal(kv.store.size, 1);
  assert.equal(cacheKey(new URL('https://x/api/a?b=2&a=1&fresh=1')), cacheKey(new URL('https://x/api/a?a=1&b=2')));
});

test('a broken KV never breaks the API', async () => {
  const broken: KVLike = { get: async () => { throw new Error('kv down'); }, put: async () => { throw new Error('kv down'); } };
  const w = createWorker({ fetchImpl: (async () => json({ results: [] })) as typeof fetch });
  const c = ctx();
  const res = await w.fetch(req('/api/albums?title=Fire%20Force'), { CACHE: broken }, c);
  await c.done();
  assert.equal(res.status, 200);
});

test('no TMDB token: search falls back to keyless sources and still answers', async () => {
  const fakeFetch = (async (u: string | URL) => {
    const url = new URL(String(u));
    if (url.host === 'www.wikidata.org') return json({ search: [{ id: 'Q60', label: 'RRR', description: '2022 film directed by S. S. Rajamouli' }] });
    if (url.host === 'en.wikipedia.org') return json({ query: { pages: [] } });
    return json({ data: { Page: { media: [] } } });
  }) as typeof fetch;
  const w = createWorker({ fetchImpl: fakeFetch });
  const res = await w.fetch(req('/api/search?q=rrr'), {});
  assert.equal(res.status, 200);
  const body = await res.json() as { results: Array<{ id: string; title: string }>; sources: string[] };
  assert.ok(body.results.some((r) => r.id === 'wd-Q60'));
  assert.ok(!body.sources.includes('tmdb'));
  assert.equal(((await (await w.fetch(req('/api/health'), {})).json()) as { tmdb: boolean }).tmdb, false);
});

// ---- artwork fallback chain ----
const art = (extra: Record<string, (url: URL, init?: RequestInit) => Response | undefined>) => artworkFinder('test', (async (u: string | URL, init?: RequestInit) => {
  const url = new URL(String(u));
  const r = extra[url.host]?.(url, init);
  return r ?? json(url.host === 'itunes.apple.com' ? { results: [] } : url.host === 'graphql.anilist.co' ? { data: { Page: { media: [] } } } : url.host === 'api.tvmaze.com' ? [] : { query: { pages: [] } });
}) as typeof fetch);

test('title matching ignores accents, punctuation and "(2022 film)" qualifiers but not other titles', () => {
  assert.ok(sameTitle('Bāhubali', 'Baahubali'));
  assert.ok(sameTitle('RRR (2022 film)', 'RRR'));
  assert.ok(sameTitle('Fire Force', 'fire-force'));
  assert.ok(!sameTitle('Kingdom', 'Kingdom of Heaven'));
  assert.ok(!sameTitle('Pushpa 2: The Rule', 'Pushpa: The Rise'));
});

test('artwork: anime uses the AniList cover; a wrong year or different title is rejected', async () => {
  const media = (title: string, year: number) => json({ data: { Page: { media: [{ id: 1, title: { romaji: title, english: title }, synonyms: [], startDate: { year }, seasonYear: year, coverImage: { large: 'https://s4.anilist.example/c.jpg' } }] } } });
  const ok = await art({ 'graphql.anilist.co': () => media('Fire Force', 2019) }).find({ title: 'Fire Force', year: 2019, anime: true });
  assert.deepEqual([ok?.source, ok?.kind, ok?.url], ['anilist', 'poster', 'https://s4.anilist.example/c.jpg']);
  assert.equal(await art({ 'graphql.anilist.co': () => media('Fire Force', 2005) }).find({ title: 'Fire Force', year: 2019, anime: true }), null, 'year too far off');
  assert.equal(await art({ 'graphql.anilist.co': () => media('Fire Brigade', 2019) }).find({ title: 'Fire Force', year: 2019, anime: true }), null, 'different title');
});

test('artwork: TV falls to TVmaze (year-checked); a movie skips TVmaze', async () => {
  const show = (name: string, premiered: string) => json([{ show: { name, premiered, image: { medium: 'https://static.tvmaze.example/m.jpg', original: 'https://static.tvmaze.example/o.jpg' } } }]);
  const tv = await art({ 'api.tvmaze.com': () => show('The Mandalorian', '2019-11-12') }).find({ title: 'The Mandalorian', year: 2019, type: 'tv' });
  assert.deepEqual([tv?.source, tv?.url], ['tvmaze', 'https://static.tvmaze.example/o.jpg']);
  assert.equal(await art({ 'api.tvmaze.com': () => show('The Mandalorian', '1999-01-01') }).find({ title: 'The Mandalorian', year: 2019, type: 'tv' }), null);
  assert.equal(await art({ 'api.tvmaze.com': () => show('RRR', '2022-01-01') }).find({ title: 'RRR', year: 2022, type: 'movie' }), null, 'movies never use TVmaze');
});

test('artwork: Wikipedia lead image is used only for a page with the same title', async () => {
  const pages = (title: string) => json({ query: { pages: [{ title, index: 1, thumbnail: { source: 'https://upload.example/t.jpg' } }] } });
  assert.equal((await art({ 'en.wikipedia.org': () => pages('RRR (film)') }).find({ title: 'RRR', year: 2022, type: 'movie' }))?.source, 'wikipedia');
  assert.equal(await art({ 'en.wikipedia.org': () => pages('RRR (disambiguation)') }).find({ title: 'RRR', year: 2022, type: 'movie' }), null);
});

test('artwork: last resort is the soundtrack album cover, labelled as an album and resized; unrelated albums are ignored', async () => {
  const apple = (name: string) => json({ results: [{ collectionId: 9, collectionName: name, artistName: 'Thaman S', artworkUrl100: 'https://is1.example/img/100x100bb.jpg', collectionViewUrl: 'https://music.apple.com/a', trackCount: 40, releaseDate: '2025-11-16T07:00:00Z' }] });
  const hit = await art({ 'itunes.apple.com': () => apple('They Call Him OG (Original Background Score)') }).find({ title: 'They Call Him OG', year: 2025, type: 'movie' });
  assert.equal(hit?.source, 'apple-album');
  assert.equal(hit?.kind, 'album', 'never presented as a poster');
  assert.match(hit?.url ?? '', /\/600x600bb\.jpg$/);
  assert.equal(await art({ 'itunes.apple.com': () => apple('Greatest Hits 2025') }).find({ title: 'They Call Him OG', year: 2025, type: 'movie' }), null);
});

test('artwork: one failing source does not stop the chain, and "nothing found" is cached only briefly', async () => {
  const finder = art({ 'graphql.anilist.co': () => new Response('boom', { status: 500 }), 'api.tvmaze.com': () => new Response('boom', { status: 503 }), 'itunes.apple.com': () => json({ results: [{ collectionId: 3, collectionName: 'Fire Force Soundtrack', artistName: 'X', artworkUrl100: 'https://is1.example/100x100bb.jpg', collectionViewUrl: 'https://music.apple.com/b', trackCount: 5, releaseDate: '2019-07-01T00:00:00Z' }] }) });
  assert.equal((await finder.find({ title: 'Fire Force', year: 2019, anime: true, type: 'tv' }))?.source, 'apple-album');
  const router = createEdgeRouter({ userAgent: 'test', fetchImpl: (async () => json({ results: [], query: { pages: [] }, data: { Page: { media: [] } } })) as typeof fetch });
  const miss = await router.handle('/api/artwork?title=Nothing%20Here&year=2020');
  assert.deepEqual([miss.status, miss.cache, (miss.body as { artwork: unknown }).artwork], [200, 'short', null]);
});

test('every outgoing call carries our User-Agent (the Workers runtime sends none, and Wikimedia rejects that)', async () => {
  const seen: Array<{ host: string; ua: string | null }> = [];
  const router = createEdgeRouter({ userAgent: 'MMDE/test (contact@example.com)', fetchImpl: (async (u: string | URL, init?: RequestInit) => {
    seen.push({ host: new URL(String(u)).host, ua: new Headers(init?.headers).get('user-agent') });
    return json({ search: [], query: { pages: [] }, data: { Page: { media: [] } } });
  }) as typeof fetch });
  await router.handle('/api/search?q=rrr');
  assert.ok(seen.some((s) => s.host === 'www.wikidata.org') && seen.some((s) => s.host === 'en.wikipedia.org'));
  for (const s of seen) assert.equal(s.ua, 'MMDE/test (contact@example.com)', `${s.host} must get our User-Agent`);
});

// ---- Apple storefront fallback ----
import { catalogResolver } from '../src/providers/catalogAlbums.ts';
const ogAlbum = { collectionId: 111, collectionName: 'They Call Him OG (Original Background Score)', artistName: 'Thaman S', artworkUrl100: 'https://is1.example/100x100bb.jpg', collectionViewUrl: 'https://music.apple.com/in/album/x/111', trackCount: 40, releaseDate: '2025-11-16T00:00:00Z' };
const appleFake = (inStore: boolean, log: string[]) => (async (u: string | URL) => {
  const url = new URL(String(u)); log.push(url.host + url.pathname + '?' + url.searchParams.toString());
  if (url.host === 'itunes.apple.com' && url.pathname === '/search') return json({ results: url.searchParams.get('country') === 'in' && inStore ? [ogAlbum] : [] });
  if (url.host === 'itunes.apple.com' && url.pathname === '/lookup') return json({ results: url.searchParams.get('country') === 'in' ? [{ wrapperType: 'track', collectionId: 111, trackNumber: 1, trackName: 'Firestorm', artistName: 'Thaman S', trackViewUrl: 'https://music.apple.com/in/song/1', trackId: 1, trackTimeMillis: 180000 }] : [] });
  return json({ data: [], results: [] });
}) as typeof fetch;

test('Apple store fallback: a title missing from the default store is found in the India store, and its songs are fetched from that same store', async () => {
  const log: string[] = [];
  const c = catalogResolver('test', appleFake(true, log), { deezer: false });
  const albums = await c.findAlbums('They Call Him OG', 2025);
  const og = albums.find((a) => a.platform === 'apple');
  assert.equal(og?.country, 'in');
  const tracks = await c.tracks('apple', og!.id, og!.country);
  assert.equal(tracks.length, 1);
  assert.ok(log.some((l) => l.startsWith('itunes.apple.com/lookup') && l.includes('country=in')), 'the lookup must use the same store');
  await assert.rejects(c.tracks('apple', '111', 'USA'), /invalid store/);
});

test('Apple store fallback costs nothing when the default store already has the album, and gives up quietly when no store does', async () => {
  const log: string[] = [];
  const hit = catalogResolver('test', (async (u: string | URL) => {
    const url = new URL(String(u)); log.push(url.search);
    return json(url.host === 'itunes.apple.com' ? { results: [ogAlbum] } : { data: [], results: [] });
  }) as typeof fetch, { deezer: false });
  const a = await hit.findAlbums('They Call Him OG', 2025);
  assert.equal(a[0]?.country, undefined, 'default store: no country recorded');
  assert.ok(!log.some((l) => l.includes('country=')), 'no extra store searched');
  const none = catalogResolver('test', appleFake(false, []), { deezer: false });
  assert.deepEqual((await none.findAlbums('Nothing Here Film', 2020)).filter((x) => x.platform === 'apple'), []);
});

import { isFilmAlbum } from '../src/providers/catalogAlbums.ts';
test('album matching: repeated-letter titles like "RRR" match their albums as whole words only; 2-letter titles still match nothing', () => {
  assert.ok(isFilmAlbum('RRR', 'RRR (Telugu) [Original Motion Picture Soundtrack]'));
  assert.ok(isFilmAlbum('RRR', 'RRR - Hindi'));
  assert.ok(!isFilmAlbum('RRR', 'Rrrrrr Greatest Hits'));
  assert.ok(!isFilmAlbum('RRR', 'Barrrr Songs'));
  assert.ok(!isFilmAlbum('OG', 'Kanye OG Mix'), '2-letter titles are too ambiguous');
  assert.ok(isFilmAlbum('Bāhubali', 'Baahubali 2 (Telugu)'), 'the old accent/doubled-letter tolerance is unchanged');
});
