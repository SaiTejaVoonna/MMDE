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
