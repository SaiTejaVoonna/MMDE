import type { Media, PartRef, TrackClaim, TrackRole } from '../domain/types.ts';
import { createRateLimiter, type DiscoveryProvider } from './types.ts';

interface AnimeThemesSong { id?: number; title?: string; artists?: Array<{ id?: number; name?: string }> }
interface AnimeThemesEntry { id?: number; version?: number; episodes?: string | null; notes?: string | null }
interface AnimeThemesTheme {
  id?: number;
  type?: string | null;
  sequence?: number | null;
  slug?: string;
  song?: AnimeThemesSong | null;
  animethemeentries?: AnimeThemesEntry[];
}
interface AnimeThemesAnime {
  id?: number;
  name?: string;
  slug?: string;
  year?: number | null;
  media_format?: string;
  animesynonyms?: Array<{ text?: string; synonym?: string; name?: string }>;
  animethemes?: AnimeThemesTheme[];
}
interface AnimeThemesResponse { anime?: AnimeThemesAnime | AnimeThemesAnime[] }

function unwrapAnime(body: AnimeThemesResponse): AnimeThemesAnime[] {
  if (!body.anime) return [];
  return Array.isArray(body.anime) ? body.anime : [body.anime];
}

function role(type?: string | null): TrackRole | null {
  if (type === 'OP') return 'opening';
  if (type === 'ED') return 'ending';
  return null;
}

function partFor(media: Media): PartRef {
  return media.partRef ?? { kind: 'whole' };
}

function bestAnime(items: AnimeThemesAnime[], media: Media): AnimeThemesAnime | undefined {
  const wanted = new Set([media.title, ...media.altTitles].map((x) => x.trim().toLowerCase()).filter(Boolean));
  return [...items].sort((a, b) => {
    const as = wanted.has((a.name ?? '').toLowerCase()) ? 1 : 0;
    const bs = wanted.has((b.name ?? '').toLowerCase()) ? 1 : 0;
    return bs - as;
  })[0];
}

/** Structured anime OP/ED discovery; identity confirmation remains MMDE's job. */
export function animeThemesProvider(fetchImpl: typeof fetch = fetch): DiscoveryProvider {
  const wait = createRateLimiter(700);
  return {
    name: 'animethemes',
    async discover(media: Media): Promise<TrackClaim[]> {
      if (media.type !== 'anime') return [];
      const params = new URLSearchParams({
        'page[size]': '5',
        include: 'animesynonyms,animethemes.song.artists,animethemes.animethemeentries',
      });
      const malId = media.externalIds.mal;
      if (malId) {
        params.set('filter[has]', 'resources');
        params.set('filter[site]', 'MyAnimeList');
        params.set('filter[external_id]', malId);
      } else {
        params.set('q', media.title);
      }
      await wait();
      const res = await fetchImpl(`https://api.animethemes.moe/anime?${params}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} from AnimeThemes`);
      const body = (await res.json()) as AnimeThemesResponse;
      const anime = bestAnime(unwrapAnime(body), media);
      if (!anime) return [];
      const out: TrackClaim[] = [];
      const seen = new Set<number>();
      for (const theme of anime.animethemes ?? []) {
        if (!theme.id || seen.has(theme.id)) continue;
        seen.add(theme.id);
        const r = role(theme.type);
        const title = theme.song?.title?.trim();
        if (!r || !title) continue;
        const artists = (theme.song?.artists ?? []).map((a) => a.name?.trim()).filter((x): x is string => !!x);
        const position = theme.sequence ? `${theme.type}${theme.sequence}` : theme.type ?? undefined;
        const entry = (theme.animethemeentries ?? [])[0];
        const context = [entry?.episodes ? `episodes ${entry.episodes}` : '', entry?.notes ?? ''].filter(Boolean).join('; ');
        out.push({
          part: partFor(media),
          role: r,
          position,
          title,
          artists,
          evidence: {
            provider: 'animethemes',
            url: anime.slug ? `https://animethemes.moe/anime/${anime.slug}` : 'https://animethemes.moe/',
            quote: context || undefined,
            fetchedAt: new Date().toISOString(),
          },
        });
      }
      return out;
    },
  };
}
