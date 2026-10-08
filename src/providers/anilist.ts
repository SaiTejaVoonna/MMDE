import type { Media, PartRef } from '../domain/types.ts';
import { createRateLimiter, type MediaResolver } from './types.ts';

// AniList is an identity/relationship resolver, not MMDE's music database.
// Keep its response short-lived/in-memory and use the IDs to fan out to other providers.
const QUERY = `query ($q: String) { Page(perPage: 8) { media(search: $q, type: ANIME) {
  id idMal seasonYear format
  title { romaji english native }
  synonyms
  relations {
    edges {
      relationType
      node {
        id idMal seasonYear format
        title { romaji english native }
        synonyms
      }
    }
  }
} } }`;

interface AniTitle { romaji?: string; english?: string; native?: string }
interface AniNode {
  id: number;
  idMal?: number | null;
  seasonYear?: number | null;
  format?: string | null;
  title: AniTitle;
  synonyms?: string[];
}
interface AniMedia extends AniNode {
  relations?: { edges?: Array<{ relationType?: string | null; node?: AniNode | null }> };
}

function inferPart(title: AniTitle, format?: string | null): PartRef {
  const text = [title.english, title.romaji, title.native].filter(Boolean).join(' ');
  if (format === 'MOVIE') return { kind: 'movie' };
  if (format === 'OVA') return { kind: 'ova' };
  if (format === 'SPECIAL' || format === 'ONA') return { kind: 'special' };
  const patterns = [
    /(?:season|part)\s*(\d+)/i,
    /\b(\d+)(?:st|nd|rd|th)\s+season\b/i,
    /\bcour\s*(\d+)\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return { kind: 'season', number: Number(m[1]) };
  }
  return { kind: 'whole' };
}

function toMedia(m: AniNode, relationType?: string): Media {
  const title = m.title.english ?? m.title.romaji ?? m.title.native ?? String(m.id);
  return {
    id: `anilist-${m.id}`,
    type: 'anime',
    title,
    altTitles: [m.title.romaji, m.title.native, ...(m.synonyms ?? [])].filter((x): x is string => !!x),
    year: m.seasonYear ?? undefined,
    externalIds: { anilist: String(m.id), ...(m.idMal ? { mal: String(m.idMal) } : {}) },
    partRef: inferPart(m.title, m.format),
    ...(relationType ? { relationType } : {}),
  };
}

function franchiseRelations(m: AniMedia): Media[] {
  const edges = m.relations?.edges ?? [];
  const allowed = new Set(['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'OTHER']);
  const seen = new Set<string>();
  const out: Media[] = [];
  for (const edge of edges) {
    const node = edge.node;
    if (!node || !edge.relationType || !allowed.has(edge.relationType)) continue;
    const child = toMedia(node, edge.relationType);
    if (child.id === `anilist-${m.id}` || seen.has(child.id)) continue;
    seen.add(child.id);
    out.push(child);
  }
  return out;
}

export function aniListResolver(fetchImpl: typeof fetch = fetch): MediaResolver {
  const wait = createRateLimiter(1000);
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
      return (data.data?.Page?.media ?? []).map((m) => {
        const media = toMedia(m);
        const relatedMedia = franchiseRelations(m);
        return relatedMedia.length ? { ...media, relatedMedia } : media;
      });
    },
  };
}
