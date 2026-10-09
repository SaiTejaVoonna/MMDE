import test from 'node:test';
import assert from 'node:assert/strict';
import { keylessTitles } from '../src/providers/keylessTitles.ts';
import { createStaticApi } from '../src/browser/staticApi.ts';

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const sawHeaders: string[] = [];

const aniNode = (id: number, title: string, year: number, extra: Record<string, unknown> = {}) => ({ id, format: 'TV', episodes: 24, title: { romaji: title, english: null, native: `${title}-jp` }, synonyms: [], startDate: { year, month: 7, day: 6 }, seasonYear: year, coverImage: { large: `https://img.example/${id}.jpg`, extraLarge: `https://img.example/${id}-xl.jpg` }, description: 'A <b>fire</b> story.<br>Second line.', genres: ['Action'], popularity: 100, relations: { edges: [] as unknown[] }, ...extra });
const fake = (async (u: string | URL, init?: RequestInit) => {
  const url = new URL(String(u));
  for (const k of Object.keys((init?.headers as Record<string, string>) ?? {})) sawHeaders.push(k.toLowerCase());
  if (url.host === 'graphql.anilist.co') {
    const body = JSON.parse(String(init?.body));
    if (/Page\(perPage:10\)/.test(body.query)) return json({ data: { Page: { media: !/fire/i.test(String(body.variables.q)) ? [] : [aniNode(1, 'Fire Force', 2019), aniNode(2, 'Fire Force 2', 2020, { relations: { edges: [{ relationType: 'PREQUEL' }] } })] } } });
    if (/Page\(perPage:20\)/.test(body.query)) return json({ data: { Page: { media: [aniNode(1, 'Fire Force', 2019)] } } });
    const id = body.variables.id as number;
    if (id === 1) return json({ data: { Media: aniNode(1, 'Fire Force', 2019, { relations: { edges: [{ relationType: 'SEQUEL', node: { id: 2, type: 'ANIME', format: 'TV', title: { romaji: 'Fire Force 2' }, episodes: 24, startDate: { year: 2020, month: 7, day: 3 } } }] } }) } });
    return json({ data: { Media: aniNode(2, 'Fire Force 2', 2020, { startDate: { year: 2020, month: 7, day: 3 }, relations: { edges: [{ relationType: 'PREQUEL', node: { id: 1, type: 'ANIME', format: 'TV', title: { romaji: 'Fire Force' } } }] } }) } });
  }
  if (url.host === 'www.wikidata.org') {
    const p = url.searchParams;
    if (p.get('action') === 'wbsearchentities') {
      const s = p.get('search') ?? '';
      if (/rrr/i.test(s)) return json({ search: [{ id: 'Q60', label: 'RRR', description: '2022 film directed by S. S. Rajamouli' }, { id: 'Q61', label: 'RRR season', description: 'the first season of RRR television series' }, { id: 'Q62', label: 'RRR (game)', description: '2010 video game' }] });
      if (/fire force/i.test(s)) return json({ search: [{ id: 'Q70', label: 'Fire Force', description: 'Japanese anime television series' }] });
      return json({ search: [] });
    }
    const ids = String(p.get('ids')).split('|');
    if (ids[0] === 'Q60') return json({ entities: { Q60: { labels: { en: { value: 'RRR' } }, descriptions: { en: { value: '2022 film directed by S. S. Rajamouli' } }, sitelinks: { enwiki: { title: 'RRR (film)' } }, claims: { P577: [{ mainsnak: { datavalue: { value: { time: '+2022-03-25T00:00:00Z' } } } }], P86: [{ mainsnak: { datavalue: { value: { id: 'Q300' } } } }], P136: [{ mainsnak: { datavalue: { value: { id: 'Q301' } } } }], P364: [{ mainsnak: { datavalue: { value: { id: 'Q302' } } } }], P2047: [{ mainsnak: { datavalue: { value: { amount: '+187' } } } }] } } } });
    if (ids.includes('Q300')) return json({ entities: { Q300: { labels: { en: { value: 'M. M. Keeravani' } } }, Q301: { labels: { en: { value: 'action film' } } }, Q302: { labels: { en: { value: 'Telugu' } } } } });
    if (ids[0] === 'Q70') return json({ entities: { Q70: { labels: { ja: { value: '炎炎ノ消防隊' }, en: { value: 'Fire Force' } }, claims: {} } } });
    return json({ entities: {} });
  }
  if (url.host === 'en.wikipedia.org') {
    const p = url.searchParams;
    if (p.get('prop') === 'extracts|pageimages') return json({ query: { pages: [{ title: 'RRR (film)', extract: 'RRR is a 2022 Indian Telugu-language epic film.', thumbnail: { source: 'https://upload.example/rrr.jpg' } }] } });
    return json({ query: { pages: [{ title: String(p.get('titles')), missing: true }] } });
  }
  if (url.host === 'itunes.apple.com') return json({ results: [] });
  if (url.host === 'musicbrainz.org') return json({ releases: [] });
  if (url.host === 'api.animethemes.moe') return json({ anime: [] });
  return json({}, 404);
}) as unknown as typeof fetch;

