import { createRateLimiter } from './types.ts';
import { artistMatches, isFilmAlbum, looseFold, nameMatchesDistinctiveTitle } from './catalogAlbums.ts';
import { sortNameToName } from './musicbrainz.ts';

// MusicBrainz as a SOURCE OF OFFICIAL RELEASES: album title, label, barcode (UPC), date, language and every song with its ISRC.
// Core data is CC0. Rules: <= 1 request/second and a meaningful User-Agent. We never store the supplementary (CC BY-NC-SA) data.
// One search finds candidate releases; a lookup per accepted release returns the tracklist with ISRCs (at most MAX_LOOKUPS).

export interface MbTrack { no: number; title: string; artists: string[]; lengthSec?: number; isrcs: string[] }
export interface MbRelease {
  id: string; title: string; artist: string; artists: string[];
  date?: string; label?: string; barcode?: string; country?: string;
  /** Language NAME ("Telugu"), from the release's ISO 639-3 code when MusicBrainz states one. */
  language?: string;
  url: string; tracks: MbTrack[];
}

const LANGUAGES: Record<string, string> = {
  tel: 'Telugu', hin: 'Hindi', tam: 'Tamil', mal: 'Malayalam', kan: 'Kannada', ben: 'Bengali', mar: 'Marathi', pan: 'Punjabi', urd: 'Urdu',
  jpn: 'Japanese', zho: 'Chinese', cmn: 'Chinese', yue: 'Cantonese', kor: 'Korean', eng: 'English', spa: 'Spanish', fra: 'French', deu: 'German', tha: 'Thai', ind: 'Indonesian',
};
export const languageName = (iso: string | undefined): string | undefined => (iso ? LANGUAGES[iso.toLowerCase()] : undefined);
/** Album names often say it ("Baahubali 2 (Telugu)", "Hindi Version"): used when the catalog has no language field. */
export function languageFromName(name: string): string | undefined {
  const m = /\b(telugu|hindi|tamil|malayalam|kannada|bengali|marathi|punjabi|japanese|korean|mandarin|chinese|cantonese)\b/i.exec(name);
  if (!m) return undefined;
  const w = m[1]!.toLowerCase();
  return w === 'mandarin' ? 'Chinese' : w[0]!.toUpperCase() + w.slice(1);
}

interface MbCredit { name?: string; artist?: { name?: string; 'sort-name'?: string } }
const creditNames = (credits: MbCredit[] | undefined): string[] => {
  const names = new Set<string>();
  for (const c of credits ?? []) {
    if (c.name) names.add(c.name);
    if (c.artist?.name) names.add(c.artist.name);
    if (c.artist?.['sort-name']) names.add(sortNameToName(c.artist['sort-name']));
  }
  return [...names];
};

/** Pure: a MusicBrainz release lookup (inc=recordings+isrcs+artist-credits+labels) -> our shape. */
export function parseRelease(r: any): MbRelease {
  const tracks: MbTrack[] = [];
  let n = 0;
  for (const medium of r.media ?? []) {
    for (const t of medium.tracks ?? []) {
      n++;
      const rec = t.recording ?? {};
      const len = t.length ?? rec.length;
      tracks.push({
        no: Number(t.position) > 0 && (r.media ?? []).length === 1 ? Number(t.position) : n,
        title: String(t.title ?? rec.title ?? ''),
        artists: creditNames(t['artist-credit'] ?? rec['artist-credit']),
        lengthSec: typeof len === 'number' && len > 0 ? Math.round(len / 1000) : undefined,
        isrcs: Array.isArray(rec.isrcs) ? rec.isrcs.map(String) : [],
      });
    }
  }
  const li = (r['label-info'] ?? []).find((x: any) => x.label?.name) ?? undefined;
  return {
    id: String(r.id), title: String(r.title ?? ''), artist: creditNames(r['artist-credit'])[0] ?? '', artists: creditNames(r['artist-credit']),
    date: r.date ? String(r.date) : undefined, label: li?.label?.name ? String(li.label.name) : undefined,
    barcode: r.barcode ? String(r.barcode) : undefined, country: r.country ? String(r.country) : undefined,
    language: languageName(r['text-representation']?.language),
    url: `https://musicbrainz.org/release/${r.id}`, tracks: tracks.filter((t) => t.title),
  };
}

