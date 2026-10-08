import type { Media } from '../domain/types.ts';
import type { MediaResolver } from './types.ts';

export interface TmdbSeason {
  seasonNumber: number;
  name: string;
  airDate?: string;
  episodeCount: number;
  posterPath?: string;
}

interface TmdbResult {
  id: number;
  name?: string;
  original_name?: string;
  title?: string;
  original_title?: string;
  first_air_date?: string;
  release_date?: string;
  poster_path?: string | null;
  popularity?: number;
  overview?: string;
  original_language?: string;
  genre_ids?: number[];
  media_type?: string;
}

// Some home networks reset a connection now and then (ECONNRESET). Retry only
// network failures and 502/503/504, a few times, so one blip is not a failed search.
export async function fetchRetry(fetchImpl: typeof fetch, url: string, init: RequestInit, tries = 4, delayMs = 400): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchImpl(url, init);
      if (![502, 503, 504].includes(res.status) || i === tries - 1) return res;
    } catch (e) { last = e; if (i === tries - 1) throw e; }
    await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
  }
  throw last;
}

function authHeaders(token: string): HeadersInit {
  return { Accept: 'application/json', Authorization: `Bearer ${token}` };
}

function mapResult(m: TmdbResult, type: 'tv' | 'movie'): Media {
  const title = type === 'tv'
    ? (m.name ?? m.original_name ?? String(m.id))
    : (m.title ?? m.original_title ?? String(m.id));
  const date = type === 'tv' ? m.first_air_date : m.release_date;
  return {
    id: `tmdb-${type}-${m.id}`,
    type,
    title,
    altTitles: [type === 'tv' ? m.original_name : m.original_title].filter((x): x is string => !!x && x !== title),
    year: date ? Number(date.slice(0, 4)) : undefined,
    externalIds: { tmdb: String(m.id), tmdbType: type },
    ...(m.poster_path ? { posterPath: m.poster_path } : {}),
    ...(m.overview ? { overview: m.overview.slice(0, 220) } : {}),
    ...(typeof m.popularity === 'number' ? { popularity: m.popularity } : {}),
    ...(m.original_language ? { originalLanguage: m.original_language } : {}),
    ...(m.genre_ids?.includes(16) ? { animation: true } : {}),
  };
}

const LANGS: Record<string, string> = {
  telugu: 'te', hindi: 'hi', tamil: 'ta', malayalam: 'ml', kannada: 'kn', bengali: 'bn', marathi: 'mr', punjabi: 'pa',
  japanese: 'ja', korean: 'ko', english: 'en', chinese: 'zh', spanish: 'es', french: 'fr', german: 'de', thai: 'th',
};
const TYPE_WORDS: Record<string, 'tv' | 'movie'> = { movie: 'movie', movies: 'movie', film: 'movie', films: 'movie', tv: 'tv', series: 'tv', serial: 'tv', show: 'tv' };

function within1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
function hint<T>(word: string, map: Record<string, T>): T | undefined {
  if (word in map) return map[word];
  if (word.length < 5) return undefined;
  const key = Object.keys(map).find((k) => k.length >= 5 && within1(word, k));
  return key ? map[key] : undefined;
}

export interface ParsedQuery { text: string; type?: 'tv' | 'movie'; lang?: string; year?: number; anime?: boolean; hinted: boolean }

// "og telugu mmovie 2025" -> text "og", lang te, type movie, year 2025. Hints are optional: the raw query is still searched too.
export function parseQuery(query: string): ParsedQuery {
  const raw = query.trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  const keep: string[] = [];
  let type: ParsedQuery['type']; let lang: string | undefined; let year: number | undefined; let anime = false;
  const maxYear = new Date().getFullYear() + 2;
  for (const t of tokens) {
    const w = t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (/^\d{4}$/.test(w) && tokens.length > 1 && Number(w) >= 1900 && Number(w) <= maxYear) { year = Number(w); continue; }
    const l = hint(w, LANGS); if (l) { lang = l; continue; }
    const k = hint(w, TYPE_WORDS); if (k) { type = k; continue; }
    if (w === 'anime') { anime = true; continue; }
    keep.push(t);
  }
  const text = keep.join(' ').trim();
  if (text.length < 2) return { text: raw, hinted: false };
  return { text, type, lang, year, ...(anime ? { anime } : {}), hinted: text.toLowerCase() !== raw.toLowerCase() };
}

