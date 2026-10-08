import type { Media } from '../domain/types.ts';
import { createRateLimiter, type MediaResolver } from './types.ts';

interface SearchRow { title: string; snippet: string; pageid: number; }

function mediaType(title: string, snippet: string): Media['type'] {
  const text = `${title} ${snippet}`.toLowerCase();
  if (/\b(anime|manga)\b/.test(text)) return 'anime';
  if (/\b(tv series|television series|television show|tv show|series)\b/.test(text)) return 'tv';
  if (/\b(film|movie)\b/.test(text)) return 'movie';
  return 'other';
}

export function wikipediaResolver(fetchImpl: typeof fetch = fetch): MediaResolver {
  const wait = createRateLimiter(500);
  return {
    name: 'wikipedia',
    async search(query: string): Promise<Media[]> {
      const q = query.trim();
      if (!q) return [];
      await wait();
      const url = new URL('https://en.wikipedia.org/w/api.php');
      url.searchParams.set('action', 'query');
      url.searchParams.set('list', 'search');
      url.searchParams.set('srsearch', q);
      url.searchParams.set('srlimit', '8');
      url.searchParams.set('format', 'json');
      url.searchParams.set('origin', '*');
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} from Wikipedia`);
      const data = (await res.json()) as { query?: { search?: SearchRow[] } };
      return (data.query?.search ?? []).map((row) => ({
        id: `wikipedia-${row.pageid}`,
        type: mediaType(row.title, row.snippet),
        title: row.title,
        altTitles: [],
        externalIds: { wikipedia: String(row.pageid) },
      }));
    },
  };
}
