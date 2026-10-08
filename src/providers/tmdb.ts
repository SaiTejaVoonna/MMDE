import type { Media } from '../domain/types.ts';
import type { MediaResolver } from './types.ts';

export interface TmdbSeason {
  seasonNumber: number;
  name: string;
  airDate?: string;
  episodeCount: number;
  posterPath?: string;
  overview?: string;
  voteAverage?: number;
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

function mapCollection(c: { id: number; name?: string; poster_path?: string | null; overview?: string }): Media {
  const title = c.name ?? String(c.id);
  return {
    id: `tmdb-collection-${c.id}`,
    type: 'collection',
    title,
    altTitles: [],
    externalIds: { tmdb: String(c.id), tmdbType: 'collection' },
    ...(c.poster_path ? { posterPath: c.poster_path } : {}),
    ...(c.overview ? { overview: c.overview.slice(0, 220) } : {}),
    // search/collection returns no popularity; give franchises a middling one so they sit near their own films.
    popularity: 40,
  };
}

// Words that commonly appear in titles, used only to rescue joined-up queries ("starwars" -> "star wars").
const TITLE_WORDS = new Set(`a an the of and in on at to for my me you your we our it is as by or no not
star stars wars war trek man men woman spider bat super iron captain america avengers endgame infinity harry potter lord rings hobbit game games thrones
breaking bad stranger things money heist dark knight rises jurassic park world fast furious mission impossible john wick toy story lion king frozen fire force
attack titan hero academia one piece dragon ball death note demon slayer jujutsu kaisen that time got reincarnated slime
love night day black white red blue green gold silver dead life blood secret last first second third house girl boy little big great new old high school city
dr doctor strange thor hulk ant wasp guardians galaxy black panther wonder deadpool wolverine venom joker batman superman flash aqua mad max matrix terminator alien
aliens predator rocky rambo die hard pirates caribbean fantastic four planet apes kong godzilla transformers pacific rim top gun avatar way water titanic gladiator
inception interstellar tenet dunkirk oppenheimer barbie wicked moana coco up cars incredibles monsters inc nemo finding dory shrek madagascar ice age kung fu panda
home alone back future lethal weapon bourne mummy scream saw halloween nightmare elm street friday thirteenth conjuring insidious paranormal activity purge
squid season family guy simpsons office friends big bang theory walking zombie house cards crown mandalorian witcher boys umbrella academy peaky blinders
naruto bleach hunter x fullmetal alchemist brotherhood cowboy bebop evangelion neon genesis sword art online tokyo ghoul mob psycho saitama punch spy fairy tail
black clover chainsaw vinland saga steins gate code geass re zero overlord konosuba tensura reborn kingdom haikyuu kuroko basket blue lock fire eater`.split(/\s+/).filter(Boolean));

// "starwars" -> "star wars"; undefined when it cannot be split into known words (one unknown 4+ letter piece is allowed).
export function segmentQuery(query: string): string | undefined {
  const q = query.trim().toLowerCase();
  if (q.length < 6 || q.length > 40 || !/^\p{L}+$/u.test(q)) return undefined;
  type Cut = { words: string[]; unknown: number };
  const best: Array<Cut | undefined> = new Array(q.length + 1).fill(undefined);
  best[0] = { words: [], unknown: 0 };
  for (let i = 1; i <= q.length; i++) {
    for (let j = 0; j < i; j++) {
      const prev = best[j]; if (!prev) continue;
      const w = q.slice(j, i);
      const known = TITLE_WORDS.has(w);
      if (!known && (w.length < 4 || prev.unknown >= 1)) continue;
      const cand: Cut = { words: [...prev.words, w], unknown: prev.unknown + (known ? 0 : 1) };
      const cur = best[i];
      if (!cur || cand.unknown < cur.unknown || (cand.unknown === cur.unknown && cand.words.length < cur.words.length)) best[i] = cand;
    }
  }
  const out = best[q.length];
  return out && out.words.length >= 2 ? out.words.join(' ') : undefined;
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
  const fetchCollections = async (text: string, limit: number): Promise<Media[]> => {
    const res = await fetchRetry(fetchImpl, `https://api.themoviedb.org/3/search/collection?query=${encodeURIComponent(text)}&include_adult=false&language=en-US&page=1`, { headers: authHeaders(token) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from TMDB collection search`);
    const data = (await res.json()) as { results?: Array<{ id: number; name?: string; poster_path?: string | null; overview?: string }> };
    return (data.results ?? []).slice(0, limit).map(mapCollection);
  };
  return {
    name: 'tmdb',
    async search(query: string, opts: { deep?: boolean } = {}): Promise<Media[]> {
      const p = parseQuery(query);
      const raw0 = query.trim();
      const pages = opts.deep ? [1, 2] : [1];
      const colLimit = opts.deep ? 8 : 3;
      const seg = !p.hinted ? segmentQuery(raw0) : undefined;
      const rawJobs: Array<Promise<Media[]>> = [
        ...pages.flatMap((pg) => [fetchKind('tv', raw0, pg), fetchKind('movie', raw0, pg)]),
        fetchCollections(p.hinted ? p.text : raw0, colLimit),
      ];
      const hintedJobs: Array<Promise<Media[]>> = [];
      if (p.hinted) {
        for (const kind of p.type ? [p.type] : (['tv', 'movie'] as const)) {
          for (const page of p.lang || opts.deep ? [1, 2] : [1]) hintedJobs.push(fetchKind(kind, p.text, page, p.year));
        }
      } else if (seg) {
        hintedJobs.push(fetchKind('tv', seg, 1), fetchKind('movie', seg, 1), fetchCollections(seg, colLimit));
      }
      const settled = await Promise.allSettled([...hintedJobs, ...rawJobs]);
      const ok = settled.filter((s): s is PromiseFulfilledResult<Media[]> => s.status === 'fulfilled');
      if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
      const hinted = settled.slice(0, hintedJobs.length).flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
      const raw = settled.slice(hintedJobs.length).flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
      const seen = new Set<string>();
      const all = [...hinted, ...raw].filter((m) => !seen.has(m.id) && !!seen.add(m.id));
      return rankByQuery(all, query, { alt: p.hinted ? p.text : seg, lang: p.lang, anime: p.anime }).slice(0, opts.deep ? 40 : 15);
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
  const data = (await res.json()) as { seasons?: Array<{ season_number: number; name: string; air_date?: string | null; episode_count: number; poster_path?: string | null; overview?: string; vote_average?: number }> };
  return (data.seasons ?? [])
    .filter((s) => s.season_number >= 0)
    .map((s) => ({
      seasonNumber: s.season_number,
      name: s.name,
      airDate: s.air_date ?? undefined,
      episodeCount: s.episode_count,
      posterPath: s.poster_path ?? undefined,
      overview: s.overview || undefined,
      voteAverage: s.vote_average || undefined,
    }));
}

export interface TmdbPart { id: string; kind: 'movie'; title: string; year?: number; releaseDate?: string; posterPath?: string; overview?: string }
export interface TmdbDetails {
  id: string;
  kind: 'movie' | 'tv' | 'collection';
  title: string;
  tagline?: string;
  overview?: string;
  year?: number;
  posterPath?: string;
  backdropPath?: string;
  runtimeMin?: number;
  genres: string[];
  originalLanguage?: string;
  spokenLanguages: string[];
  voteAverage?: number;
  /** A movie that belongs to a franchise points at it; the franchise lists its films in release order. */
  collection?: { id: string; name: string; posterPath?: string };
  parts?: TmdbPart[];
  seasons?: TmdbSeason[];
}

type RawPart = { id: number; title?: string; release_date?: string; poster_path?: string | null; overview?: string };
const mapPart = (m: RawPart): TmdbPart => ({
  id: `tmdb-movie-${m.id}`, kind: 'movie', title: m.title ?? String(m.id),
  ...(m.release_date ? { releaseDate: m.release_date, year: Number(m.release_date.slice(0, 4)) } : {}),
  ...(m.poster_path ? { posterPath: m.poster_path } : {}),
  ...(m.overview ? { overview: m.overview.slice(0, 220) } : {}),
});
// TMDB's own order is not reliable; release date is (missing dates last).
const byRelease = (a: TmdbPart, b: TmdbPart) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999');

export async function tmdbDetails(id: string, token: string, fetchImpl: typeof fetch = fetch): Promise<TmdbDetails> {
  const m = /^tmdb-(tv|movie|collection)-(\d{1,10})$/.exec(id);
  if (!m) throw new Error('invalid id');
  const kind = m[1] as TmdbDetails['kind'];
  const num = m[2]!;
  const get = async (path: string) => {
    const res = await fetchRetry(fetchImpl, `https://api.themoviedb.org/3/${path}language=en-US`, { headers: authHeaders(token) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from TMDB ${kind} details`);
    return (await res.json()) as Record<string, any>;
  };
  if (kind === 'collection') {
    const c = await get(`collection/${num}?`);
    const parts = ((c.parts ?? []) as RawPart[]).map(mapPart).sort(byRelease);
    return {
      id, kind, title: c.name ?? id, overview: c.overview || undefined, posterPath: c.poster_path || undefined, backdropPath: c.backdrop_path || undefined,
      year: parts[0]?.year, genres: [], spokenLanguages: [], parts,
    };
  }
  const d = await get(`${kind}/${num}?`);
  const out: TmdbDetails = {
    id, kind, title: (kind === 'tv' ? d.name : d.title) ?? id,
    tagline: d.tagline || undefined, overview: d.overview || undefined,
    year: Number(String((kind === 'tv' ? d.first_air_date : d.release_date) ?? '').slice(0, 4)) || undefined,
    posterPath: d.poster_path || undefined, backdropPath: d.backdrop_path || undefined,
    runtimeMin: (kind === 'movie' ? d.runtime : d.episode_run_time?.[0]) || undefined,
    genres: ((d.genres ?? []) as Array<{ name: string }>).map((g) => g.name),
    originalLanguage: d.original_language || undefined,
    spokenLanguages: ((d.spoken_languages ?? []) as Array<{ english_name?: string; name?: string }>).map((l) => l.english_name || l.name || '').filter(Boolean),
    voteAverage: d.vote_average ? Math.round(d.vote_average * 10) / 10 : undefined,
  };
  if (kind === 'tv') {
    out.seasons = ((d.seasons ?? []) as Array<any>).filter((s) => s.season_number >= 0).map((s) => ({
      seasonNumber: s.season_number, name: s.name, airDate: s.air_date ?? undefined, episodeCount: s.episode_count,
      posterPath: s.poster_path ?? undefined, overview: s.overview || undefined, voteAverage: s.vote_average || undefined,
    }));
  }
  if (kind === 'movie' && d.belongs_to_collection?.id) {
    const cid = d.belongs_to_collection.id;
    out.collection = { id: `tmdb-collection-${cid}`, name: d.belongs_to_collection.name ?? 'Collection', posterPath: d.belongs_to_collection.poster_path || undefined };
    try {
      const c = await get(`collection/${cid}?`);
      out.parts = ((c.parts ?? []) as RawPart[]).map(mapPart).sort(byRelease);
    } catch { /* the movie page still works without its franchise list */ }
  }
  return out;
}
