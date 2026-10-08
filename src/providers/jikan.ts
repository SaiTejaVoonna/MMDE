import type { Media } from '../domain/types.ts';
import { createRateLimiter, type MediaResolver } from './types.ts';

interface JikanItem {
  mal_id: number;
  url?: string;
  title?: string;
  title_english?: string | null;
  title_japanese?: string | null;
  title_synonyms?: string[];
  type?: string | null;
  year?: number | null;
  aired?: { from?: string | null };
}

function partKind(type?: string | null): Media['partRef'] {
  if (type === 'Movie') return { kind: 'movie' };
  if (type === 'OVA') return { kind: 'ova' };
  if (type === 'Special' || type === 'ONA') return { kind: 'special' };
  return { kind: 'whole' };
}

export function jikanResolver(fetchImpl: typeof fetch = fetch): MediaResolver {
  const wait = createRateLimiter(900);
  return {
    name: 'jikan',
    async search(query: string): Promise<Media[]> {
      const q = query.trim();
      if (!q) return [];
      await wait();
      const url = new URL('https://api.jikan.moe/v4/anime');
      url.searchParams.set('q', q);
      url.searchParams.set('limit', '12');
      url.searchParams.set('sfw', 'true');
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} from Jikan`);
      const data = (await res.json()) as { data?: JikanItem[] };
      return (data.data ?? []).map((m) => ({
        id: `mal-${m.mal_id}`,
        type: 'anime' as const,
        title: m.title_english || m.title || m.title_japanese || String(m.mal_id),
        altTitles: [m.title, m.title_english ?? undefined, m.title_japanese ?? undefined, ...(m.title_synonyms ?? [])].filter((x): x is string => !!x),
        year: m.year ?? (m.aired?.from ? Number(m.aired.from.slice(0, 4)) : undefined),
        externalIds: { mal: String(m.mal_id), ...(m.url ? { malUrl: m.url } : {}) },
        partRef: partKind(m.type),
      }));
    },
  };
}
