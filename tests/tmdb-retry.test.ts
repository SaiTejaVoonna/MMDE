import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRetry, tmdbResolver } from '../src/providers/tmdb.ts';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

test('fetchRetry survives connection resets, then succeeds', async () => {
  let calls = 0;
  const flaky = (async () => { calls++; if (calls < 3) throw new TypeError('fetch failed'); return ok({}); }) as typeof fetch;
  const res = await fetchRetry(flaky, 'https://x', {}, 3, 1);
  assert.equal(res.status, 200);
  assert.equal(calls, 3);
});

test('fetchRetry gives up after the last try and does not retry 4xx', async () => {
  let calls = 0;
  const dead = (async () => { calls++; throw new TypeError('fetch failed'); }) as typeof fetch;
  await assert.rejects(fetchRetry(dead, 'https://x', {}, 3, 1), /fetch failed/);
  assert.equal(calls, 3);
  let c2 = 0;
  const unauthorized = (async () => { c2++; return new Response('{}', { status: 401 }); }) as typeof fetch;
  assert.equal((await fetchRetry(unauthorized, 'https://x', {}, 3, 1)).status, 401);
  assert.equal(c2, 1);
});

test('tmdbResolver search recovers from one reset', async () => {
  let n = 0;
  const f = (async (u: string) => {
    if (n++ === 0) throw new TypeError('fetch failed');
    return ok({ results: String(u).includes('/search/tv') ? [{ id: 1, name: 'Slime' }] : [] });
  }) as unknown as typeof fetch;
  const out = await tmdbResolver('t', f).search('slime');
  assert.equal(out[0]?.title, 'Slime');
});

import { rankByQuery } from '../src/providers/tmdb.ts';
import { mergeMediaResults } from '../src/app/media.ts';
import type { Media } from '../src/domain/types.ts';
const m = (id: string, type: Media['type'], title: string, popularity = 0): Media => ({ id, type, title, altTitles: [], externalIds: {}, popularity });

test('search ranking: exact title, then prefix, then rest by popularity', () => {
  const out = rankByQuery([m('a', 'tv', 'Fire Force Season Guide', 90), m('b', 'tv', 'Something else', 99), m('c', 'tv', 'Fire Force', 5), m('d', 'movie', 'Fire Force Movie', 50)], 'fire force');
  assert.deepEqual(out.map((x) => x.id), ['c', 'a', 'd', 'b']);
});

test('a movie and a series with the same title are not merged', () => {
  const out = mergeMediaResults([m('tv1', 'tv', 'Frozen'), m('mv1', 'movie', 'Frozen'), m('seed', 'anime', 'Frozen')]);
  assert.deepEqual(out.map((x) => x.id).sort(), ['mv1', 'tv1']);
});
