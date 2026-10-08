import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discover } from '../src/app/discover.ts';
import { evaluate, type GroundTruthTrack } from '../src/app/evaluate.ts';
import { curatedProvider, loadSeed } from '../src/providers/curated.ts';

const here = (p: string) => new URL(p, import.meta.url).pathname;

test('seed and ground truth agree (no false positives, nothing missed)', async () => {
  const seed = await loadSeed(here('../data/seeds/slime.sample.json'));
  const truth = JSON.parse(await readFile(here('../data/ground-truth/slime.s1.json'), 'utf8')).tracks as GroundTruthTrack[];
  const { tracks } = await discover(seed.media, [curatedProvider(seed)]);
  const ev = evaluate(tracks, truth, { includeUnverified: true });
  assert.equal(ev.falsePositives.length, 0);
  assert.equal(ev.precision, 1);
  assert.deepEqual(ev.missed, []);
  assert.equal(ev.recall, 1);
});

test('unverified tracks do not count as shown by default', async () => {
  const seed = await loadSeed(here('../data/seeds/slime.sample.json'));
  const truth = JSON.parse(await readFile(here('../data/ground-truth/slime.s1.json'), 'utf8')).tracks as GroundTruthTrack[];
  const { tracks } = await discover(seed.media, [curatedProvider(seed)]);
  const ev = evaluate(tracks, truth);
  assert.equal(ev.recall, 0); // nothing is above "unverified" offline
  assert.equal(ev.precision, 1); // vacuous: nothing shown
});
