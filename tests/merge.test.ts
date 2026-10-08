import test from 'node:test';
import assert from 'node:assert/strict';
import { confidenceOf, mergeSoundtrack, trackKey, type AlbumWithTracks } from '../src/app/soundtrackMerge.ts';
import { buildMergedSoundtrack } from '../src/app/soundtrackService.ts';
import type { Soundtrack } from '../src/providers/wikiSoundtrack.ts';
import type { CatalogAlbum, CatalogTrack } from '../src/providers/catalogAlbums.ts';

const wiki: Soundtrack = {
  page: { title: 'They Call Him OG (soundtrack)', url: 'https://en.wikipedia.org/wiki/x' }, pageKind: 'soundtrack', license: 'CC BY-SA 4.0',
  sections: [
    { name: 'Telugu', tracks: [{ no: 1, title: 'Firestorm', artists: ['Thaman S'], lyricists: [], lengthSec: 240 }, { no: 2, title: 'Suvvi Suvvi', artists: ['Sruthi Ranjani'], lyricists: [], lengthSec: 275 }] },
    { name: 'Background score', tracks: [{ no: 22, title: 'The Return of Gambheera', artists: [], lyricists: [], lengthSec: 331 }] },
  ],
};
const apple: CatalogAlbum = { platform: 'apple', id: '1', name: 'They Call Him OG (Original Motion Picture Soundtrack)', artist: 'Thaman S', url: 'https://music.apple.com/a/1', kind: 'album', art: 'https://a/art.jpg' };
const deezerAlbum: CatalogAlbum = { platform: 'deezer', id: '2', name: 'They Call Him OG (Telugu)', artist: 'Thaman S', url: 'https://www.deezer.com/album/2', kind: 'album' };
const playlist: CatalogAlbum = { platform: 'deezer-playlist', id: '3', name: 'OG vibes', artist: 'fan123', url: 'https://www.deezer.com/playlist/3', kind: 'playlist' };
const ct = (no: number, title: string, url: string, artists = ['Thaman S']): CatalogTrack => ({ no, title, artists, url, id: String(no) });

test('trackKey: ignores "(From ...)" tails, accents and spelling doubles, but keeps version kinds apart', () => {
  assert.equal(trackKey('Firestorm (From "They Call Him OG")'), trackKey('Firestorm'));
  assert.equal(trackKey('Bāhubali Theme'), trackKey('Baahubali Theme'));
  assert.notEqual(trackKey('Firestorm'), trackKey('Firestorm (Instrumental)'));
});

test('confidenceOf: 2+ independent sources = green, one = amber, community only = red', () => {
  const w = { source: 'wikipedia' as const, label: 'w' }, a = { source: 'apple' as const, label: 'a' }, d = { source: 'deezer' as const, label: 'd' }, c = { source: 'community' as const, label: 'c' };
  assert.equal(confidenceOf([w, a]), 'green'); assert.equal(confidenceOf([a, d]), 'green'); assert.equal(confidenceOf([w]), 'amber');
  assert.equal(confidenceOf([a, { ...a, label: 'second apple album' }]), 'amber', 'two albums of the SAME platform are not independent');
  assert.equal(confidenceOf([w, c]), 'amber', 'a community playlist never upgrades a song'); assert.equal(confidenceOf([c]), 'red'); assert.equal(confidenceOf([]), 'red');
});

test('mergeSoundtrack: Wikipedia order kept, catalog evidence and direct links attached, extras in their own sections', () => {
  const fetched: AlbumWithTracks[] = [
    { album: apple, tracks: [ct(1, 'Firestorm (From "They Call Him OG")', 'https://music.apple.com/t/1'), ct(2, 'Suvvi Suvvi', 'https://music.apple.com/t/2'), ct(3, 'Bonus Cut', 'https://music.apple.com/t/3')] },
    { album: deezerAlbum, tracks: [ct(1, 'Firestorm', 'https://www.deezer.com/track/1'), ct(3, 'Bonus Cut', 'https://www.deezer.com/track/3')] },
    { album: playlist, tracks: [ct(1, 'Firestorm', 'https://www.deezer.com/track/p1'), ct(2, 'Random Fan Pick', 'https://www.deezer.com/track/p2', ['Someone'])] },
  ];
  const m = mergeSoundtrack(wiki, fetched);
  assert.deepEqual(m.sections.map((s) => [s.origin, s.name]), [['wikipedia', 'Telugu'], ['wikipedia', 'Background score'], ['catalog', 'Apple Music: They Call Him OG (Original Motion Picture Soundtrack)'], ['community', 'Community playlist (unverified): OG vibes']]);
  const [fire, suvvi] = m.sections[0]!.tracks;
  assert.equal(fire!.confidence, 'green'); assert.deepEqual(fire!.evidence.map((e) => e.source).sort(), ['apple', 'community', 'deezer', 'wikipedia']);
  assert.equal(fire!.links.apple, 'https://music.apple.com/t/1'); assert.equal(fire!.links.deezer, 'https://www.deezer.com/track/1');
  assert.equal(fire!.art, 'https://a/art.jpg'); assert.equal(fire!.no, 1, 'Wikipedia numbering wins');
  assert.equal(suvvi!.confidence, 'green'); // wikipedia + apple
  assert.equal(m.sections[1]!.tracks[0]!.confidence, 'amber', 'only Wikipedia lists the background score track');
  const bonus = m.sections[2]!.tracks[0]!;
  assert.equal(bonus.title, 'Bonus Cut'); assert.equal(bonus.confidence, 'green', 'on both Apple and Deezer albums');
  const fan = m.sections[3]!.tracks[0]!;
  assert.equal(fan.title, 'Random Fan Pick'); assert.equal(fan.confidence, 'red');
  assert.deepEqual(m.counts, { green: 3, amber: 1, red: 1, total: 5 });
});

