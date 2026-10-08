import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/query.js';
import { baseKey, norm } from '../src/text.js';
import { collapseSeasons, getAniListFranchise, mapAniListMedia, searchAniList } from '../src/sources/anilist.js';
import { inferKind, inferLanguage, mapWikipediaPages, searchWikipedia } from '../src/sources/wikipedia.js';
import { mapTmdb, searchTmdb, getTmdbSeasons } from '../src/sources/tmdb.js';
import { getDetail, mergeResults, searchAll } from '../src/search.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

// ---- realistic fixtures (shapes follow the AniList / MediaWiki / TMDB docs) ----
const slimeMedia = (id, eng, romaji, year, format = 'TV', syn = []) => ({ id, idMal: id, title: { romaji, english: eng, native: 'x' }, synonyms: syn, format, episodes: 24, status: 'FINISHED', seasonYear: year, startDate: { year }, coverImage: { medium: 'https://img/x.jpg' }, description: 'A <b>salaryman</b> is reincarnated.', countryOfOrigin: 'JP' });
const ANI_SEARCH = { data: { Page: { media: [
  slimeMedia(101280, 'That Time I Got Reincarnated as a Slime', 'Tensei shitara Slime Datta Ken', 2018, 'TV', ['Tensura']),
  slimeMedia(108511, 'That Time I Got Reincarnated as a Slime Season 2', 'Tensei shitara Slime Datta Ken 2nd Season', 2021),
  slimeMedia(116742, 'That Time I Got Reincarnated as a Slime Season 2 Part 2', 'Tensei shitara Slime Datta Ken 2nd Season Part 2', 2021),
] } } };
const WIKI_SEARCH = { query: { pages: {
  '3': { pageid: 3, index: 2, title: 'Slime (toy)', description: 'Toy' },
  '1': { pageid: 1, index: 1, title: 'That Time I Got Reincarnated as a Slime', description: 'Japanese light novel series', thumbnail: { source: 'https://upload.wikimedia.org/a.jpg' } },
  '2': { pageid: 2, index: 3, title: 'They Call Him OG', description: '2025 Indian Telugu-language action film directed by Sujeeth' },
  '4': { pageid: 4, index: 4, title: 'Baahubali: The Beginning', description: '2015 Indian epic action film directed by S. S. Rajamouli' },
} } };

test('parseQuery pulls language/type hints out of the title', () => {
  assert.deepEqual(parseQuery('og telugu movie'), { original: 'og telugu movie', text: 'og', lang: 'telugu', type: 'movie' });
  assert.equal(parseQuery('Tensura').text, 'Tensura');
  assert.deepEqual([parseQuery('anime').text, parseQuery('anime').type], ['anime', null]); // hint-only query stays a title search
  assert.equal(parseQuery('bahubali film').type, 'movie');
});

test('baseKey collapses seasons and qualifiers', () => {
  assert.equal(baseKey('That Time I Got Reincarnated as a Slime Season 2 Part 2'), baseKey('That Time I Got Reincarnated as a Slime'));
  assert.equal(baseKey('Slime 2nd Season'), 'slime');
  assert.equal(baseKey('That Time I Got Reincarnated as a Slime'), 'that time i got reincarnated as a slime');
  assert.equal(baseKey('Baahubali (film)'), 'baahubali');
  assert.equal(norm('  Café  Ünï '), 'cafe uni');
});

test('AniList: maps media, strips HTML, collapses seasons to one card per franchise', async () => {
  const f = async () => json(ANI_SEARCH);
  const items = await searchAniList('slime', f);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'That Time I Got Reincarnated as a Slime');
  assert.equal(items[0].year, 2018);
  assert.ok(items[0].altTitles.includes('Tensura'));
  assert.ok(!/</.test(items[0].description));
  assert.equal(mapAniListMedia(ANI_SEARCH.data.Page.media[0]).anilistId, 101280);
  assert.equal(collapseSeasons([]).length, 0);
});

