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

import { tmdbDetails } from '../src/providers/tmdb.ts';

const router = (routes: Record<string, unknown>) => (async (u: string) => {
  const path = new URL(String(u)).pathname.replace('/3/', '');
  return path in routes ? new Response(JSON.stringify(routes[path]), { status: 200 }) : new Response('{}', { status: 404 });
}) as unknown as typeof fetch;

test('movie details include its franchise films in release order, with posters', async () => {
  const f = router({
    'movie/11': { title: 'Star Wars', release_date: '1977-05-25', runtime: 121, genres: [{ name: 'Adventure' }], original_language: 'en', spoken_languages: [{ english_name: 'English' }], poster_path: '/a.jpg', belongs_to_collection: { id: 10, name: 'Star Wars Collection', poster_path: '/c.jpg' } },
    'collection/10': { parts: [{ id: 140607, title: 'The Force Awakens', release_date: '2015-12-15' }, { id: 11, title: 'Star Wars', release_date: '1977-05-25' }, { id: 1893, title: 'The Phantom Menace', release_date: '1999-05-19' }] },
  });
  const d = await tmdbDetails('tmdb-movie-11', 't', f);
  assert.equal(d.kind, 'movie'); assert.equal(d.year, 1977); assert.equal(d.runtimeMin, 121);
  assert.deepEqual(d.spokenLanguages, ['English']);
  assert.equal(d.collection?.id, 'tmdb-collection-10');
  assert.deepEqual(d.parts?.map((p) => p.title), ['Star Wars', 'The Phantom Menace', 'The Force Awakens']);
  assert.equal(d.parts?.[0]?.id, 'tmdb-movie-11');
});

test('collection details list films by release date; a missing franchise list does not break a movie', async () => {
  const c = await tmdbDetails('tmdb-collection-10', 't', router({ 'collection/10': { name: 'Star Wars Collection', poster_path: '/c.jpg', parts: [{ id: 2, title: 'B', release_date: '2000-01-01' }, { id: 1, title: 'A', release_date: '1990-01-01' }, { id: 3, title: 'No date' }] } }));
  assert.deepEqual(c.parts?.map((p) => p.title), ['A', 'B', 'No date']);
  const m = await tmdbDetails('tmdb-movie-5', 't', router({ 'movie/5': { title: 'X', belongs_to_collection: { id: 9, name: 'Y' } } }));
  assert.equal(m.title, 'X'); assert.equal(m.collection?.name, 'Y'); assert.equal(m.parts, undefined);
});

test('tv details carry season posters and overviews; bad ids are rejected', async () => {
  const t = await tmdbDetails('tmdb-tv-37430', 't', router({ 'tv/37430': { name: 'Slime', first_air_date: '2018-10-02', seasons: [{ season_number: 0, name: 'Specials', episode_count: 16 }, { season_number: 1, name: 'Season 1', episode_count: 24, poster_path: '/s1.jpg', overview: 'Satoru...', vote_average: 8.2 }] } }));
  assert.equal(t.seasons?.length, 2); assert.equal(t.seasons?.[1]?.posterPath, '/s1.jpg');
  await assert.rejects(tmdbDetails('tmdb-tv-../x', 't', router({})), /invalid id/);
});

import { segmentQuery } from '../src/providers/tmdb.ts';

test('segmentQuery splits joined titles but leaves unknown words alone', () => {
  assert.equal(segmentQuery('starwars'), 'star wars');
  assert.equal(segmentQuery('spiderman'), 'spider man');
  assert.equal(segmentQuery('attackontitan'), 'attack on titan');
  assert.equal(segmentQuery('jujutsukaisen'), 'jujutsu kaisen');
  assert.equal(segmentQuery('bahubali'), undefined);
  assert.equal(segmentQuery('naruto'), undefined, 'a single known word is not a split');
  assert.equal(segmentQuery('star wars'), undefined, 'already spaced');
});

test('"starwars" also searches "star wars" and ranks the franchise first; deep returns more', async () => {
  const seen: string[] = [];
  const f = (async (u: string) => {
    const url = new URL(String(u)); const q = url.searchParams.get('query');
    seen.push(`${url.pathname.split('/').pop()}:${q}:${url.searchParams.get('page')}`);
    if (q !== 'star wars') return new Response(JSON.stringify({ results: [] }), { status: 200 });
    const body = url.pathname.endsWith('collection') ? { results: [{ id: 10, name: 'Star Wars Collection' }] }
      : url.pathname.endsWith('movie') ? { results: [{ id: 11, title: 'Star Wars', popularity: 90 }] } : { results: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await tmdbResolver('t', f).search('starwars');
  assert.deepEqual(out.map((x) => x.title), ['Star Wars', 'Star Wars Collection']);
  assert.ok(seen.includes('movie:star wars:1'));
  seen.length = 0;
  await tmdbResolver('t', f).search('starwars', { deep: true });
  assert.ok(seen.some((x) => x.endsWith(':2')), 'deep fetches page 2');
});

test('tmdbDetails: composers and alternate titles come back with the details (movie and tv shapes)', async () => {
  const movie = await tmdbDetails('tmdb-movie-5', 't', router({ 'movie/5': { title: 'Kingdom', original_title: 'కింగ్‌డమ్', credits: { crew: [{ name: 'Anirudh Ravichander', job: 'Original Music Composer' }, { name: 'Someone', job: 'Director' }, { name: 'Anirudh Ravichander', job: 'Music' }] }, alternative_titles: { titles: [{ title: 'Kingdom Telugu' }, { title: 'Kingdom' }] } } }));
  assert.deepEqual(movie.composers, ['Anirudh Ravichander']);
  assert.deepEqual(movie.altTitles, ['కింగ్‌డమ్', 'Kingdom Telugu'], 'duplicates of the main title dropped');
  const tv = await tmdbDetails('tmdb-tv-6', 't', router({ 'tv/6': { name: 'That Time I Got Reincarnated as a Slime', original_name: '転生したらスライムだった件', aggregate_credits: { crew: [{ name: 'Hitoshi Hanagata', jobs: [{ job: 'Original Music Composer' }] }, { name: 'X', jobs: [{ job: 'Producer' }] }] }, alternative_titles: { results: [{ title: 'Tensei shitara Slime Datta Ken' }] } } }));
  assert.deepEqual(tv.composers, ['Hitoshi Hanagata']);
  assert.deepEqual(tv.altTitles, ['転生したらスライムだった件', 'Tensei shitara Slime Datta Ken']);
});

import { fuzzyByWords } from '../src/providers/tmdb.ts';
test('"irregular high" finds "The Irregular at Magic High School" by searching words separately', async () => {
  const f = (async (u: string) => {
    const q = new URL(String(u)).searchParams.get('query');
    const tv = String(u).includes('/search/tv');
    const results = q === 'irregular' && tv ? [{ id: 1, name: 'The Irregular at Magic High School', popularity: 40, original_language: 'ja' }, { id: 2, name: 'Irregular Hunter', popularity: 90 }]
      : q === 'high' && tv ? [{ id: 3, name: 'High School DxD', popularity: 70 }, { id: 1, name: 'The Irregular at Magic High School', popularity: 40 }] : [];
    return new Response(JSON.stringify({ results }), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await tmdbResolver('t', f).search('irregular high');
  assert.equal(out[0]?.title, 'The Irregular at Magic High School', 'contains both words, so it outranks single-word matches');
  assert.ok(!out.some((m) => m.title === 'High School DxD' && out.indexOf(m) === 0));
  assert.deepEqual(await fuzzyByWords('naruto', (async () => []) as never), [], 'single-word queries are not fuzzed');
});
