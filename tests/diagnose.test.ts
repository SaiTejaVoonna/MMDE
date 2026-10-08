import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { diagnoseTitle } from '../src/app/diagnose.ts';
import { curatedProvider, loadSeed } from '../src/providers/curated.ts';
import { seedMediaResolver } from '../src/providers/seedResolver.ts';
import type { MediaResolver } from '../src/providers/types.ts';

const seedPath = fileURLToPath(new URL('../data/seeds/slime.sample.json', import.meta.url));
const NOW = '2026-10-08T00:00:00.000Z';

test('diagnoseTitle runs search -> discover -> diagnostics text', async () => {
  const seed = await loadSeed(seedPath);
  const d = await diagnoseTitle('slime', { mediaResolvers: [seedMediaResolver([seed])], run: { providers: [curatedProvider(seed)], linkResolvers: [] }, modeLabel: 'test', now: () => NOW });
  assert.equal(d.summary.tracks, 5);
  assert.equal(d.summary.unverified, 5);
  assert.match(d.text, /MEDIA: That Time I Got Reincarnated as a Slime/);
  assert.match(d.text, /LAST SEARCH: "slime" -> 1 results/);
  assert.match(d.text, /- curated-seed: no error reported/);
});

test('a failing media resolver is reported, not thrown', async () => {
  const boom: MediaResolver = { name: 'anilist', async search() { throw new Error('HTTP 429 from AniList'); } };
  const d = await diagnoseTitle('jujutsu kaisen', { mediaResolvers: [boom], run: { providers: [], linkResolvers: [] }, modeLabel: 'test', now: () => NOW });
  assert.equal(d.summary.title, '(no results)');
  assert.equal(d.summary.errors, 1);
  assert.match(d.text, /anilist: HTTP 429 from AniList/);
});
