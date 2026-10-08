import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { classifyForSeason, seasonMarkers } from '../src/app/seasonScope.ts';
import { mergeSoundtrack } from '../src/app/soundtrackMerge.ts';
import { buildMergedSoundtrack } from '../src/app/soundtrackService.ts';
import { createApp } from '../src/server/app.ts';
import { jsonStore } from '../src/server/store.ts';
import type { CatalogAlbum, CatalogTrack } from '../src/providers/catalogAlbums.ts';

test('seasonMarkers: English, ordinal, Japanese and S-number forms; volumes and years are not seasons', () => {
  assert.deepEqual(seasonMarkers('TV Animation "That Time I Got Reincarnated as a Slime season 4" Original Soundtrack vol.1'), [4]);
  assert.deepEqual(seasonMarkers('Tensei Shitara Slime 2nd Season OST'), [2]);
  assert.deepEqual(seasonMarkers('Some Show Second Season Soundtrack'), [2]);
  assert.deepEqual(seasonMarkers('転生したらスライムだった件 第3期 オリジナルサウンドトラック'), [3]);
  assert.deepEqual(seasonMarkers('Show S2 (Original Soundtrack)'), [2]);
  assert.deepEqual(seasonMarkers('Baahubali Ost - Volume 3 (2017)'), [], 'volume numbers and years are not seasons');
  assert.deepEqual(seasonMarkers('Thaman S'), []);
});

test('classifyForSeason: named season wins; otherwise the release year (within a year of airing) decides', () => {
  assert.equal(classifyForSeason('Slime season 4 OST', undefined, 4, 2026), 'match');
  assert.equal(classifyForSeason('Slime season 4 OST', undefined, 1, 2018), 'excluded');
  assert.equal(classifyForSeason('Slime Original Soundtrack', '2018-12-26T08:00:00Z', 1, 2018), 'match');
  assert.equal(classifyForSeason('Slime Original Soundtrack', '2019-03-01T08:00:00Z', 1, 2018), 'match', 'within a year');
  assert.equal(classifyForSeason('Slime Original Soundtrack', '2024-03-01T08:00:00Z', 1, 2018), 'unspecified', 'no season named, too far in time: not excluded, just not tied to this season');
  assert.equal(classifyForSeason('Slime Original Soundtrack', undefined, 1, 2018), 'unspecified');
  assert.equal(classifyForSeason('Show season 2 and season 3 collection', undefined, 3, 2021), 'match');
});

const album = (id: string, name: string, releaseDate?: string): CatalogAlbum => ({ platform: 'apple', id, name, artist: 'Composer', url: 'https://music.apple.com/a/' + id, kind: 'album', releaseDate });
const tr = (title: string): CatalogTrack => ({ no: 1, title, artists: ['Composer'], url: 'https://music.apple.com/t/' + title, id: title });

test('mergeSoundtrack with a season: other seasons dropped, dated/unnamed albums kept in the right group, counts only cover what is shown', () => {
  const albums = [
    { album: album('1', 'Slime season 1 OST', '2018-12-01T00:00:00Z'), tracks: [tr('Opening A')] },
    { album: album('4', 'Slime season 4 vol.1', '2026-04-01T00:00:00Z'), tracks: [tr('Season Four Song')] },
    { album: album('9', 'Slime The Best Collection', '2024-01-01T00:00:00Z'), tracks: [tr('Greatest Hit')] },
    { album: album('3', 'Slime Original Soundtrack', '2018-11-20T00:00:00Z'), tracks: [tr('Early Cue')] },
  ];
  const m = mergeSoundtrack(null, albums, { composers: ['Composer'], season: { number: 1, airYear: 2018 } });
  assert.deepEqual(m.sections.map((s) => [s.name.replace('Apple Music: ', ''), s.scope]), [['Slime season 1 OST', 'match'], ['Slime The Best Collection', 'unspecified'], ['Slime Original Soundtrack', 'match']]);
  assert.equal(m.season!.excluded, 1);
  assert.equal(m.counts.total, 3, 'the season 4 song is not counted');
  const whole = mergeSoundtrack(null, albums, { composers: ['Composer'] });
  assert.equal(whole.counts.total, 4); assert.equal(whole.season, undefined);
});

test('buildMergedSoundtrack with a season never fetches tracks for albums that name another season', async () => {
  const fetchedIds: string[] = [];
  const m = await buildMergedSoundtrack({
    wiki: async () => null,
    albums: async () => [album('1', 'Slime season 1 OST'), album('2', 'Slime season 2 OST'), album('4', 'Slime season 4 OST')],
    albumTracks: async (_p: string, id: string) => { fetchedIds.push(id); return [tr('Song ' + id)]; },
  } as never, 'Slime', 2018, { composers: ['Composer'], season: { number: 2, airYear: 2021 } });
  assert.deepEqual(fetchedIds, ['2'], 'only season 2 was looked up');
  assert.equal(m.counts.total, 1);
  assert.equal(m.season!.excluded, 2, 'the two other-season albums are reported as hidden');
});

test('/api/soundtrack-merged: season params are validated and are part of the cache key', async () => {
  const seen: Array<number | undefined> = [];
  const s = createApp({
    providers: [], mediaResolvers: [], linkResolvers: [], store: jsonStore(), webRoot: '.',
    soundtrack: async () => null,
    albums: async () => [album('1', 'Show season 1 OST'), album('2', 'Show season 2 OST')],
    albumTracks: async (_p: string, id: string) => { seen.push(Number(id)); return [tr('Song ' + id)]; },
    rateLimit: { general: { windowMs: 60_000, max: 1000 }, discover: { windowMs: 60_000, max: 1000 } },
  });
  await new Promise<void>((r) => s.listen(0, r));
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  try {
    const s1 = await (await fetch(`${base}/api/soundtrack-merged?title=Show&season=1&seasonYear=2018&composer=Composer`)).json();
    assert.equal(s1.season.number, 1); assert.equal(s1.counts.total, 1);
    const bad = await (await fetch(`${base}/api/soundtrack-merged?title=Show&season=abc&composer=Composer`)).json();
    assert.equal(bad.season, undefined, 'a malformed season is ignored, not an error'); assert.equal(bad.counts.total, 2);
    const s2 = await (await fetch(`${base}/api/soundtrack-merged?title=Show&season=2&seasonYear=2021&composer=Composer`)).json();
    assert.equal(s2.counts.total, 1); assert.deepEqual(s2.sections.map((x: { name: string }) => x.name), ['Apple Music: Show season 2 OST']);
  } finally { await new Promise<void>((r) => s.close(() => r())); }
});
