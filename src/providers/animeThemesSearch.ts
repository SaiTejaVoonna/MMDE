import { createRateLimiter } from './types.ts';
import { uaHeaders } from './http.ts';

// AnimeThemes (public API, no key): the original opening/ending songs of anime, one entry per season/cour, with artists.
// We use it as a SOURCE OF SONGS and link back to the animethemes.moe page (their videos are theirs; MMDE never hosts or plays anything).

export interface AnimeThemeSong { slug: string; type: 'OP' | 'ED' | string; sequence?: number; title: string; artists: string[]; url: string }
export interface AnimeThemesEntry { name: string; year?: number; season?: string; slug: string; themes: AnimeThemeSong[] }

const fold = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/(\p{L})\1+/gu, '$1').trim();
/** "Enen no Shouboutai: Ni no Shou" -> "enen no shouboutai": the franchise name shared by all seasons. */
export const franchiseKey = (name: string) => fold(name.split(':')[0]!);

/**
 * Pick the franchise AnimeThemes means. The top search hit decides which franchise, and it only counts when one of its entries
 * started within a year of the title's first air year (so a same-named but unrelated anime is never mixed in).
 */
export function pickFranchise(results: Array<{ name: string; year?: number }>, firstYear?: number): string | undefined {
  for (const r of results) {
    const key = franchiseKey(r.name);
    if (!key) continue;
    const group = results.filter((x) => franchiseKey(x.name) === key);
    if (!firstYear || group.some((g) => g.year !== undefined && Math.abs(g.year - firstYear) <= 1)) return key;
  }
  return undefined;
}

export function animeThemesSource(userAgent: string, fetchImpl: typeof fetch = fetch) {
  const wait = createRateLimiter(700);
  const cache = new Map<string, { at: number; value: AnimeThemesEntry[] }>();
  return {
    /** Entries (all seasons) for a title; the caller scopes them to one season. */
    async find(title: string, alts: string[], firstYear?: number): Promise<AnimeThemesEntry[]> {
      const key = `${fold(title)}|${firstYear ?? ''}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < 12 * 3600_000) return hit.value;
      let entries: AnimeThemesEntry[] = [];
      let lastError: unknown;
      for (const term of [title, ...alts.filter((a) => /^[\p{Script=Latin}\d\s\p{P}]+$/u.test(a))].slice(0, 3)) {
        await wait();
        try {
          const res = await fetchImpl('https://api.animethemes.moe/anime?' + new URLSearchParams({ q: term, include: 'animethemes.song.artists', 'page[size]': '12' }), { headers: uaHeaders(userAgent, { Accept: 'application/json' }) });
          if (!res.ok) throw new Error(`HTTP ${res.status} from AnimeThemes`);
          const data = (await res.json()) as { anime?: Array<any> };
          const results = (data.anime ?? []).map((a) => ({ name: String(a.name ?? ''), year: typeof a.year === 'number' ? a.year : undefined, a }));
          const franchise = pickFranchise(results, firstYear);
          if (!franchise) continue;
          entries = results.filter((r) => franchiseKey(r.name) === franchise).map(({ a }): AnimeThemesEntry => ({
            name: String(a.name), year: typeof a.year === 'number' ? a.year : undefined, season: a.season ? String(a.season) : undefined, slug: String(a.slug ?? ''),
            themes: ((a.animethemes ?? []) as any[]).filter((t) => t.song?.title).map((t): AnimeThemeSong => ({
              slug: String(t.slug ?? t.type), type: String(t.type ?? ''), sequence: typeof t.sequence === 'number' ? t.sequence : undefined,
              title: String(t.song.title), artists: ((t.song.artists ?? []) as any[]).map((x) => String(x.name ?? '')).filter(Boolean),
              url: `https://animethemes.moe/anime/${a.slug}/${t.slug ?? ''}`,
            })),
          })).filter((e) => e.themes.length);
          if (entries.length) break;
        } catch (e) { lastError = e; }
      }
      if (!entries.length && lastError) throw lastError;
      entries.sort((x, y) => (x.year ?? 0) - (y.year ?? 0) || x.name.localeCompare(y.name));
      cache.set(key, { at: Date.now(), value: entries });
      return entries;
    },
  };
}
