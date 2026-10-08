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
  };
}

// Exact title first, then titles starting with the query, then the rest; most popular first inside each group.
export function rankByQuery(items: Media[], query: string): Media[] {
  const q = query.trim().toLowerCase();
  const tier = (m: Media) => {
    const names = [m.title, ...m.altTitles].map((t) => t.toLowerCase());
    return names.includes(q) ? 0 : names.some((t) => t.startsWith(q)) ? 1 : 2;
  };
  return items.map((m, i) => ({ m, i })).sort((a, b) => tier(a.m) - tier(b.m) || (b.m.popularity ?? 0) - (a.m.popularity ?? 0) || a.i - b.i).map((x) => x.m);
}

export function tmdbResolver(token: string, fetchImpl: typeof fetch = fetch): MediaResolver {
  return {
    name: 'tmdb',
    async search(query: string): Promise<Media[]> {
      const encoded = encodeURIComponent(query);
      const [tvRes, movieRes] = await Promise.all([
        fetchRetry(fetchImpl, `https://api.themoviedb.org/3/search/tv?query=${encoded}&include_adult=false&language=en-US&page=1`, { headers: authHeaders(token) }),
        fetchRetry(fetchImpl, `https://api.themoviedb.org/3/search/movie?query=${encoded}&include_adult=false&language=en-US&page=1`, { headers: authHeaders(token) }),
      ]);
      if (!tvRes.ok) throw new Error(`HTTP ${tvRes.status} from TMDB TV search`);
      if (!movieRes.ok) throw new Error(`HTTP ${movieRes.status} from TMDB movie search`);
      const tv = (await tvRes.json()) as { results?: TmdbResult[] };
      const movies = (await movieRes.json()) as { results?: TmdbResult[] };
      const all = [
        ...(tv.results ?? []).slice(0, 12).map((m) => mapResult(m, 'tv')),
        ...(movies.results ?? []).slice(0, 12).map((m) => mapResult(m, 'movie')),
      ];
      return rankByQuery(all, query).slice(0, 15);
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
