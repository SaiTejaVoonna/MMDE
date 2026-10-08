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

import { animeThemesSource, franchiseKey, pickFranchise } from '../src/providers/animeThemesSearch.ts';

const FIRE = { anime: [
  { name: 'Enen no Shouboutai', year: 2019, season: 'Summer', slug: 'enen_no_shouboutai', animethemes: [{ slug: 'OP1', type: 'OP', sequence: 1, song: { title: 'Inferno', artists: [{ name: 'Mrs. GREEN APPLE' }] } }, { slug: 'ED1', type: 'ED', sequence: 1, song: { title: 'veil', artists: [{ name: 'Keina Suda' }] } }] },
  { name: 'Enen no Shouboutai: Ni no Shou', year: 2020, season: 'Summer', slug: 'enen_no_shouboutai_ni_no_shou', animethemes: [{ slug: 'OP1', type: 'OP', sequence: 1, song: { title: 'SPARK-AGAIN', artists: [{ name: 'Aimer' }] } }] },
  { name: 'Some Other Show', year: 1999, slug: 'other', animethemes: [{ slug: 'OP1', type: 'OP', song: { title: 'Nope', artists: [] } }] },
] };

test('pickFranchise: the top hit picks the franchise, but only if a year agrees with TMDB', () => {
  assert.equal(franchiseKey('Enen no Shouboutai: Ni no Shou'), 'enen no shouboutai');
  assert.equal(pickFranchise([{ name: 'Enen no Shouboutai', year: 2019 }, { name: 'Enen no Shouboutai: Ni no Shou', year: 2020 }], 2019), 'enen no shouboutai');
  assert.equal(pickFranchise([{ name: 'Fire Force Parody', year: 1990 }, { name: 'Enen no Shouboutai', year: 2019 }], 2019), 'enen no shouboutai', 'a same-named but unrelated older show is skipped');
  assert.equal(pickFranchise([{ name: 'Totally Different', year: 1980 }], 2019), undefined);
});

test('animeThemesSource: returns every season of the franchise with songs, artists and links; cached', async () => {
  let calls = 0;
  const f = (async (u: string) => { calls++; assert.match(String(u), /api\.animethemes\.moe\/anime\?/); return new Response(JSON.stringify(FIRE), { status: 200 }); }) as unknown as typeof fetch;
  const src = animeThemesSource('t', f);
  const entries = await src.find('Fire Force', ['炎炎ノ消防隊'], 2019);
  assert.deepEqual(entries.map((e) => [e.name, e.year]), [['Enen no Shouboutai', 2019], ['Enen no Shouboutai: Ni no Shou', 2020]]);
  assert.deepEqual(entries[0]!.themes.map((t) => [t.slug, t.title, t.artists[0]]), [['OP1', 'Inferno', 'Mrs. GREEN APPLE'], ['ED1', 'veil', 'Keina Suda']]);
  assert.equal(entries[0]!.themes[0]!.url, 'https://animethemes.moe/anime/enen_no_shouboutai/OP1');
  await src.find('Fire Force', [], 2019); assert.equal(calls, 1);
});

test('anime season scoping with AnimeThemes: Season 1 shows only the 2019 openings/endings', async () => {
  const at = animeThemesSource('t', (async () => new Response(JSON.stringify(FIRE), { status: 200 })) as unknown as typeof fetch);
  const sources = { wiki: async () => null, albums: async () => [], albumTracks: async () => [], animeThemes: (t: string, a: string[], y?: number) => at.find(t, a, y) };
  const s1 = await buildMergedSoundtrack(sources as never, 'Fire Force', 2019, { anime: true, season: { number: 1, airYear: 2019 } });
  assert.deepEqual(s1.sections.map((s) => s.name), ['Openings and endings · Enen no Shouboutai (2019 Summer)']);
  assert.deepEqual(s1.sections[0]!.tracks.map((t) => t.title), ['Inferno', 'veil']);
  assert.equal(s1.season!.excluded, 1, 'the 2020 season is hidden');
  assert.equal(s1.verified, 'title', 'AnimeThemes year-matched entries verify the title');
  assert.ok(s1.sections[0]!.tracks.every((t) => t.confidence === 'amber'), 'one source only: amber, not red');
  const s2 = await buildMergedSoundtrack(sources as never, 'Fire Force', 2019, { anime: true, season: { number: 2, airYear: 2020 } });
  assert.deepEqual(s2.sections[0]!.tracks.map((t) => t.title), ['SPARK-AGAIN']);
  const whole = await buildMergedSoundtrack(sources as never, 'Fire Force', 2019, { anime: true });
  assert.equal(whole.counts.total, 3);
  const notAnime = await buildMergedSoundtrack(sources as never, 'Fire Force', 2019, {});
  assert.equal(notAnime.counts.total, 0, 'AnimeThemes is only asked for anime');
});
