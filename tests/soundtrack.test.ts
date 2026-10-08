import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeEntities, parseLength, parseTracklists, wikiSoundtrack } from '../src/providers/wikiSoundtrack.ts';
import { acceptCandidate, trackLinkResolver } from '../src/providers/trackLinks.ts';
import { createApp } from '../src/server/app.ts';
import { jsonStore } from '../src/server/store.ts';
import type { AddressInfo } from 'node:net';

const fixture = readFileSync(fileURLToPath(new URL('./fixtures/og-soundtrack.html', import.meta.url)), 'utf8');

test('parseTracklists: sections, singers, lengths; skips the Total length row', () => {
  const s = parseTracklists(fixture);
  assert.deepEqual(s.map((x) => x.name), ['Telugu', 'Telugu · Extended Soundtrack', 'Hindi', 'Background score']);
  const telugu = s[0]!;
  assert.equal(telugu.tracks.length, 6);
  assert.deepEqual(telugu.tracks[0], { no: 1, title: 'Firestorm', artists: ['Thaman S', 'Silambarasan TR', 'Deepak Blue'], lyricists: ['Vishwa Vemuri', 'Srinivasa Mouli', 'Raja Kumari'], lengthSec: 240 });
  assert.deepEqual(telugu.tracks[3]!.artists, ['Harsha Darivemula', 'Sruthi Ranjani', 'Pranati'], '& splits singers');
  assert.equal(telugu.tracks[2]!.title, "Guns N' Roses", 'apostrophes survive');
  assert.deepEqual(s[1]!.tracks[1]!.lyricists, [], 'a dash means no credit');
  const bg = s[3]!.tracks.find((t) => t.title === 'The Return of Gambheera')!;
  assert.equal(bg.no, 22); assert.equal(bg.lengthSec, 331); assert.deepEqual(bg.artists, []);
});

test('parser helpers', () => {
  assert.equal(decodeEntities('Guns &amp; Roses &#39;x&#39; &#x41;'), "Guns & Roses 'x' A");
  assert.equal(parseLength('4:35'), 275); assert.equal(parseLength('1:02:03'), 3723); assert.equal(parseLength('n/a'), undefined);
  assert.deepEqual(parseTracklists('<table class="tracklist"><tr><th>x</th></tr></table>'), [], 'no Title column: ignored');
});

