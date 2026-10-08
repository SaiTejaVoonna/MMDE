import type { Media, PartRef, TrackClaim, TrackRole } from '../domain/types.ts';
import { createRateLimiter, type DiscoveryProvider } from './types.ts';

interface Song { id?: number; title?: { romaji?: string; native?: string }; performances?: Array<{ relevance?: number; alias?: string | null; as?: string | null; artist?: { id?: number; name?: { main?: string; native?: string } }; member?: { id?: number; name?: { main?: string; native?: string } } }> }
interface Entry { id?: number; version?: number; episodes?: string | null; notes?: string | null }
interface Theme { id?: number; type?: string | null; sequence?: number | null; slug?: string; song?: Song | null; animethemeentries?: Entry[] }
interface Anime { id?: number; name?: string; slug?: string; title?: { romaji?: string; english?: string; native?: string }; animethemes?: Theme[] }
interface GraphQLResponse { data?: { findAnimeByExternalSite?: Anime[] }; errors?: Array<{ message?: string }> }

function role(type?: string | null): TrackRole | null {
  if (type === 'OP') return 'opening';
  if (type === 'ED') return 'ending';
  return null;
}

function partFor(media: Media): PartRef { return media.partRef ?? { kind: 'whole' }; }

/**
 * AnimeThemes' current GraphQL API is used instead of the JSON API because the
 * GraphQL endpoint is the upstream surface used by their own scheduled tooling.
 * We resolve by MAL id when possible, avoiding fuzzy title selection.
 */
export function animeThemesProvider(fetchImpl: typeof fetch = fetch): DiscoveryProvider {
  const wait = createRateLimiter(700);
  return {
    name: 'animethemes',
    async discover(media: Media): Promise<TrackClaim[]> {
      if (media.type !== 'anime') return [];
      const mal = media.externalIds.mal;
      if (!mal) return [];

      const query = `query FindAnime($ids: [Int!]) {
        findAnimeByExternalSite(site: MAL, id: $ids) {
          id slug
          title { romaji english native }
          animethemes {
            id slug type sequence
            song { id title { romaji native } performances { relevance alias as artist { id name { main native } } member { id name { main native } } } }
            animethemeentries { id version episodes notes }
          }
        }
      }`;
      await wait();
      const res = await fetchImpl('https://graphql.animethemes.moe/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: 'https://graphql.animethemes.moe',
          Referer: 'https://graphql.animethemes.moe/',
          'User-Agent': 'MMDE-prototype/0.2',
        },
        body: JSON.stringify({ query, variables: { ids: [Number(mal)] }, operationName: 'FindAnime' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from AnimeThemes GraphQL`);
      const body = (await res.json()) as GraphQLResponse;
      if (body.errors?.length && !body.data?.findAnimeByExternalSite?.length) {
        throw new Error(`GraphQL: ${body.errors.map((e) => e.message ?? 'unknown error').join('; ')}`);
      }
      const anime = body.data?.findAnimeByExternalSite?.[0];
      if (!anime) return [];

      const out: TrackClaim[] = [];
      const seen = new Set<number>();
      for (const theme of anime.animethemes ?? []) {
        if (!theme.id || seen.has(theme.id)) continue;
        seen.add(theme.id);
        const r = role(theme.type);
        const title = theme.song?.title?.romaji?.trim() || theme.song?.title?.native?.trim();
        if (!r || !title) continue;
        const artists = (theme.song?.performances ?? []).sort((a, b) => (a.relevance ?? 999) - (b.relevance ?? 999)).flatMap((p) => [p.artist?.name?.main, p.artist?.name?.native, p.member?.name?.main, p.member?.name?.native]).map((x) => x?.trim()).filter((x): x is string => !!x).filter((x, i, a) => a.indexOf(x) === i);
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
