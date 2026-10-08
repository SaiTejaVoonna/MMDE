import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSoundtrack } from '../src/app/soundtrackMerge.ts';
import { buildMergedSoundtrack } from '../src/app/soundtrackService.ts';
import type { AnimeThemesEntry } from '../src/providers/animeThemesSearch.ts';

const wiki = { page: { title: 'X (soundtrack)', url: 'u' }, pageKind: 'soundtrack' as const, license: 'CC BY-SA 4.0' as const, sections: [
  { name: 'Songs', tracks: [{ no: 1, title: 'Main Song', artists: ['A'], lyricists: [], lengthSec: 200 }, { no: 2, title: 'Main Song (Instrumental)', artists: [], lyricists: [], lengthSec: 200 }] },
  { name: 'Background score', tracks: [{ no: 3, title: 'Battle Cue', artists: [], lyricists: [], lengthSec: 90 }] }] };
const at: AnimeThemesEntry[] = [{ name: 'Show', year: 2019, season: 'Summer', slug: 's', themes: [{ slug: 'OP1', type: 'OP', sequence: 1, title: 'Opening Song', artists: ['B'], url: 'https://animethemes.moe/x/OP1' }, { slug: 'ED1', type: 'ED', sequence: 1, title: 'Ending Song', artists: ['C'], url: 'https://animethemes.moe/x/ED1' }] }];

test('merged tracks carry a type (song / score / opening / ending) and a version kind (original / instrumental ...)', () => {
  const m = mergeSoundtrack(wiki, [], { animeThemes: at });
  const by = Object.fromEntries(m.sections.flatMap((s) => s.tracks).map((t) => [t.title, t]));
  assert.equal(by['Main Song']!.type, 'song'); assert.equal(by['Main Song']!.version, 'original');
  assert.equal(by['Main Song (Instrumental)']!.version, 'instrumental'); assert.equal(by['Main Song (Instrumental)']!.type, 'score');
  assert.equal(by['Battle Cue']!.type, 'score');
  assert.equal(by['Opening Song']!.type, 'opening'); assert.equal(by['Ending Song']!.type, 'ending');
});

test('buildMergedSoundtrack: reports a status per source; fast mode skips the slow ones and marks them pending', async () => {
  let slowCalls = 0;
  const src = { wiki: async () => wiki, albums: async () => [], albumTracks: async () => [], animeThemes: async () => { slowCalls++; return at; }, musicBrainz: async () => { slowCalls++; return []; }, wikidata: async () => { slowCalls++; return ['炎炎ノ消防隊']; } };
  const fast = await buildMergedSoundtrack(src, 'Show', 2019, { anime: true, fast: true });
  assert.equal(slowCalls, 0, 'fast mode never calls MusicBrainz, AnimeThemes or Wikidata');
  const st = Object.fromEntries(fast.sources!.map((s) => [s.key, s.state]));
  assert.deepEqual(st, { wikipedia: 'ok', catalog: 'empty', musicbrainz: 'pending', animethemes: 'pending', wikidata: 'pending' });
  const full = await buildMergedSoundtrack(src, 'Show', 2019, { anime: true });
  const st2 = Object.fromEntries(full.sources!.map((s) => [s.key, s.state]));
  assert.deepEqual(st2, { wikipedia: 'ok', catalog: 'empty', musicbrainz: 'empty', animethemes: 'ok', wikidata: 'ok' });
  const failing = await buildMergedSoundtrack({ ...src, musicBrainz: async () => { throw new Error('x'); } }, 'Show', 2019, {});
  assert.equal(failing.sources!.find((s) => s.key === 'musicbrainz')!.state, 'failed');
  assert.equal(failing.partial, true);
});
