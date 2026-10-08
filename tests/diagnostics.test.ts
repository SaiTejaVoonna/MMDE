import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnostics } from '../src/browser/diagnostics.ts';
import type { DiscoveryResult } from '../src/domain/types.ts';

const ev = { provider: 'wikipedia+llm', url: 'https://en.wikipedia.org/wiki/X', quote: 'x'.repeat(500), fetchedAt: '2026-10-08T00:00:00.000Z' };
const result: DiscoveryResult = {
  media: { id: 'm1', type: 'anime', title: 'Show', altTitles: [], year: 2020, externalIds: { anilist: '1' } },
  tracks: [
    { id: 't1', part: { kind: 'season', number: 1 }, role: 'opening', position: 'OP1', title: 'Song A', artists: ['Eve'], version: 'original', confidence: 0.62, matchScore: 0.95, matchNote: '3 candidates; top "Song A" - Eve score 0.95 (title 1.00, artist 1.00)', status: 'suggested', evidence: [ev], recording: { title: 'Song A', artists: ['Eve'], isrcs: ['JP123'], mbid: 'mb-1', source: 'musicbrainz' }, links: [{ platform: 'deezer', url: 'https://deezer/1', kind: 'resolved' }, { platform: 'spotify', url: 'https://s', kind: 'search' }] },
    { id: 't2', part: { kind: 'season', number: 1 }, role: 'ending', title: 'Song B', artists: [], version: 'original', confidence: 0.3, status: 'unverified', evidence: [], links: [] },
  ],
  releases: [{ title: 'OST', artists: ['Comp'], kind: 'ost', trackCount: 46, evidence: { provider: 'curated-seed', fetchedAt: 'x' } }],
  errors: ['musicbrainz: HTTP 503 from MusicBrainz', 'wikipedia+llm (releases): boom', 'stray: something'],
  sources: ['curated-seed', 'musicbrainz', 'wikipedia+llm'],
  generatedAt: '2026-10-08T00:00:01.000Z',
};
const out = buildDiagnostics(result, { modeLabel: 'direct in browser', live: true, hasApiKey: true, now: '2026-10-08T00:00:02.000Z', lastSearch: { query: 'show', sources: ['local-seeds', 'anilist'], errors: ['anilist: HTTP 429'], count: 2 } });

test('includes media, mode, search, providers and errors', () => {
  assert.match(out, /MEDIA: Show \(anime, 2020\) id=m1/);
  assert.match(out, /mode: direct in browser/);
  assert.match(out, /LAST SEARCH: "show" -> 2 results .*anilist: HTTP 429/);
  assert.match(out, /- curated-seed: no error reported/);
  assert.match(out, /- musicbrainz: ERRORS: musicbrainz: HTTP 503/);
  assert.match(out, /- wikipedia\+llm: ERRORS: wikipedia\+llm \(releases\): boom/);
  assert.match(out, /other errors: stray: something/);
});

test('lists every track with status, ids, evidence and link resolution', () => {
  assert.match(out, /TRACKS: 2 total; confirmed 0, suggested 1, unverified 1/);
  assert.match(out, /\[suggested\] season 1 \/ opening OP1: "Song A" - Eve .*matchScore=0\.95 \| mbid=mb-1 isrc=JP123/);
  assert.match(out, /\[unverified\] season 1 \/ ending: "Song B" - unknown .*no recording match/);
  assert.match(out, /links: resolved=deezer/);
  assert.match(out, /links: all search links/);
  assert.match(out, /RELEASES: 1[\s\S]*ost "OST".*46 tracks/);
});

test('shows why a recording did or did not match', () => {
  assert.match(out, /match: 3 candidates; top "Song A" - Eve score 0\.95/);
});

test('clips long quotes and never contains an API key', () => {
  assert.ok(!out.includes('x'.repeat(250)));
  assert.match(out, /AI extractor key set: yes/);
  assert.ok(!/sk-/.test(out));
});
