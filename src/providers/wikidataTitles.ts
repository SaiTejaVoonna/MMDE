import { createRateLimiter } from './types.ts';

// Wikidata (CC0, free, no key): the same film/series under its names in other languages (Japanese, Chinese, Korean, Telugu, Hindi, Tamil...).
// Used only to widen the title searches in the music catalogs; it never decides what belongs to a title (composer / catalog evidence does).
const LANGS = ['ja', 'zh', 'ko', 'te', 'hi', 'ta', 'ml', 'kn', 'en'];
const FILMY = /\b(film|movie|television series|tv series|anime|web series|animated series|miniseries)\b/i;

export function wikidataTitleSource(userAgent: string, fetchImpl: typeof fetch = fetch) {
  const wait = createRateLimiter(250);
  const cache = new Map<string, { at: number; value: string[] }>();
  const get = async (params: Record<string, string>) => {
    await wait();
    const res = await fetchImpl(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Wikidata`);
    return (await res.json()) as any;
  };
  return {
    /** Other-language titles of the work. The entity must look like a film/series, and when a year is known its description must not name a different year. */
    async find(title: string, year?: number): Promise<string[]> {
      const key = `${title.toLowerCase()}|${year ?? ''}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.value;
      const s = await get({ action: 'wbsearchentities', search: title, language: 'en', type: 'item', limit: '8' });
      const ok = (s.search ?? []).filter((x: any) => FILMY.test(String(x.description ?? '')) && (!year || !/\b(1[89]|20)\d{2}\b/.test(String(x.description)) || String(x.description).includes(String(year))));
      const out: string[] = [];
      if (ok.length) {
        const ent = await get({ action: 'wbgetentities', ids: String(ok[0].id), props: 'labels|aliases', languages: LANGS.join('|') });
        const e = Object.values(ent.entities ?? {})[0] as any;
        for (const l of LANGS) {
          const label = e?.labels?.[l]?.value; if (label) out.push(String(label));
          for (const a of e?.aliases?.[l] ?? []) if (a?.value) out.push(String(a.value));
        }
      }
      const norm = (x: string) => x.normalize('NFKC').toLowerCase().trim();
      const seen = new Set([norm(title)]);
      const value = out.filter((x) => { const k = norm(x); if (!k || k.length < 3 || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
      cache.set(key, { at: Date.now(), value });
      if (cache.size > 500) cache.delete(cache.keys().next().value as string);
      return value;
    },
  };
}