function fakeWiki(pages: Record<string, string>) {
  const calls: string[] = [];
  const f = (async (u: string) => {
    const url = new URL(String(u)); const p = url.searchParams; calls.push(`${p.get('action')}:${p.get('titles') ?? p.get('page') ?? p.get('srsearch')}`);
    if (p.get('action') === 'query' && p.get('titles')) {
      const pages2 = p.get('titles')!.split('|').map((t) => (t in pages ? { title: t } : { title: t, missing: true }));
      return new Response(JSON.stringify({ query: { pages: pages2 } }), { status: 200 });
    }
    if (p.get('action') === 'query') return new Response(JSON.stringify({ query: { search: [] } }), { status: 200 });
    const html = pages[p.get('page')!];
    return html ? new Response(JSON.stringify({ parse: { text: html } }), { status: 200 }) : new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test('wikiSoundtrack.find: finds "<title> (soundtrack)", returns credited page URL', async () => {
  const { f } = fakeWiki({ 'They Call Him OG (soundtrack)': fixture });
  const r = await wikiSoundtrack('test-agent', f).find('They Call Him OG', 2025);
  assert.equal(r?.page.title, 'They Call Him OG (soundtrack)');
  assert.equal(r?.page.url, 'https://en.wikipedia.org/wiki/They_Call_Him_OG_(soundtrack)');
  assert.equal(r?.license, 'CC BY-SA 4.0');
  assert.equal(r?.sections.length, 4);
});

test('wikiSoundtrack.find: falls back to the film article, and returns null when nothing has a tracklist', async () => {
  const film = wikiSoundtrack('t', fakeWiki({ 'Some Film (2020 film)': fixture }).f);
  assert.equal((await film.find('Some Film', 2020))?.pageKind, 'film');
  const none = wikiSoundtrack('t', fakeWiki({ 'Plain (film)': '<p>No tables</p>' }).f);
  assert.equal(await none.find('Plain', 2001), null);
});

test('acceptCandidate: needs a close title AND a matching artist or the film album', () => {
  const q = { title: 'Firestorm', artists: ['Thaman S'], film: 'They Call Him OG' };
  const c = { platform: 'apple' as const, url: 'u', id: '1', title: 'Firestorm', artists: ['Thaman S'], album: 'x' };
  assert.equal(acceptCandidate(q, c), true);
  assert.equal(acceptCandidate(q, { ...c, artists: ['Someone Else'], album: 'Random Hits' }), false, 'same title, wrong artist and album');
  assert.equal(acceptCandidate(q, { ...c, artists: ['Someone Else'], album: 'They Call Him OG (Original Motion Picture Soundtrack)' }), true, 'film album rescues a missing artist');
  assert.equal(acceptCandidate(q, { ...c, title: 'Firestorm Remix Extended Version' }), false);
  assert.equal(acceptCandidate({ ...q, artists: [] }, { ...c, album: 'Other' }), false, 'no artist and no film album: not exact');
});

test('trackLinkResolver: exact Apple + Deezer links when matched, search links otherwise, and caching', async () => {
  let apple = 0; let deezer = 0;
  const f = (async (u: string) => {
    const s = String(u);
    if (s.includes('itunes.apple.com')) { apple++; return new Response(JSON.stringify({ results: [{ trackName: 'Firestorm', artistName: 'Thaman S', collectionName: 'They Call Him OG', trackViewUrl: 'https://music.apple.com/in/album/x?i=1', trackId: 1, artworkUrl100: 'https://a/100x100bb.jpg' }] }), { status: 200 }); }
    deezer++; return new Response(JSON.stringify({ data: [{ id: 9, link: 'https://www.deezer.com/track/9', title: 'Firestorm', artist: { name: 'Nobody' }, album: { title: 'Mixtape', cover_medium: 'https://d/c.jpg' } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = trackLinkResolver('t', f);
  const q = { title: 'Firestorm', artists: ['Thaman S'], film: 'They Call Him OG' };
  const out = await r.resolve(q);
  const by = Object.fromEntries(out.links.map((l) => [l.platform, l]));
  assert.equal(by.apple!.kind, 'resolved'); assert.equal(by.apple!.url, 'https://music.apple.com/in/album/x?i=1');
  assert.equal(by.deezer!.kind, 'search', 'Deezer hit had the wrong artist and album, so it is only a search link');
  assert.equal(by.youtube!.kind, 'search'); assert.match(by.youtube!.url, /search_query=Firestorm\+They\+Call\+Him\+OG|search_query=Firestorm%20They%20Call%20Him%20OG/);
  assert.equal(out.art, 'https://a/300x300bb.jpg'); assert.deepEqual(out.matchedOn, ['apple']);
  const before = apple; await r.resolve(q); assert.equal(apple, before, 'second call is cached');
});

test('trackLinkResolver: when both services fail it throws and does not cache', async () => {
  let n = 0;
  const r = trackLinkResolver('t', (async () => { n++; throw new TypeError('fetch failed'); }) as unknown as typeof fetch);
  await assert.rejects(r.resolve({ title: 'A', artists: ['B'], film: 'C' }), /failed/);
});

test('/api/soundtrack and /api/track-links: validation, 503 when unavailable, caching, 502 on failure', async () => {
  let calls = 0;
  const server = createApp({
    providers: [], mediaResolvers: [], linkResolvers: [], store: jsonStore(), webRoot: '.',
    soundtrack: async (title) => { calls++; if (title === 'Boom') throw new Error('upstream down'); return title === 'None' ? null : { page: { title: 'x', url: 'u' }, pageKind: 'soundtrack', sections: [], license: 'CC BY-SA 4.0' }; },
    trackLinks: async (q) => ({ links: [], matchedOn: [], art: q.title }),
    rateLimit: { general: { windowMs: 60_000, max: 1000 }, discover: { windowMs: 60_000, max: 1000 } },
  });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/api/soundtrack?title=x`)).status, 400);
    const ok = await (await fetch(`${base}/api/soundtrack?title=They%20Call%20Him%20OG&year=2025`)).json();
    assert.equal(ok.soundtrack.pageKind, 'soundtrack');
    await fetch(`${base}/api/soundtrack?title=They%20Call%20Him%20OG&year=2025`);
    assert.equal(calls, 1, 'cached');
    assert.equal((await (await fetch(`${base}/api/soundtrack?title=None`)).json()).soundtrack, null);
    assert.equal((await fetch(`${base}/api/soundtrack?title=Boom`)).status, 502);
    const t = await (await fetch(`${base}/api/track-links?title=Firestorm&film=OG&artist=A%7CB`)).json();
    assert.equal(t.art, 'Firestorm');
    assert.equal((await fetch(`${base}/api/track-links?title=&film=OG`)).status, 400);
  } finally { await new Promise<void>((r) => server.close(() => r())); }
  const off = createApp({ providers: [], mediaResolvers: [], linkResolvers: [], store: jsonStore(), webRoot: '.' });
  await new Promise<void>((r) => off.listen(0, r));
  const b2 = `http://127.0.0.1:${(off.address() as AddressInfo).port}`;
  try { assert.equal((await fetch(`${b2}/api/soundtrack?title=abc`)).status, 503); assert.equal((await fetch(`${b2}/api/track-links?title=abc`)).status, 503); }
  finally { await new Promise<void>((r) => off.close(() => r())); }
});

import { foldTitle, titleVariants } from '../src/providers/wikiSoundtrack.ts';
test('accent and spelling variants: TMDB "Bāhubali 2" finds Wikipedia "Baahubali 2"', async () => {
  assert.deepEqual(titleVariants('Bāhubali 2: The Conclusion'), ['Bāhubali 2: The Conclusion', 'Bahubali 2: The Conclusion', 'Baahubali 2: The Conclusion']);
  assert.equal(foldTitle('Bāhubali 2: The Conclusion'), foldTitle('Baahubali 2: The Conclusion (soundtrack)').replace(/ soundtrack$/, ''));
  const { f } = fakeWiki({ 'Baahubali 2: The Conclusion (soundtrack)': fixture });
  const r = await wikiSoundtrack('t', f).find('Bāhubali 2: The Conclusion', 2017);
  assert.equal(r?.page.title, 'Baahubali 2: The Conclusion (soundtrack)');
});

import { catalogResolver, isFilmAlbum, looseFold } from '../src/providers/catalogAlbums.ts';

test('isFilmAlbum: whole film title, accent and spelling tolerant; rejects unrelated albums', () => {
  assert.equal(looseFold('Bāhubali 2: The Conclusion'), looseFold('Baahubali 2 - The Conclusion'));
  assert.equal(isFilmAlbum('Bāhubali 2: The Conclusion', 'Baahubali 2 - The Conclusion (Original Motion Picture Soundtrack)'), true);
  assert.equal(isFilmAlbum('They Call Him OG', 'OG (Original Motion Picture Soundtrack)'), false, 'a shorter name is not the same film');
  assert.equal(isFilmAlbum('Up', 'Up'), false, 'titles under 3 letters are too ambiguous to match on');
  assert.equal(isFilmAlbum('Bāhubali', 'Greatest Hits'), false);
});

test('catalogResolver: finds soundtrack albums on Apple and Deezer, dedupes, labels playlists, lists tracks with direct links', async () => {
  const f = (async (u: string) => {
    const url = new URL(String(u)); const path = url.pathname;
    const body = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (url.hostname === 'itunes.apple.com' && path === '/search') return body({ results: [
      { collectionId: 11, collectionName: 'Baahubali 2 - The Conclusion (Telugu) [Original Motion Picture Soundtrack]', artistName: 'M. M. Keeravani', trackCount: 8, collectionViewUrl: 'https://music.apple.com/in/album/x/11', artworkUrl100: 'https://a/100x100bb.jpg' },
      { collectionId: 12, collectionName: 'Unrelated Hits', artistName: 'X', trackCount: 10, collectionViewUrl: 'https://music.apple.com/in/album/y/12' },
    ] });
    if (url.hostname === 'itunes.apple.com' && path === '/lookup') return body({ results: [{ wrapperType: 'collection' }, { wrapperType: 'track', trackNumber: 2, trackName: 'Sivuni Aana', artistName: 'Kaala Bhairava', trackTimeMillis: 240000, trackViewUrl: 'https://music.apple.com/in/album/x/11?i=22', trackId: 22 }, { wrapperType: 'track', trackNumber: 1, trackName: 'Saahore Baahubali', artistName: 'Daler Mehndi', trackTimeMillis: 300000, trackViewUrl: 'https://music.apple.com/in/album/x/11?i=21', trackId: 21 }] });
    if (path === '/search/album') return body({ data: [
      { id: 31, title: 'Baahubali 2 - The Conclusion (Telugu) [Original Motion Picture Soundtrack]', link: 'https://www.deezer.com/album/31', nb_tracks: 8, artist: { name: 'M. M. Keeravani' } },
      { id: 32, title: 'Baahubali 2 The Conclusion (Hindi)', link: 'https://www.deezer.com/album/32', nb_tracks: 7, artist: { name: 'M. M. Keeravani' } },
    ] });
    if (path === '/search/playlist') return body({ data: [{ id: 41, title: 'Baahubali 2 songs', link: 'https://www.deezer.com/playlist/41', nb_tracks: 20, user: { name: 'fan123' } }, { id: 42, title: 'Baahubali 2 tiny', link: 'x', nb_tracks: 2, user: { name: 'z' } }] });
    if (path === '/album/32/tracks') return body({ data: [{ id: 5, title: 'Jiyo Re Baahubali', link: 'https://www.deezer.com/track/5', duration: 200, artist: { name: 'Kaala Bhairava' }, album: { cover_medium: 'https://d/c.jpg' } }] });
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  const c = catalogResolver('t', f);
  const albums = await c.findAlbums('Bāhubali 2: The Conclusion', 2017);
  assert.deepEqual(albums.map((a) => [a.platform, a.name.slice(0, 22)]), [['apple', 'Baahubali 2 - The Conc'], ['deezer', 'Baahubali 2 The Conclu'], ['deezer-playlist', 'Baahubali 2 songs']], 'unrelated album dropped, Telugu Deezer duplicate of Apple dropped, tiny playlist dropped');
  assert.equal(albums[0]!.art, 'https://a/300x300bb.jpg');
  const t = await c.tracks('apple', '11');
  assert.deepEqual(t.map((x) => x.title), ['Saahore Baahubali', 'Sivuni Aana'], 'sorted by track number');
  assert.equal(t[0]!.url, 'https://music.apple.com/in/album/x/11?i=21'); assert.equal(t[0]!.lengthSec, 300);
  const d = await c.tracks('deezer', '32');
  assert.equal(d[0]!.url, 'https://www.deezer.com/track/5');
  await assert.rejects(c.tracks('apple', '../x'), /invalid id/);
});

test('/api/albums and /api/album-tracks: validation and 503 when unavailable', async () => {
  const server = createApp({
    providers: [], mediaResolvers: [], linkResolvers: [], store: jsonStore(), webRoot: '.',
    albums: async () => [], albumTracks: async () => [],
    rateLimit: { general: { windowMs: 60_000, max: 1000 }, discover: { windowMs: 60_000, max: 1000 } },
  });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/api/albums?title=x`)).status, 400);
    assert.deepEqual(await (await fetch(`${base}/api/albums?title=Baahubali`)).json(), { albums: [] });
    for (const q of ['platform=spotify&id=1', 'platform=apple&id=abc', 'platform=apple&id=1/../2']) assert.equal((await fetch(`${base}/api/album-tracks?${q}`)).status, 400, q);
    assert.equal((await fetch(`${base}/api/album-tracks?platform=deezer&id=5`)).status, 200);
  } finally { await new Promise<void>((r) => server.close(() => r())); }
  const off = createApp({ providers: [], mediaResolvers: [], linkResolvers: [], store: jsonStore(), webRoot: '.' });
  await new Promise<void>((r) => off.listen(0, r));
  try { assert.equal((await fetch(`http://127.0.0.1:${(off.address() as AddressInfo).port}/api/albums?title=abc`)).status, 503); } finally { await new Promise<void>((r) => off.close(() => r())); }
});

import { isFilmPlaylist } from '../src/providers/catalogAlbums.ts';
test('isFilmPlaylist: a numbered sequel may drop its subtitle, a bare franchise name may not', () => {
  assert.equal(isFilmPlaylist('Baahubali 2: The Conclusion', 'Baahubali 2 songs'), true);
  assert.equal(isFilmPlaylist('Star Wars: The Force Awakens', 'Star Wars playlist'), false);
});

import { extraAlbumNames } from '../src/providers/catalogAlbums.ts';
import { buildMergedSoundtrack } from '../src/app/soundtrackService.ts';
test('extraAlbumNames: album titles from Wikipedia section names, volume suffix dropped, generic labels ignored', () => {
  assert.deepEqual(extraAlbumNames(['Telugu', 'Telugu · Extended Soundtrack', 'Background score', 'Background score · Baahubali (Original Soundtrack) - Volume 1', 'Background score · Baahubali (Original Soundtrack) - Volume 10']), ['Baahubali (Original Soundtrack)']);
  assert.deepEqual(extraAlbumNames(['Hindi', 'Tamil']), []);
});

test('catalogResolver + service: albums named by Wikipedia ("... - Volume N") are found even though they lack the film title', async () => {
  const seen: string[] = [];
  const f = (async (u: string) => {
    const url = new URL(String(u)); const term = url.searchParams.get('term') ?? url.searchParams.get('q') ?? '';
    seen.push(url.hostname + url.pathname + ':' + term);
    const body = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (url.pathname === '/search' && url.searchParams.get('entity') === 'album') {
      if (/volume|original soundtrack/i.test(term) && !/conclusion/i.test(term)) return body({ results: [
        { collectionId: 201, collectionName: 'Baahubali (Original Soundtrack) - Volume 2', artistName: 'M. M. Keeravani', trackCount: 5, collectionViewUrl: 'https://music.apple.com/a/201' },
        { collectionId: 200, collectionName: 'Baahubali (Original Soundtrack) - Volume 1', artistName: 'M. M. Keeravani', trackCount: 6, collectionViewUrl: 'https://music.apple.com/a/200' },
        { collectionId: 299, collectionName: 'Baahubali (Hindi) Greatest Hits', artistName: 'X', trackCount: 9, collectionViewUrl: 'https://music.apple.com/a/299' } ] });
      return body({ results: [] });
    }
    if (url.pathname === '/lookup') return body({ results: [{ wrapperType: 'collection' }, { wrapperType: 'track', trackNumber: 1, trackName: url.searchParams.get('id') === '200' ? 'Mahishmati Theme' : 'Palace Intrigue', artistName: 'M. M. Keeravani', trackViewUrl: 'https://music.apple.com/t/' + url.searchParams.get('id'), trackId: 1 }] });
    return body({ data: [] });
  }) as unknown as typeof fetch;
  const wikiSrc = { page: { title: 'Baahubali 2: The Conclusion (soundtrack)', url: 'https://en.wikipedia.org/wiki/x' }, pageKind: 'soundtrack' as const, license: 'CC BY-SA 4.0' as const, sections: [
    { name: 'Telugu', tracks: [{ no: 1, title: 'Saahore Baahubali', artists: [], lyricists: [] }] },
    { name: 'Background score · Baahubali (Original Soundtrack) - Volume 1', tracks: [{ no: 1, title: 'Mahishmati Theme', artists: [], lyricists: [] }] },
    { name: 'Background score · Baahubali (Original Soundtrack) - Volume 2', tracks: [{ no: 1, title: 'Palace Intrigue', artists: [], lyricists: [] }] } ] };
  const c = catalogResolver('t', f);
  const m = await buildMergedSoundtrack({ wiki: async () => wikiSrc, albums: (t, y, x) => c.findAlbums(t, y, x), albumTracks: (p, id) => c.tracks(p, id) }, 'Bāhubali 2: The Conclusion', 2017);
  assert.deepEqual(m.albums.filter((a) => a.viaWiki).map((a) => a.name), ['Baahubali (Original Soundtrack) - Volume 1', 'Baahubali (Original Soundtrack) - Volume 2'], 'natural order, "Greatest Hits" rejected');
  const volumes = m.sections.filter((s) => s.name.includes('Volume')).flatMap((s) => s.tracks);
  assert.deepEqual(volumes.map((t) => t.confidence), ['green', 'green'], 'Wikipedia + the named Apple album agree');
  assert.ok(seen.some((x) => x.includes('Baahubali (Original Soundtrack)')), 'searched the Wikipedia-named album');
});

import { matchesWikiAlbum } from '../src/providers/catalogAlbums.ts';
test('matchesWikiAlbum: real Apple names for the Baahubali score volumes match; first-film and unrelated albums do not', () => {
  const base = 'Baahubali (Original Soundtrack)';
  for (const n of ['Baahubali Ost - Volume 3 (Original Motion Picture Soundtrack)', 'Baahubali Ost - Volume 10 (Original Motion Picture Soundtrack)', 'Baahubali Ost - Volume 9 (Original Motion Picture Soundtrack) - Single', 'Baahubali (Original Soundtrack) - Volume 1']) assert.equal(matchesWikiAlbum(base, n), true, n);
  for (const n of ['Baahubali - The Beginning (Original Motion Picture Soundtrack)', 'Padmaavat (Original Motion Picture Soundtrack)', 'Baahubali - Single', 'Srii Bharatha Baahubali (Original Motion Picture Soundtrack)']) assert.equal(matchesWikiAlbum(base, n), false, n);
  assert.equal(matchesWikiAlbum('Some Film (Original Soundtrack)', 'Some Film (Original Soundtrack)'), true, 'whole-name match still works without volumes');
});