test('AniList franchise: walks prequel/sequel chain into seasons, movies and specials in date order', async () => {
  const n = (id, fmt, year, month = 1, rels = []) => ({ id, title: { romaji: `Slime ${id}`, english: `Slime ${id}` }, format: fmt, episodes: 12, status: 'FINISHED', startDate: { year, month, day: 1 }, coverImage: { medium: null }, type: 'ANIME', relations: { edges: rels } });
  const edge = (relationType, node) => ({ relationType, node: { id: node.id, type: 'ANIME', title: node.title, format: node.format, episodes: 12, status: 'FINISHED', startDate: node.startDate, coverImage: { medium: null } } });
  const S1 = n(1, 'TV', 2018, 10), S2 = n(2, 'TV', 2021, 1), S2b = n(3, 'TV', 2021, 7), S3 = n(4, 'TV', 2024, 4), MOV = n(5, 'MOVIE', 2022, 11), OVA = n(6, 'OVA', 2019, 1);
  const graph = {
    1: [edge('SEQUEL', S2), edge('SIDE_STORY', OVA)], 2: [edge('PREQUEL', S1), edge('SEQUEL', S2b), edge('SIDE_STORY', MOV)],
    3: [edge('PREQUEL', S2), edge('SEQUEL', S3)], 4: [edge('PREQUEL', S2b)], 5: [], 6: [],
  };
  const all = { 1: S1, 2: S2, 3: S2b, 4: S3 };
  let calls = 0;
  const f = async (_u, init) => {
    calls++;
    const ids = JSON.parse(init.body).variables.ids;
    return json({ data: { Page: { media: ids.filter((i) => all[i]).map((i) => ({ ...all[i], relations: { edges: graph[i] } })) } } });
  };
  const fr = await getAniListFranchise(2, f);
  assert.deepEqual(fr.seasons.map((s) => s.id), [1, 2, 3, 4]);
  assert.deepEqual(fr.movies.map((s) => s.id), [5]);
  assert.deepEqual(fr.other.map((s) => s.id), [6]);
  assert.ok(calls <= 5, `calls=${calls}`);
});

test('Wikipedia: orders by rank, drops non-works (toy), infers kind/year/language', () => {
  const r = mapWikipediaPages(WIKI_SEARCH.query.pages);
  assert.deepEqual(r.map((x) => x.title), ['That Time I Got Reincarnated as a Slime', 'They Call Him OG', 'Baahubali: The Beginning']);
  assert.equal(r[1].kind, 'movie');
  assert.equal(r[1].year, 2025);
  assert.equal(r[1].language, 'Telugu');
  assert.equal(inferKind('2012 Japanese anime television series'), 'anime');
  assert.equal(inferKind('American television series'), 'tv');
  assert.equal(inferLanguage('Indian Hindi-language film'), 'Hindi');
});

test('Wikipedia: query includes language and type hints', async () => {
  let url = '';
  await searchWikipedia({ text: 'og', lang: 'telugu', type: 'movie' }, async (u) => { url = decodeURIComponent(String(u)).replace(/\+/g, ' '); return json({ query: { pages: {} } }); });
  assert.match(url, /gsrsearch=og telugu film/);
  assert.match(url, /origin=\*/);
});

test('TMDB: maps results, rejects bad keys, lists TV seasons', async () => {
  const r = mapTmdb({ media_type: 'movie', id: 1, title: 'Baahubali', original_title: 'బాహుబలి', release_date: '2015-07-10', original_language: 'te', poster_path: '/p.jpg', overview: 'x' });
  assert.deepEqual([r.kind, r.year, r.language], ['movie', 2015, 'te']);
  assert.rejects(() => searchTmdb('x', 'bad', async () => json({}, 401)), /rejected the API key/);
  const out = await searchTmdb('x', 'k', async () => json({ results: [{ media_type: 'person', id: 9 }, { media_type: 'tv', id: 2, name: 'Show', first_air_date: '2020-01-01' }] }));
  assert.equal(out.length, 1);
  const seasons = await getTmdbSeasons(2, 'k', async () => json({ seasons: [{ id: 1, name: 'Season 1', season_number: 1, episode_count: 10, air_date: '2020-01-01' }] }));
  assert.deepEqual(seasons[0].episodes, 10);
});

test('searchAll: merges AniList + Wikipedia into one Slime card, ranks exact/alias first, reports every source', async () => {
  const f = async (u) => String(u).includes('anilist') ? json(ANI_SEARCH) : json(WIKI_SEARCH);
  const out = await searchAll('tensura', { fetchImpl: f });
  assert.equal(out.results[0].title, 'That Time I Got Reincarnated as a Slime');
  assert.ok(out.results[0].sources.anilist && out.results[0].sources.wikipedia, 'merged sources');
  assert.equal(out.results.filter((r) => /slime/i.test(r.title)).length, 1, 'no duplicate Slime cards');
  assert.deepEqual(out.notes.filter((n) => n.ok && !n.skipped).map((n) => n.source), ['AniList', 'Wikipedia']);
});