test('keyless search: AniList roots (no season entries) and Wikidata films (no seasons, games or franchises); AniList wins a duplicate', async () => {
  const r = await keylessTitles(fake).search('fire force');
  assert.deepEqual(r.results.map((m) => m.id), ['al-1'], 'season 2 dropped, Wikidata duplicate dropped');
  assert.equal(r.results[0]!.posterPath, 'https://img.example/1.jpg');
  const rrr = await keylessTitles(fake).search('rrr');
  assert.deepEqual(rrr.results.map((m) => [m.id, m.type, m.year]), [['wd-Q60', 'movie', 2022]]);
});

test('keyless details (AniList): seasons are built from PREQUEL/SEQUEL links; composer and other titles come from Wikidata when asked', async () => {
  const calls: string[] = [];
  const d = await keylessTitles(fake).details('al-2', { composersFor: async (t) => { calls.push(t); return ['Kenichiro Suehiro']; }, titlesFor: async () => ['炎炎ノ消防隊'] });
  assert.equal(d.title, 'Fire Force', 'walks back to season 1'); assert.equal(d.kind, 'tv'); assert.equal(d.originalLanguage, 'ja'); assert.ok(d.genres.includes('Animation'));
  assert.deepEqual(d.seasons!.map((s) => [s.seasonNumber, s.airDate]), [[1, '2019-07-06'], [2, '2020-07-03']]);
  assert.deepEqual(d.composers, ['Kenichiro Suehiro']); assert.ok(d.altTitles.includes('炎炎ノ消防隊')); assert.equal(d.overview, 'A fire story. Second line.');
  assert.deepEqual(calls, ['Fire Force']);
});

test('keyless details (Wikidata): year, runtime, genre, language, composer, overview and thumbnail', async () => {
  const d = await keylessTitles(fake).details('wd-Q60');
  assert.equal(d.kind, 'movie'); assert.equal(d.year, 2022); assert.equal(d.runtimeMin, 187); assert.deepEqual(d.genres, ['action film']);
  assert.equal(d.originalLanguage, 'te'); assert.deepEqual(d.composers, ['M. M. Keeravani']); assert.match(d.overview ?? '', /2022 Indian Telugu/); assert.equal(d.posterPath, 'https://upload.example/rrr.jpg');
});

test('static API: same endpoints in the browser, no custom request headers (they would trigger CORS preflights), Deezer reported as unavailable', async () => {
  sawHeaders.length = 0;
  const api = createStaticApi({ fetchImpl: fake });
  assert.equal((await api.call('/api/health')).mode, 'static');
  assert.deepEqual((await api.call('/api/search?q=rrr')).results.map((m: any) => m.id), ['wd-Q60']);
  assert.equal((await api.call('/api/deezer-isrc?id=1')).isrc, null);
  assert.deepEqual((await api.call('/api/trending?kind=all')).results, [], 'no trending movies without TMDB');
  assert.equal((await api.call('/api/trending?kind=anime')).results[0].id, 'al-1');
  const d = await api.call('/api/details/wd-Q60'); assert.equal(d.title, 'RRR');
  await assert.rejects(() => api.call('/api/details/tmdb-movie-1'), /TMDB token/);
  await assert.rejects(() => api.call('/api/nope'), /not available in the browser-only version/);
  const m = await api.call('/api/soundtrack-merged?title=RRR&year=2022&composer=M.%20M.%20Keeravani&stage=wiki');
  assert.ok(Array.isArray(m.sources)); assert.match(m.sources.find((s: any) => s.key === 'catalog').label, /Deezer is not in the browser version/);
  assert.ok(!sawHeaders.some((h) => h === 'user-agent' || h === 'api-user-agent'), 'only simple headers: ' + [...new Set(sawHeaders)].join(','));
});

test('static API with a visitor TMDB token: search goes to TMDB first and falls back to keyless on failure', async () => {
  const seen: string[] = [];
  const f = (async (u: string | URL, init?: RequestInit) => {
    const url = new URL(String(u)); seen.push(url.host + (init?.headers && (init.headers as Record<string, string>).Authorization ? ' [auth]' : ''));
    if (url.host === 'api.themoviedb.org') return json({ status_message: 'nope' }, 500);
    return fake(u, init);
  }) as unknown as typeof fetch;
  const api = createStaticApi({ fetchImpl: f, getToken: () => 'x'.repeat(60) });
  const r = await api.call('/api/search?q=rrr');
  assert.ok(seen.some((s) => s.startsWith('api.themoviedb.org') && s.includes('[auth]')), 'token sent to TMDB only');
  assert.ok(r.errors.some((e: string) => /^tmdb/.test(e)) && r.results.length > 0, 'falls back to Wikidata results and says TMDB failed');
  assert.ok(!seen.filter((s) => !s.startsWith('api.themoviedb.org')).some((s) => s.includes('[auth]')), 'token never sent anywhere else');
});
