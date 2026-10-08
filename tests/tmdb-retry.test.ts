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

import { parseQuery } from '../src/providers/tmdb.ts';

test('parseQuery pulls out language, type and year hints, tolerating one typo', () => {
  assert.deepEqual(parseQuery('og telugu mmovie'), { text: 'og', type: 'movie', lang: 'te', year: undefined, hinted: true });
  assert.equal(parseQuery('slime anime').anime, true);
  assert.equal(parseQuery('they call him og').hinted, false);
  assert.equal(parseQuery('Blade Runner 2049').hinted, false, '2049 is a title, not a year');
  const y = parseQuery('kalki hindi film 2024');
  assert.equal(y.text, 'kalki'); assert.equal(y.lang, 'hi'); assert.equal(y.year, 2024); assert.equal(y.type, 'movie');
  assert.equal(parseQuery('movie').hinted, false, 'a query that is only hints is searched as typed');
});

test('"og telugu mmovie" finds the Telugu movie even though TMDB cannot match the raw text', async () => {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(String(u));
    const q = new URL(String(u)).searchParams.get('query');
    const isMovie = String(u).includes('/search/movie');
    const results = q === 'og' && isMovie
      ? [{ id: 1, title: 'Hindi OG Thing', original_language: 'hi', popularity: 90 }, { id: 2, title: 'They Call Him OG', original_language: 'te', popularity: 50, release_date: '2025-09-25' }]
      : [];
    return new Response(JSON.stringify({ results }), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await tmdbResolver('t', f).search('og telugu mmovie');
  assert.equal(out[0]?.title, 'They Call Him OG');
  assert.equal(out[0]?.originalLanguage, 'te');
  assert.ok(urls.some((u) => u.includes('/search/movie') && u.includes('query=og&')), 'searched the cleaned text');
  assert.ok(urls.some((u) => u.includes('query=og%20telugu%20mmovie')), 'also searched what was typed');
});

test('search still answers when only some TMDB requests fail', async () => {
  let n = 0;
  const f = (async () => { if (n++ % 2 === 0) throw new TypeError('fetch failed'); return new Response(JSON.stringify({ results: [{ id: 5, title: 'Naruto', original_language: 'ja' }] }), { status: 200 }); }) as unknown as typeof fetch;
  const out = await tmdbResolver('t', f).search('naruto');
  assert.ok(out.length >= 1);
});

test('"slime anime" puts the Japanese animated series above an unrelated exact-title movie', () => {
  const tensura: Media = { ...m('t', 'tv', 'That Time I Got Reincarnated as a Slime', 120), originalLanguage: 'ja', animation: true };
  const horror: Media = { ...m('h', 'movie', 'Slime', 3), originalLanguage: 'en' };
  const other: Media = { ...m('o', 'tv', 'Slime Chef', 30), originalLanguage: 'es' };
  const out = rankByQuery([horror, other, tensura], 'slime anime', { alt: 'slime', anime: true });
  assert.equal(out[0]?.id, 't');
  // without the anime hint the exact title still leads
  assert.equal(rankByQuery([other, tensura, horror], 'slime')[0]?.id, 'h');
});

test('"bahubali hindi" keeps the original (Telugu) film instead of dropping it', async () => {
  const f = (async (u: string) => {
    const q = new URL(String(u)).searchParams.get('query');
    const isMovie = String(u).includes('/search/movie');
    const results = q === 'bahubali' && isMovie
      ? [{ id: 1, title: 'Baahubali: The Beginning', original_language: 'te', popularity: 80 }, { id: 2, title: 'Bahubali Parody', original_language: 'hi', popularity: 2 }]
      : [];
    return new Response(JSON.stringify({ results }), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await tmdbResolver('t', f).search('bahubali hindi');
  assert.deepEqual(out.map((x) => x.title).slice(0, 2), ['Baahubali: The Beginning', 'Bahubali Parody']);
});