test('searchAll: "og telugu movie" skips AniList and finds OG', async () => {
  const urls = [];
  const f = async (u) => { urls.push(String(u)); return json(WIKI_SEARCH); };
  const out = await searchAll('og telugu movie', { fetchImpl: f });
  assert.ok(urls.every((u) => !u.includes('anilist')), 'AniList not called for a Telugu query');
  assert.equal(out.results[0].title, 'They Call Him OG');
  assert.equal(out.parsed.lang, 'telugu');
});

test('searchAll: one failing source never hides the others and is reported', async () => {
  const baah = { query: { pages: { 4: { pageid: 4, index: 1, title: 'Baahubali: The Beginning', description: '2015 Indian epic action film directed by S. S. Rajamouli' }, 5: { pageid: 5, index: 2, title: 'Baahubali 2: The Conclusion', description: '2017 Indian epic action film' } } } };
  const f = async (u) => (String(u).includes('anilist') ? json({}, 429) : json(baah));
  const out = await searchAll('bahubali', { fetchImpl: f });
  assert.equal(out.results[0].title, 'Baahubali: The Beginning');
  const ani = out.notes.find((n) => n.source === 'AniList');
  assert.equal(ani.ok, false);
  assert.match(ani.error, /429/);
});

test('mergeResults keeps richest fields', () => {
  const m = mergeResults([[{ id: 'a', kind: 'anime', title: 'X', sources: { anilist: 'u' }, poster: 'p' }], [{ id: 'b', kind: 'movie', title: 'X (film)', year: 2000, sources: { wikipedia: 'w' }, description: 'desc long enough here' }]]);
  assert.equal(m.length, 1);
  assert.deepEqual([m[0].kind, m[0].year, m[0].poster, Object.keys(m[0].sources).sort()], ['anime', 2000, 'p', ['anilist', 'wikipedia']]);
});

test('getDetail: resolves AniList for a Wikipedia-only anime and tolerates failures', async () => {
  const f = async (u, init) => {
    const s = String(u);
    if (s.includes('anilist')) {
      const body = JSON.parse(init.body);
      if (body.variables.q) return json(ANI_SEARCH);
      return json({ data: { Page: { media: [{ id: 101280, title: { romaji: 'Tensei', english: 'That Time I Got Reincarnated as a Slime' }, format: 'TV', startDate: { year: 2018 }, relations: { edges: [] } }] } } });
    }
    return json({ query: { pages: { 1: { extract: 'Summary text.' } } } });
  };
  const d = await getDetail({ kind: 'anime', title: 'That Time I Got Reincarnated as a Slime', wikiTitle: 'That Time I Got Reincarnated as a Slime' }, { fetchImpl: f });
  assert.equal(d.franchise.seasons.length, 1);
  assert.equal(d.summary, 'Summary text.');
  const bad = await getDetail({ kind: 'anime', anilistId: 1, title: 'X' }, { fetchImpl: async () => json({}, 500) });
  assert.match(bad.notes[0], /AniList/);
});

test('spelling variants still rank the right title first (bahubali vs Baahubali)', async () => {
  const pages = { query: { pages: { 1: { pageid: 1, index: 1, title: 'Bahu (film)', description: '1999 Indian film' }, 2: { pageid: 2, index: 2, title: 'Baahubali: The Beginning', description: '2015 Indian epic action film' } } } };
  const out = await searchAll('bahubali', { fetchImpl: async (u) => (String(u).includes('anilist') ? json({ data: { Page: { media: [] } } }) : json(pages)) });
  assert.equal(out.results[0].title, 'Baahubali: The Beginning');
});

// ---------- regressions found by the first LIVE run ----------
import { fetchRetry } from '../src/http.js';
import { setSleep } from '../src/sources/anilist.js';
import { retrySleep } from '../src/sources/wikipedia.js';
const noWait = () => Promise.resolve();
setSleep(noWait);
retrySleep.fn = noWait;

test('fetchRetry: retries 429/503, honours Retry-After, then gives up', async () => {
  let n = 0;
  const waits = [];
  const f = async () => (++n < 3 ? new Response('', { status: 429, headers: { 'retry-after': '2' } }) : new Response('ok'));
  const res = await fetchRetry(f, 'u', undefined, { sleep: async (ms) => { waits.push(ms); } });
  assert.equal(await res.text(), 'ok');
  assert.deepEqual(waits, [2000, 2000]);
  let m = 0;
  const always = async () => { m++; return new Response('', { status: 503 }); };
  const last = await fetchRetry(always, 'u', undefined, { retries: 2, sleep: noWait });
  assert.equal(last.status, 503);
  assert.equal(m, 3);
});

