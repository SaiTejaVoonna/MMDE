import test from 'node:test';
import assert from 'node:assert/strict';
import { languageFromName, languageName, mbReleaseSource, parseRelease } from '../src/providers/mbReleases.ts';
import { linkVersions, mergeSoundtrack, type MergedSection } from '../src/app/soundtrackMerge.ts';
import { buildMergedSoundtrack } from '../src/app/soundtrackService.ts';

const rel = (id: string, title: string, language: string, tracks: Array<[string, number, string]>, artist = 'M. M. Keeravani') => ({
  id, title, date: '2017-04-14', barcode: '8902894355133', country: 'IN',
  'text-representation': { language },
  'artist-credit': [{ name: artist, artist: { name: artist, 'sort-name': 'Keeravani, M. M.' } }],
  'label-info': [{ label: { name: 'Lahari Music' } }],
  media: [{ 'track-count': tracks.length, tracks: tracks.map(([t, len, isrc], i) => ({ position: i + 1, title: t, length: len * 1000, recording: { title: t, isrcs: [isrc], 'artist-credit': [{ name: artist, artist: { name: artist } }] } })) }],
});

test('parseRelease: label, barcode, date, language name, tracks with ISRC and length', () => {
  const r = parseRelease(rel('r1', 'Baahubali 2 (Telugu)', 'tel', [['Saahore Baahubali', 300, 'INA011700001'], ['Hamsa Naava', 281, 'INA011700002']]));
  assert.equal(r.label, 'Lahari Music'); assert.equal(r.barcode, '8902894355133'); assert.equal(r.language, 'Telugu'); assert.equal(r.url, 'https://musicbrainz.org/release/r1');
  assert.deepEqual(r.tracks.map((t) => [t.no, t.title, t.lengthSec, t.isrcs[0]]), [[1, 'Saahore Baahubali', 300, 'INA011700001'], [2, 'Hamsa Naava', 281, 'INA011700002']]);
  assert.ok(r.artists.includes('M. M. Keeravani'));
});

test('language helpers', () => {
  assert.equal(languageName('hin'), 'Hindi'); assert.equal(languageName('xxx'), undefined); assert.equal(languageName(undefined), undefined);
  assert.equal(languageFromName('Baahubali 2 (Telugu)'), 'Telugu'); assert.equal(languageFromName('Fire Force OST'), undefined); assert.equal(languageFromName('Mandarin Version'), 'Chinese');
});

test('mergeSoundtrack: MusicBrainz adds a second independent source (green) and the proof (ISRC, label, barcode, date)', () => {
  const mb = [parseRelease(rel('r1', 'Baahubali 2 (Telugu)', 'tel', [['Saahore Baahubali', 300, 'INA011700001']]))];
  const wiki = { page: { title: 'Baahubali 2 soundtrack', url: 'u' }, pageKind: 'soundtrack' as const, license: 'CC BY-SA 4.0' as const, sections: [{ name: 'Telugu', tracks: [{ no: 1, title: 'Saahore Baahubali', artists: [], lyricists: [], lengthSec: 300 }] }] };
  const m = mergeSoundtrack(wiki, [], { mbReleases: mb, composers: ['M. M. Keeravani'] });
  const t = m.sections[0]!.tracks[0]!;
  assert.equal(t.confidence, 'green');
  assert.deepEqual(t.proof, { isrc: 'INA011700001', label: 'Lahari Music', upc: '8902894355133', releaseDate: '2017-04-14', release: 'Baahubali 2 (Telugu)', releaseUrl: 'https://musicbrainz.org/release/r1' });
  assert.ok(t.evidence.some((e) => e.source === 'musicbrainz'));
});

test('mergeSoundtrack: a MusicBrainz-only song is amber with its own section and language; languages are summarized', () => {
  const mb = [parseRelease(rel('r1', 'Baahubali 2 (Telugu)', 'tel', [['Song A', 200, 'I1'], ['Song B', 210, 'I2']]))];
  const m = mergeSoundtrack(null, [], { mbReleases: mb, composers: ['M. M. Keeravani'] });
  assert.equal(m.sections[0]!.name, 'MusicBrainz: Baahubali 2 (Telugu)'); assert.equal(m.sections[0]!.language, 'Telugu');
  assert.equal(m.sections[0]!.tracks[0]!.confidence, 'amber');
  assert.deepEqual(m.languages, [{ language: 'Telugu', songs: 2 }]);
});