// Exact title first, then titles starting with (or containing the word), then the rest. Inside a group: most popular, with a boost for the language asked for.
export function rankByQuery(items: Media[], query: string, opts: { alt?: string; lang?: string; anime?: boolean } = {}): Media[] {
  // Fold repeated letters so spelling variants line up (bahubali / baahubali, tensura / tensuraa).
  const fold = (x: string) => x.trim().toLowerCase().replace(/(\p{L})\1+/gu, '$1');
  const qs = [query, opts.alt].filter((x): x is string => !!x).map(fold);
  const tier = (m: Media) => {
    const names = [m.title, ...m.altTitles].map(fold);
    const hasWord = (t: string, q: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(t);
    return Math.min(...qs.map((q) => (names.includes(q) ? 0 : names.some((t) => t.startsWith(q) || hasWord(t, q)) ? 1 : 2)));
  };
  // "anime" in the query: Japanese animation first, whatever else matches.
  const anime = (m: Media) => (opts.anime && m.animation && m.originalLanguage === 'ja' ? 0 : 1);
  // A language word is a soft preference, not a filter: dubbed films (Baahubali in Hindi) are listed once under their original language.
  const score = (m: Media) => (m.popularity ?? 0) * (opts.lang && m.originalLanguage === opts.lang ? 3 : 1);
  return items.map((m, i) => ({ m, i })).sort((a, b) => anime(a.m) - anime(b.m) || tier(a.m) - tier(b.m) || score(b.m) - score(a.m) || a.i - b.i).map((x) => x.m);
}

export function tmdbResolver(token: string, fetchImpl: typeof fetch = fetch): MediaResolver {
  const fetchKind = async (kind: 'tv' | 'movie', text: string, page: number, year?: number): Promise<Media[]> => {
    const yearParam = year ? `&${kind === 'tv' ? 'first_air_date_year' : 'year'}=${year}` : '';
    const url = `https://api.themoviedb.org/3/search/${kind}?query=${encodeURIComponent(text)}&include_adult=false&language=en-US&page=${page}${yearParam}`;
    const res = await fetchRetry(fetchImpl, url, { headers: authHeaders(token) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from TMDB ${kind === 'tv' ? 'TV' : 'movie'} search`);
    const data = (await res.json()) as { results?: TmdbResult[] };
    return (data.results ?? []).map((m) => mapResult(m, kind));
  };
  return {
    name: 'tmdb',
    async search(query: string): Promise<Media[]> {
      const p = parseQuery(query);
      const jobs: Array<Promise<Media[]>> = [];
      const rawJobs = [fetchKind('tv', query.trim(), 1), fetchKind('movie', query.trim(), 1)];
      const hintedJobs: Array<Promise<Media[]>> = [];
      if (p.hinted) {
        for (const kind of p.type ? [p.type] : (['tv', 'movie'] as const)) {
          for (const page of p.lang ? [1, 2] : [1]) hintedJobs.push(fetchKind(kind, p.text, page, p.year));
        }
      }
      jobs.push(...hintedJobs, ...rawJobs);
      const settled = await Promise.allSettled(jobs);
      const ok = settled.filter((s): s is PromiseFulfilledResult<Media[]> => s.status === 'fulfilled');
      if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
      const hinted = settled.slice(0, hintedJobs.length).flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
      const raw = settled.slice(hintedJobs.length).flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
      const seen = new Set<string>();
      const all = [...hinted, ...raw].filter((m) => !seen.has(m.id) && !!seen.add(m.id));
      return rankByQuery(all, query, { alt: p.hinted ? p.text : undefined, lang: p.lang, anime: p.anime }).slice(0, 15);
    },
  };
}

export async function tmdbSeasons(
  media: Media,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TmdbSeason[]> {
  if (media.externalIds.tmdbType !== 'tv') return [];
  const id = media.externalIds.tmdb;
  if (!id) return [];
  const res = await fetchRetry(fetchImpl, `https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}?language=en-US`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from TMDB TV details`);
  const data = (await res.json()) as { seasons?: Array<{ season_number: number; name: string; air_date?: string | null; episode_count: number; poster_path?: string | null }> };
  return (data.seasons ?? [])
    .filter((s) => s.season_number >= 0)
    .map((s) => ({
      seasonNumber: s.season_number,
      name: s.name,
      airDate: s.air_date ?? undefined,
      episodeCount: s.episode_count,
      posterPath: s.poster_path ?? undefined,
    }));
}
