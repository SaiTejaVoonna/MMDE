import type { Media } from '../domain/types.ts';
import { createRateLimiter, type MediaResolver } from './types.ts';

// NOT TESTED LIVE (sandbox egress was blocked when written). Verify against the real API.
// AniList terms: free non-commercial; no using the API as storage/backup; no mass collection.
// Keep results in a short-lived cache only; do not mirror the catalog.
const QUERY = `query ($q: String) { Page(perPage: 5) { media(search: $q, type: ANIME) {
  id idMal seasonYear title { romaji english native } synonyms } } }`;

interface AniMedia {
  id: number;
  idMal?: number | null;
  seasonYear?: number | null;
  title: { romaji?: string; english?: string; native?: string };
  synonyms?: string[];
}

export function aniListResolver(fetchImpl: typeof fetch = fetch): MediaResolver {
  const wait = createRateLimiter(1000); // well under 90/min
  return {
    name: 'anilist',
    async search(query: string): Promise<Media[]> {
      await wait();
      const res = await fetchImpl('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { q: query } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from AniList`);
      const data = (await res.json()) as { data?: { Page?: { media?: AniMedia[] } } };
      return (data.data?.Page?.media ?? []).map((m) => ({
        id: `anilist-${m.id}`,
        type: 'anime' as const,
        title: m.title.english ?? m.title.romaji ?? m.title.native ?? String(m.id),
        altTitles: [m.title.romaji, m.title.native, ...(m.synonyms ?? [])].filter((x): x is string => !!x),
        year: m.seasonYear ?? undefined,
        externalIds: { anilist: String(m.id), ...(m.idMal ? { mal: String(m.idMal) } : {}) },
      }));
    },
  };
}