test('linkVersions: same track number + near-identical length in releases of different languages = probable version, never same language', () => {
  const sec = (language: string, tracks: Array<[number, string, number]>): MergedSection => ({ name: `${language} album`, origin: 'catalog', language, tracks: tracks.map(([no, title, lengthSec]) => ({ key: `${language}${no}`, no, title, lengthSec, artists: [], confidence: 'amber' as const, evidence: [], links: {} })) });
  const te = sec('Telugu', [[1, 'Saahore Baahubali', 300], [2, 'Hamsa Naava', 281]]);
  const hi = sec('Hindi', [[1, 'Jai Jaikara', 301], [2, 'Hansa Nava', 250]]);
  const te2 = sec('Telugu', [[1, 'Other', 300]]);
  linkVersions([te, hi, te2]);
  assert.deepEqual(te.tracks[0]!.versions, [{ language: 'Hindi', title: 'Jai Jaikara', section: 'Hindi album' }]);
  assert.equal(hi.tracks[0]!.versions?.[0]?.language, 'Telugu');
  assert.equal(te.tracks[1]!.versions, undefined, 'length differs by 31s: not linked');
  assert.equal(te2.tracks[0]!.versions?.some((v) => v.language === 'Telugu'), false);
});

test('mbReleaseSource: searches, keeps only releases whose artist is the composer (or distinctive title), looks them up, retries 503, caches', async () => {
  const calls: string[] = [];
  let first503 = true;
  const fake = (async (u: string) => {
    calls.push(String(u));
    const url = new URL(String(u));
    if (url.pathname === '/ws/2/release') {
      return new Response(JSON.stringify({ releases: [
        { id: 'good', title: 'Baahubali 2 (Telugu)', score: 100, 'artist-credit': [{ name: 'M. M. Keeravani', artist: { name: 'M. M. Keeravani', 'sort-name': 'Keeravani, M. M.' } }], media: [{ 'track-count': 8 }] },
        { id: 'wrong', title: 'Baahubali Tribute', score: 90, 'artist-credit': [{ name: 'Some Cover Band', artist: { name: 'Some Cover Band' } }], media: [{ 'track-count': 8 }] },
        { id: 'tiny', title: 'Baahubali 2 single', score: 80, 'artist-credit': [{ name: 'M. M. Keeravani', artist: { name: 'M. M. Keeravani' } }], media: [{ 'track-count': 1 }] },
      ] }), { status: 200 });
    }
    if (url.pathname === '/ws/2/release/good') {
      if (first503) { first503 = false; return new Response('busy', { status: 503 }); }
      return new Response(JSON.stringify(rel('good', 'Baahubali 2 (Telugu)', 'tel', [['Saahore Baahubali', 300, 'I1'], ['Hamsa Naava', 281, 'I2']])), { status: 200 });
    }
    return new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  const src = mbReleaseSource('MMDE-test (x)', fake, { intervalMs: 1, backoffMs: 1 });
  const out = await src.find('Baahubali 2', [], ['M.M. Keeravaani']);
  assert.deepEqual(out.map((r) => r.id), ['good']); assert.equal(out[0]!.tracks.length, 2);
  assert.ok(!calls.some((c) => c.includes('/release/wrong') || c.includes('/release/tiny')));
  const n = calls.length; await src.find('Baahubali 2', [], ['M.M. Keeravaani']);
  assert.equal(calls.length, n, 'second call is served from the cache');
});

test('buildMergedSoundtrack: MusicBrainz result flows into the merged list; a failing MusicBrainz only marks it partial', async () => {
  const base = { wiki: async () => null, albums: async () => [], albumTracks: async () => [] };
  const mb = [parseRelease(rel('r1', 'Baahubali 2 (Telugu)', 'tel', [['Song A', 200, 'I1']]))];
  const ok = await buildMergedSoundtrack({ ...base, musicBrainz: async () => mb }, 'Baahubali 2', 2017, { composers: ['M. M. Keeravani'] });
  assert.equal(ok.counts.total, 1); assert.equal(ok.sections[0]!.tracks[0]!.proof?.isrc, 'I1'); assert.equal(ok.partial, false);
  const bad = await buildMergedSoundtrack({ ...base, wiki: async () => ({ page: { title: 'x', url: 'u' }, pageKind: 'soundtrack' as const, license: 'CC BY-SA 4.0' as const, sections: [{ name: 'A', tracks: [{ no: 1, title: 'Only Wiki', artists: [], lyricists: [], lengthSec: 100 }] }] }), musicBrainz: async () => { throw new Error('down'); } }, 'Baahubali 2', 2017, { composers: ['M. M. Keeravani'] });
  assert.equal(bad.partial, true); assert.equal(bad.counts.total, 1);
});

test('mbReleaseSource: a subtitle in the TMDB title does not hide releases named without it', async () => {
  const fake = (async (u: string) => {
    const url = new URL(String(u));
    if (url.pathname === '/ws/2/release') return new Response(JSON.stringify({ releases: [{ id: 'te1', title: 'Baahubali 2 (Telugu)', 'artist-credit': [{ name: 'M. M. Keeravani', artist: { name: 'M. M. Keeravani' } }], media: [{ 'track-count': 3 }] }] }), { status: 200 });
    return new Response(JSON.stringify(rel('te1', 'Baahubali 2 (Telugu)', 'tel', [['A', 200, 'I1'], ['B', 210, 'I2']])), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await mbReleaseSource('MMDE-test (x)', fake, { intervalMs: 1 }).find('Bāhubali 2: The Conclusion', [], ['M. M. Keeravani']);
  assert.deepEqual(out.map((r) => r.id), ['te1']);
});
