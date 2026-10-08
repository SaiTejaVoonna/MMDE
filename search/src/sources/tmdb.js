import { firstYear } from '../text.js';

// TMDB (optional): needs the user's own free API key (themoviedb.org/settings/api), kept only in this browser.
// Best IMDb-like data for movies/TV incl. Indian cinema and TV seasons. Free for non-commercial use with
// attribution ("This product uses the TMDB API but is not endorsed or certified by TMDB.").
const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w154';

export function mapTmdb(r) {
  const isTv = r.media_type === 'tv';
  const title = r.title || r.name || '';
  return {
    id: `tmdb:${r.media_type}:${r.id}`,
    tmdbId: r.id,
    tmdbType: r.media_type,
    kind: isTv ? 'tv' : 'movie',
    title,
    altTitles: [r.original_title, r.original_name].filter((x) => x && x !== title),
    year: firstYear(r.release_date || r.first_air_date),
    language: r.original_language,
    description: (r.overview ?? '').slice(0, 240),
    poster: r.poster_path ? IMG + r.poster_path : undefined,
    popularity: r.popularity ?? 0,
    sources: { tmdb: `https://www.themoviedb.org/${r.media_type}/${r.id}` },
  };
}

export async function searchTmdb(text, key, fetchImpl) {
  const res = await fetchImpl(`${API}/search/multi?${new URLSearchParams({ api_key: key, query: text, include_adult: 'false' })}`);
  if (res.status === 401) throw new Error('TMDB rejected the API key (401)');
  if (!res.ok) throw new Error(`HTTP ${res.status} from TMDB`);
  const j = await res.json();
  return (j.results ?? []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv').map(mapTmdb);
}

export async function getTmdbSeasons(id, key, fetchImpl) {
  const res = await fetchImpl(`${API}/tv/${id}?${new URLSearchParams({ api_key: key })}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from TMDB`);
  const j = await res.json();
  return (j.seasons ?? []).map((s) => ({
    id: s.id, title: s.name, number: s.season_number, episodes: s.episode_count, year: firstYear(s.air_date), poster: s.poster_path ? IMG + s.poster_path : undefined,
  }));
}