const MAX_LOOKUPS = 4;
const SOUNDTRACKY = /soundtrack|score|ost|original|music from|motion picture|theme|songs/i;

export function mbReleaseSource(userAgent: string, fetchImpl: typeof fetch = fetch, opts: { intervalMs?: number; backoffMs?: number } = {}) {
  const wait = createRateLimiter(opts.intervalMs ?? 1100);
  const backoff = opts.backoffMs ?? 2000;
  const cache = new Map<string, { at: number; value: MbRelease[] }>();
  const get = async (url: string): Promise<any> => {
    for (let attempt = 0; ; attempt++) {
      await wait();
      const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
      if (res.status === 503 && attempt < 2) { await new Promise((r) => setTimeout(r, backoff * (attempt + 1))); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status} from MusicBrainz`);
      return res.json();
    }
  };
  return {
    /**
     * Official releases for a title. `composers` (from TMDB) is what makes a release trustworthy: a release is kept when its credited artist
     * matches a composer, or its title contains a distinctive form of the film title. Names only ("Kingdom") are never enough with a composer known.
     */
    async find(title: string, alts: string[] = [], composers: string[] = []): Promise<MbRelease[]> {
      const key = `${looseFold(title)}|${alts.slice(0, 2).map(looseFold).join('+')}|${composers.map(looseFold).join('+')}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < 12 * 3600_000) return hit.value;
      // Releases often drop the subtitle ("Baahubali 2 (Telugu)" for "Bāhubali 2: The Conclusion"): also try the part before ":" / " - ".
      const base = (n: string) => n.split(/\s*[:–—]\s*|\s+-\s+/)[0]!.trim();
      const names = [...new Set([title, ...alts.slice(0, 2)].flatMap((n) => [n, base(n)]).filter((n) => n.length >= 4))];
      const found = new Map<string, any>();
      for (const name of names) {
        const q = `release:"${name.replace(/"/g, '')}"`;
        const d = await get(`https://musicbrainz.org/ws/2/release?${new URLSearchParams({ query: q, fmt: 'json', limit: '25' })}`);
        for (const r of d.releases ?? []) if (r.id && !found.has(r.id)) found.set(r.id, r);
      }
      const candidates = [...found.values()]
        .filter((r) => names.some((n) => isFilmAlbum(n, String(r.title ?? ''), alts)) && Number(r.media?.reduce((s: number, m: any) => s + (m['track-count'] ?? 0), 0) ?? 0) >= 2)
        .filter((r) => {
          const artists = creditNames(r['artist-credit']);
          return !composers.length || composers.some((c) => artists.some((a) => artistMatches(a, c))) || nameMatchesDistinctiveTitle(String(r.title), names);
        })
        .sort((a, b) => Number(SOUNDTRACKY.test(String(b.title))) - Number(SOUNDTRACKY.test(String(a.title))) || (b.score ?? 0) - (a.score ?? 0))
        .slice(0, MAX_LOOKUPS);
      const out: MbRelease[] = [];
      for (const c of candidates) {
        try {
          const r = await get(`https://musicbrainz.org/ws/2/release/${encodeURIComponent(String(c.id))}?${new URLSearchParams({ inc: 'recordings+isrcs+artist-credits+labels', fmt: 'json' })}`);
          const parsed = parseRelease(r);
          if (parsed.tracks.length) out.push(parsed);
        } catch { /* one release failing must not sink the rest */ }
      }
      cache.set(key, { at: Date.now(), value: out });
      if (cache.size > 500) cache.delete(cache.keys().next().value as string);
      return out;
    },
  };
}
