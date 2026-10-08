import { baseKey, norm, wordSim } from './text.js';
import { parseQuery } from './query.js';
import { getAniListFranchise, resolveAniListId, searchAniList } from './sources/anilist.js';
import { getTmdbSeasons, searchTmdb } from './sources/tmdb.js';
import { getWikipediaSummary, searchWikipedia } from './sources/wikipedia.js';

// Phase 1 only: reliable media SEARCH. Sources are plain functions behind searchAll(); add more later
// without touching callers. Every source reports ok/count/error so failures are visible, never silent.

const keysOf = (r) => [r.title, ...(r.altTitles ?? [])].map(baseKey).filter(Boolean);

// "Slime (film)" is not an exact match for "slime": the qualifier means the title is ambiguous.
const qualified = (title) => /\([^)]*\)\s*$/.test(String(title ?? ''));

function score(r, parsed) {
  const q = norm(parsed.text);
  const qk = baseKey(parsed.text);
  let best = 0;
  const exact = qualified(r.title) ? 85 : 100;
  for (const k of keysOf(r)) {
    if (k === qk || k === q) best = Math.max(best, exact);
    else if (k.startsWith(q)) best = Math.max(best, 75);
    else if ((' ' + k + ' ').includes(' ' + q + ' ')) best = Math.max(best, 60);
    else {
      // token overlap with fuzzy spelling tolerance ("bahubali" ~ "baahubali")
      const qt = q.split(' ').filter(Boolean);
      const kt = k.split(' ').filter(Boolean);
      if (qt.length && kt.length) {
        const sims = qt.map((t) => Math.max(...kt.map((w) => wordSim(t, w))));
        const strong = sims.filter((x) => x >= 0.8);
        if (strong.length) {
          let fuzzy = (strong.reduce((a, b) => a + b, 0) / qt.length) * 70;
          if (wordSim(qt[0], kt[0]) >= 0.8) fuzzy += 10; // query matches the first word of the title
          best = Math.max(best, Math.round(fuzzy));
        }
      }
    }
  }
  if (parsed.type && r.kind === parsed.type) best += 15;
  if (parsed.lang) {
    const l = parsed.lang.slice(0, 2);
    const lang = String(r.language ?? '').toLowerCase();
    if (lang.startsWith(l) || lang.includes(parsed.lang) || String(r.description ?? '').toLowerCase().includes(parsed.lang)) best += 20;
  }
  if (r.kind === 'book') best -= 10;
  if (r.sources?.anilist) best += 5;
  if (r.popularity) best += Math.min(50, 9 * Math.log10(r.popularity + 1)); // well-known titles first
  if (['OVA', 'ONA', 'SPECIAL', 'MUSIC', 'TV_SHORT'].includes(r.format)) best -= 12; // main series before extras
  else if (r.format === 'MOVIE') best -= 3;
  if (r.wikiRank !== undefined) best += Math.max(0, 20 - 4 * r.wikiRank); // trust Wikipedia's own relevance order
  return best;
}

/** Merge results that are the same work (same base title or alias); keep the richest fields. */
const altKeys = (r) => (r.altTitles ?? []).map(baseKey).filter(Boolean);

/** Same work if main titles match, or one's main title is the other's alias. Two works that merely share a
 *  nickname (e.g. both list "Tensura" as a synonym) are NOT the same work. */
function sameWork(a, b) {
  const ka = baseKey(a.title);
  const kb = baseKey(b.title);
  return (ka && ka === kb) || altKeys(b).includes(ka) || altKeys(a).includes(kb);
}

export function mergeResults(lists) {
  const out = [];
  for (const r of lists.flat()) {
    const hit = out.find((o) => sameWork(o, r));
    if (!hit) { out.push({ ...r, sources: { ...r.sources } }); continue; }
    hit.sources = { ...hit.sources, ...r.sources };
    hit.altTitles = [...new Set([...(hit.altTitles ?? []), ...(r.altTitles ?? []), ...(r.title !== hit.title ? [r.title] : [])])];
    hit.poster ??= r.poster;
    hit.year ??= r.year;
    hit.language ??= r.language;
    if (!hit.description || (r.description && hit.description.length < 20)) hit.description = r.description;
    hit.anilistId ??= r.anilistId;
    hit.tmdbId ??= r.tmdbId;
    hit.tmdbType ??= r.tmdbType;
    hit.wikiTitle ??= r.wikiTitle;
    hit.popularity ??= r.popularity;
    hit.format ??= r.format;
    hit.wikiRank ??= r.wikiRank;
    if (hit.kind !== 'anime' && r.kind === 'anime') hit.kind = 'anime';
  }
  return out;
}

export async function searchAll(raw, { fetchImpl = (...a) => fetch(...a), tmdbKey = '' } = {}) {
  const parsed = parseQuery(raw);
  if (!parsed.text) return { parsed, results: [], notes: [] };
  const plan = [];
  const nonJapanese = parsed.lang && parsed.lang !== 'japanese';
  if (!nonJapanese && parsed.type !== 'game') plan.push(['AniList', () => searchAniList(parsed.text, fetchImpl)]);
  plan.push(['Wikipedia', () => searchWikipedia(parsed, fetchImpl)]);
  if (tmdbKey && parsed.type !== 'anime') plan.push(['TMDB', () => searchTmdb(parsed.text, tmdbKey, fetchImpl)]);
  const settled = await Promise.allSettled(plan.map(([, fn]) => fn()));
  const notes = [];
  const lists = [];
  settled.forEach((s, i) => {
    const source = plan[i][0];
    if (s.status === 'fulfilled') { lists.push(s.value); notes.push({ source, ok: true, count: s.value.length }); }
    else notes.push({ source, ok: false, count: 0, error: s.reason instanceof Error ? s.reason.message : String(s.reason) });
  });
  if (!tmdbKey) notes.push({ source: 'TMDB', ok: true, count: 0, skipped: 'no API key (optional)' });
  const results = mergeResults(lists)
    .map((r) => ({ ...r, _score: score(r, parsed) }))
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...r }) => r);
  return { parsed, results, notes };
}

/** Detail view data: anime franchise (seasons/movies/specials), TMDB seasons, Wikipedia summary. */
export async function getDetail(result, { fetchImpl = (...a) => fetch(...a), tmdbKey = '' } = {}) {
  const detail = { franchise: null, tmdbSeasons: null, summary: '', notes: [] };
  const tasks = [];
  if (result.kind === 'anime' || result.anilistId) {
    tasks.push((async () => {
      try {
        const id = result.anilistId ?? (await resolveAniListId(result.title, fetchImpl));
        if (id) detail.franchise = await getAniListFranchise(id, fetchImpl);
        else detail.notes.push('AniList: no matching entry, so no season list');
      } catch (e) { detail.notes.push(`AniList: ${e.message}`); }
    })());
  }
  if (result.tmdbType === 'tv' && tmdbKey) {
    tasks.push(getTmdbSeasons(result.tmdbId, tmdbKey, fetchImpl).then((s) => { detail.tmdbSeasons = s; }).catch((e) => detail.notes.push(`TMDB: ${e.message}`)));
  }
  if (result.wikiTitle) {
    tasks.push(getWikipediaSummary(result.wikiTitle, fetchImpl).then((s) => { detail.summary = s; }).catch((e) => detail.notes.push(`Wikipedia: ${e.message}`)));
  }
  await Promise.all(tasks);
  return detail;
}
