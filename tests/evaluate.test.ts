import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discover } from '../src/app/discover.ts';
import { evaluate, type GroundTruthTrack } from '../src/app/evaluate.ts';
import { curatedProvider, loadSeed } from '../src/providers/curated.ts';

const here = (p: string) => new URL(p, import.meta.url).pathname;

test('every seed claim appears in the ground truth (seed has no false positives)', async () => {
  const seed = await loadSeed(here('../data/seeds/slime.sample.json'));
  const truth = JSON.parse(await readFile(here('../data/ground-truth/slime.s1.json'), 'utf8')).tracks as GroundTruthTrack[];
  const { tracks } = await discover(seed.media, [curatedProvider(seed)]);
  const ev = evaluate(tracks, truth, { includeUnverified: true });
  assert.equal(ev.falsePositives.length, 0);
  assert.equal(ev.precision, 1);
  // The seed misses the one insert song; the evaluator must report it as missed.
  assert.deepEqual(ev.missed.map((m) => m.title), ['Boku no Naka no Kimi e']);
  assert.equal(ev.recall, 0.8);
});

test('unverified tracks do not count as shown by default', async () => {
  const seed = await loadSeed(here('../data/seeds/slime.sample.json'));
  const truth = JSON.parse(await readFile(here('../data/ground-truth/slime.s1.json'), 'utf8')).tracks as GroundTruthTrack[];
  const { tracks } = await discover(seed.media, [curatedProvider(seed)]);
  const ev = evaluate(tracks, truth);
  assert.equal(ev.recall, 0); // nothing is above "unverified" offline
  assert.equal(ev.precision, 1); // vacuous: nothing shown
});
