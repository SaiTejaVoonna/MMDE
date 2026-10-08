import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyVersion, normalizeTitle, normalizeArtist } from '../src/matching/normalize.ts';
import { scoreMatch, bestMatch } from '../src/matching/match.ts';
import type { RecordingCandidate, TrackClaim } from '../src/domain/types.ts';

const ev = { provider: 't', fetchedAt: '1970-01-01T00:00:00.000Z' };
const claim = (title: string, artists: string[], extra: Partial<TrackClaim> = {}): TrackClaim => ({
  part: { kind: 'season', number: 1 }, role: 'opening', title, artists, evidence: ev, ...extra,
});
const rec = (title: string, artists: string[], extra: Partial<RecordingCandidate> = {}): RecordingCandidate => ({
  title, artists, isrcs: [], source: 'test', ...extra,
});

test('normalizeTitle strips qualifiers and punctuation', () => {
  assert.equal(normalizeTitle('Nameless Story (TV Size)'), 'nameless story');
  assert.equal(normalizeTitle('Little Soldier - Instrumental'), 'little soldier');
  assert.equal(normalizeTitle('Another colony!'), 'another colony');
});

test('normalizeArtist drops featuring credits', () => {
  assert.equal(normalizeArtist('ALI feat. Someone'), 'ali');
});

test('classifyVersion', () => {
  assert.equal(classifyVersion('Song (TV Size)'), 'tv_size');
  assert.equal(classifyVersion('Song (Instrumental)'), 'instrumental');
  assert.equal(classifyVersion('Song', 'live at Budokan'), 'live');
  assert.equal(classifyVersion('Song'), 'original');
});

test('exact title + artist scores high', () => {
  const r = scoreMatch(claim('Nameless Story', ['Takuma Terashima']), rec('Nameless Story', ['Takuma Terashima']));
  assert.ok(r.score >= 0.9, String(r.score));
});

test('same title, different artist can never confirm', () => {
  const r = scoreMatch(claim('Storyteller', ['Takuma Terashima']), rec('Storyteller', ['Some Other Band']));
  assert.ok(r.score <= 0.5, String(r.score));
});

test('version mismatch is a hard reject (instrumental vs original)', () => {
  const r = scoreMatch(claim('Little Soldier', ['Azusa Tadokoro']), rec('Little Soldier (Instrumental)', ['Azusa Tadokoro']));
  assert.equal(r.versionCompatible, false);
  assert.equal(r.score, 0);
});

test('TV-size claim is not penalised for a long full-length duration', () => {
  const r = scoreMatch(
    claim('Nameless Story (TV Size)', ['Takuma Terashima'], { durationSec: 90 }),
    rec('Nameless Story (TV Size)', ['Takuma Terashima'], { durationSec: 91 }),
  );
  assert.ok(r.score >= 0.9);
});

test('large duration gap lowers the score', () => {
  const near = scoreMatch(claim('A', ['B'], { durationSec: 240 }), rec('A', ['B'], { durationSec: 241 }));
  const far = scoreMatch(claim('A', ['B'], { durationSec: 90 }), rec('A', ['B'], { durationSec: 240 }));
  assert.ok(far.score < near.score);
});

test('bestMatch skips version-incompatible candidates', () => {
  const m = bestMatch(claim('Song', ['X']), [rec('Song (Live)', ['X']), rec('Song', ['X'])]);
  assert.equal(m?.candidate.title, 'Song');
});

test('romanized artist matches via sort-name variant and swapped name order', () => {
  const c = claim('Nameless Story', ['Takuma Terashima']);
  const viaSortName = scoreMatch(c, rec('Nameless Story', ['寺島拓篤', 'Takuma Terashima']));
  assert.ok(viaSortName.score >= 0.9, String(viaSortName.score));
  const swapped = scoreMatch(c, rec('Nameless Story', ['Terashima Takuma']));
  assert.ok(swapped.score >= 0.9, String(swapped.score));
  const wrong = scoreMatch(c, rec('Nameless Story', ['寺島拓篤']));
  assert.ok(wrong.score <= 0.5, 'a Japanese-only credit still cannot confirm on title alone: ' + wrong.score);
});