test('a 429 from a source is retried transparently (search still succeeds)', async () => {
  let aniCalls = 0;
  const f = async (u) => {
    if (String(u).includes('anilist')) { aniCalls++; return aniCalls === 1 ? json({}, 429) : json(ANI_SEARCH); }
    return json({ query: { pages: {} } });
  };
  const out = await searchAll('slime', { fetchImpl: f });
  assert.equal(aniCalls, 2);
  assert.ok(out.notes.find((n) => n.source === 'AniList').ok);
});

test('"slime": the famous anime outranks an obscure film literally titled "Slime (film)"', async () => {
  const ani = { data: { Page: { media: [
    { ...slimeMedia(101280, 'That Time I Got Reincarnated as a Slime', 'Tensei shitara Slime Datta Ken', 2018), popularity: 380000 },
    { ...slimeMedia(900, 'Slime Boukenki', 'Slime Boukenki', 1998, 'OVA'), popularity: 300 },
  ] } } };
  const wiki = { query: { pages: { 1: { pageid: 1, index: 1, title: 'Slime (film)', description: 'American film' } } } };
  const out = await searchAll('slime', { fetchImpl: async (u) => (String(u).includes('anilist') ? json(ani) : json(wiki)) });
  assert.equal(out.results[0].title, 'That Time I Got Reincarnated as a Slime');
});

test('"tensura": the main TV series outranks a short ONA that also mentions Tensura', async () => {
  const ani = { data: { Page: { media: [
    { ...slimeMedia(5, 'Tensei Shitara Slime Datta Ken: Sukuwareru Ramiris', 'Sukuwareru Ramiris', 2022, 'ONA', ['Tensura']), popularity: 2000 },
    { ...slimeMedia(101280, 'That Time I Got Reincarnated as a Slime', 'Tensei shitara Slime Datta Ken', 2018, 'TV', ['Tensura']), popularity: 380000 },
  ] } } };
  const out = await searchAll('tensura', { fetchImpl: async (u) => (String(u).includes('anilist') ? json(ani) : json({ query: { pages: {} } })) });
  assert.equal(out.results[0].title, 'That Time I Got Reincarnated as a Slime');
});

test('"bahubali": the film (Wikipedia rank 1, first-word match) beats "Bindiya Ke Bahubali"', async () => {
  const wiki = { query: { pages: {
    1: { pageid: 1, index: 1, title: 'Baahubali: The Beginning', description: '2015 Indian film by S. S. Rajamouli' },
    2: { pageid: 2, index: 2, title: 'Bindiya Ke Bahubali (TV series)', description: '2025 Indian TV series' },
  } } };
  const out = await searchAll('bahubali', { fetchImpl: async (u) => (String(u).includes('anilist') ? json({ data: { Page: { media: [] } } }) : json(wiki)) });
  assert.equal(out.results[0].title, 'Baahubali: The Beginning');
});

test('franchise also lists movies/OVAs linked as side story or spin-off, and TV spin-offs separately', async () => {
  const mk = (id, fmt, year, title) => ({ id, type: 'ANIME', title: { romaji: title, english: title }, format: fmt, episodes: 12, status: 'FINISHED', startDate: { year, month: 1, day: 1 }, coverImage: { medium: null } });
  const S1 = mk(1, 'TV', 2018, 'S1'), MOV = mk(5, 'MOVIE', 2022, 'Scarlet Bond'), DIARIES = mk(7, 'TV', 2021, 'Slime Diaries'), RECAP = mk(8, 'SPECIAL', 2019, 'Recap');
  const f = async (_u, init) => {
    const ids = JSON.parse(init.body).variables.ids;
    return json({ data: { Page: { media: ids.filter((i) => i === 1).map(() => ({ ...S1, relations: { edges: [
      { relationType: 'SPIN_OFF', node: MOV }, { relationType: 'SPIN_OFF', node: DIARIES }, { relationType: 'SUMMARY', node: RECAP },
    ] } })) } } });
  };
  const fr = await getAniListFranchise(1, f);
  assert.deepEqual(fr.seasons.map((x) => x.title), ['S1']);
  assert.deepEqual(fr.movies.map((x) => x.title), ['Scarlet Bond']);
  assert.deepEqual(fr.spinoffs.map((x) => x.title), ['Slime Diaries']);
  assert.deepEqual(fr.other, [], 'recaps (SUMMARY) are not listed');
});