test('mergeSoundtrack: with no Wikipedia list, albums form the list; nothing at all gives an empty result', () => {
  const m = mergeSoundtrack(null, [{ album: apple, tracks: [ct(1, 'Song A', 'u1'), ct(2, 'Song B', 'u2')] }]);
  assert.equal(m.sections.length, 1); assert.deepEqual(m.counts, { green: 0, amber: 2, red: 0, total: 2 }); assert.equal(m.wikipedia, undefined);
  const empty = mergeSoundtrack(null, []);
  assert.deepEqual(empty.sections, []); assert.equal(empty.counts.total, 0);
});

test('buildMergedSoundtrack: one failing source does not sink the rest; slow albums are skipped and flagged partial', async () => {
  const base = { albums: async () => [apple, deezerAlbum], albumTracks: async (p: string) => (p === 'apple' ? [ct(1, 'Firestorm', 'u')] : new Promise<CatalogTrack[]>(() => {})), timeoutMs: 30 };
  const m = await buildMergedSoundtrack({ ...base, wiki: async () => wiki } as never, 'They Call Him OG', 2025);
  assert.equal(m.partial, true, 'the Deezer album never answered');
  assert.equal(m.sections[0]!.tracks[0]!.confidence, 'green');
  const wikiDown = await buildMergedSoundtrack({ ...base, wiki: async () => { throw new Error('wikipedia down'); } } as never, 'X', 2025);
  assert.equal(wikiDown.partial, true); assert.ok(wikiDown.counts.total >= 1, 'catalog results still come through');
  await assert.rejects(buildMergedSoundtrack({ wiki: async () => { throw new Error('a'); }, albums: async () => { throw new Error('b'); }, albumTracks: async () => [] } as never, 'X'), /a/);
});

import { createApp } from '../src/server/app.ts';
import { jsonStore } from '../src/server/store.ts';
import type { AddressInfo } from 'node:net';
test('/api/soundtrack-merged: merged result, cached when complete, 400/503/502 handled', async () => {
  let wikiCalls = 0;
  const mk = (over: object = {}) => createApp({
    providers: [], mediaResolvers: [], linkResolvers: [], store: jsonStore(), webRoot: '.',
    soundtrack: async (t) => { wikiCalls++; if (t === 'Boom') throw new Error('x'); return wiki; },
    albums: async (t) => { if (t === 'Boom') throw new Error('y'); return [apple]; },
    albumTracks: async () => [ct(1, 'Firestorm', 'https://music.apple.com/t/1')],
    rateLimit: { general: { windowMs: 60_000, max: 1000 }, discover: { windowMs: 60_000, max: 1000 } }, ...over,
  });
  const s = mk(); await new Promise<void>((r) => s.listen(0, r));
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/api/soundtrack-merged?title=x`)).status, 400);
    const m = await (await fetch(`${base}/api/soundtrack-merged?title=They%20Call%20Him%20OG&year=2025`)).json();
    assert.equal(m.counts.green, 1); assert.equal(m.wikipedia.title, 'They Call Him OG (soundtrack)'); assert.equal(m.partial, false);
    await fetch(`${base}/api/soundtrack-merged?title=They%20Call%20Him%20OG&year=2025`);
    assert.equal(wikiCalls, 1, 'complete results are cached');
    assert.equal((await fetch(`${base}/api/soundtrack-merged?title=Boom`)).status, 502);
  } finally { await new Promise<void>((r) => s.close(() => r())); }
  const off = createApp({ providers: [], mediaResolvers: [], linkResolvers: [], store: jsonStore(), webRoot: '.' });
  await new Promise<void>((r) => off.listen(0, r));
  try { assert.equal((await fetch(`http://127.0.0.1:${(off.address() as AddressInfo).port}/api/soundtrack-merged?title=abc`)).status, 503); } finally { await new Promise<void>((r) => off.close(() => r())); }
});
