import { createRateLimiter } from './types.ts';
import { titleVariants } from './wikiSoundtrack.ts';

// Wikidata (CC0, free, no key): the same film/series under its names in other languages (Japanese, Chinese, Korean, Telugu, Hindi, Tamil...).
// Used only to widen the title searches in the music catalogs; it never decides what belongs to a title (composer / catalog evidence does).
const LANGS = ['ja', 'zh', 'ko', 'te', 'hi', 'ta', 'ml', 'kn', 'en'];
const FILMY = /\b(film|movie|television series|tv series|anime|web series|animated series|miniseries)\b/i;

export function wikidataTitleSource(userAgent: string, fetchImpl: typeof fetch = fetch) {
  const wait = createRateLimiter(250);
  const get = async (params: Record<string, string>) => {
    await wait();
    const res = await fetchImpl(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Wikidata`);
    return (await res.json()) as any;
  };
  const lookups = new Map<string, { at: number; value: Promise<{ titles: string[]; composers: string[] }> }>();
  const lookup = (title: string, year?: number, alts: string[] = []) => {
    const key = `${title.toLowerCase()}|${year ?? ''}|${alts.slice(0, 2).join('+').toLowerCase()}`;
    const hit = lookups.get(key);
    if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.value;
    const value = run(title, year, alts).catch((e) => { lookups.delete(key); throw e; });
    lookups.set(key, { at: Date.now(), value });
    if (lookups.size > 500) lookups.delete(lookups.keys().next().value as string);
    return value;
  };
  async function run(title: string, year?: number, alts: string[] = []): Promise<{ titles: string[]; composers: string[] }> {
      // Wikidata matches plain spellings: try the title, its accent-free / doubled-vowel forms ("Bāhubali" -> "Baahubali"), then the alternative titles.
      const names = [...new Set([...titleVariants(title), ...alts.slice(0, 2).flatMap(titleVariants)])].slice(0, 5);
      let ok: any[] = [];
      for (const name of names) {
        const s = await get({ action: 'wbsearchentities', search: name, language: 'en', type: 'item', limit: '8' });
        ok = (s.search ?? []).filter((x: any) => FILMY.test(String(x.description ?? '')) && (!year || !/\b(1[89]|20)\d{2}\b/.test(String(x.description)) || String(x.description).includes(String(year))));
        if (ok.length) break;
      }
      const out: string[] = [];
      const composers: string[] = [];
      if (ok.length) {
        const ent = await get({ action: 'wbgetentities', ids: String(ok[0].id), props: 'labels|aliases|claims', languages: LANGS.join('|') });
        const e = Object.values(ent.entities ?? {})[0] as any;
        // Composer (property P86): only trusted when the entity's description names the same year we asked for.
        if (year && String(ok[0].description ?? '').includes(String(year))) {
          const ids = (e?.claims?.P86 ?? []).map((c: any) => c?.mainsnak?.datavalue?.value?.id).filter((x: unknown) => typeof x === 'string').slice(0, 3);
          if (ids.length) {
            const lab = await get({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels', languages: 'en' });
            for (const id of ids) { const n = lab.entities?.[id]?.labels?.en?.value; if (n) composers.push(String(n)); }
          }
        }
        for (const l of LANGS) {
          const label = e?.labels?.[l]?.value; if (label) out.push(String(label));
          for (const a of e?.aliases?.[l] ?? []) if (a?.value) out.push(String(a.value));
        }
      }
      const norm = (x: string) => x.normalize('NFKC').toLowerCase().trim();
      const seen = new Set([norm(title)]);
      const titles = out.filter((x) => { const k = norm(x); if (!k || k.length < 3 || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
      return { titles, composers };
  }
  return {
    /** Other-language titles of the work. The entity must look like a film/series, and when a year is known its description must not name a different year. */
    find: async (title: string, year?: number, alts: string[] = []): Promise<string[]> => (await lookup(title, year, alts)).titles,
    /** The composer(s) Wikidata lists for the film, only when its description names the same year (so a same-named film of another year is never used). */
    composers: async (title: string, year?: number, alts: string[] = []): Promise<string[]> => (await lookup(title, year, alts)).composers,
  };
}
