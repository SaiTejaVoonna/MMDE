import test from 'node:test';
import assert from 'node:assert/strict';
import { musicBrainzResolver, sortNameToName } from '../src/providers/musicbrainz.ts';

const FAST = { intervalMs: 0, backoffMs: 1 };
const rec = (o: object = {}) => ({ id: 'mb1', title: 'Nameless Story', length: 240000, isrcs: ['JP1'], 'artist-credit': [{ name: '寺島拓篤', artist: { name: '寺島拓篤', 'sort-name': 'Terashima, Takuma' } }], ...o });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('sortNameToName flips "Last, First"', () => {
  assert.equal(sortNameToName('Terashima, Takuma'), 'Takuma Terashima');
  assert.equal(sortNameToName('TRUE'), 'TRUE');
});

test('maps credits to names plus a Latin sort-name variant, with ISRCs and duration', async () => {
  const f = (async () => reply({ recordings: [rec()] })) as unknown as typeof fetch;
  const [c] = await musicBrainzResolver(null, f, FAST).resolve('Nameless Story', ['Takuma Terashima']);
  assert.ok(c!.artists.includes('寺島拓篤') && c!.artists.includes('Takuma Terashima'));
  assert.equal(c!.durationSec, 240);
  assert.deepEqual(c!.isrcs, ['JP1']);
});

test('retries by title only when the artist-constrained search finds nothing', async () => {
  const urls: string[] = [];
  const f = (async (u: string) => { urls.push(decodeURIComponent(String(u))); return reply({ recordings: urls.length === 1 ? [] : [rec()] }); }) as unknown as typeof fetch;
  const out = await musicBrainzResolver(null, f, FAST).resolve('Nameless Story', ['Takuma Terashima']);
  assert.equal(urls.length, 2);
  assert.match(urls[0]!, /AND artist:"Takuma Terashima"/);
  assert.ok(!urls[1]!.includes('artist:'));
  assert.equal(out.length, 1);
});

test('backs off and retries on 503, then succeeds', async () => {
  let n = 0;
  const f = (async () => (++n < 3 ? reply({}, 503) : reply({ recordings: [rec()] }))) as unknown as typeof fetch;
  const out = await musicBrainzResolver(null, f, FAST).resolve('Nameless Story', []);
  assert.equal(n, 3);
  assert.equal(out.length, 1);
});

test('gives up with an error after repeated 503s', async () => {
  const f = (async () => reply({}, 503)) as unknown as typeof fetch;
  await assert.rejects(() => musicBrainzResolver(null, f, FAST).resolve('X', []), /HTTP 503 from MusicBrainz/);
});

test('sets a User-Agent only when given one (browsers cannot)', async () => {
  const seen: Array<Record<string, string>> = [];
  const f = (async (_u: string, init: RequestInit) => { seen.push(init.headers as Record<string, string>); return reply({ recordings: [] }); }) as unknown as typeof fetch;
  await musicBrainzResolver('UA/1', f, FAST).resolve('X', []);
  await musicBrainzResolver(null, f, FAST).resolve('X', []);
  assert.equal(seen[0]!['User-Agent'], 'UA/1');
  assert.equal('User-Agent' in seen[1]!, false);
});
