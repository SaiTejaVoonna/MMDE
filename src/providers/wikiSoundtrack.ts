import { normalizeTitle } from '../matching/normalize.ts';
import { uaHeaders } from './http.ts';

// Reads a film/series soundtrack tracklist from Wikipedia (CC BY-SA 4.0: always credit and link the page).
// Facts only (track names, credited singers, lengths). No AI involved: the tracklist tables are structured HTML.

export interface SoundtrackTrack { no: number; title: string; artists: string[]; lyricists: string[]; lengthSec?: number }
export interface SoundtrackSection { name: string; tracks: SoundtrackTrack[] }
export interface Soundtrack {
  page: { title: string; url: string };
  pageKind: 'soundtrack' | 'film';
  sections: SoundtrackSection[];
  license: 'CC BY-SA 4.0';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const plain = (html: string) =>
  decodeEntities(html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<sup[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/gi, '').replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]+>/g, ''))
    .replace(/\[[^\]]{0,12}\]/g, '') // [1] [a] [edit]
    .replace(/\s+/g, ' ')
    .trim();
// '"Kingdom Teaser OST" (Lyrics: Choir)' -> 'Kingdom Teaser OST (Lyrics: Choir)': keep notes, drop the quote marks around the title.
const stripQuotes = (s: string) => {
  const m = /^["“”«]\s*([^"“”»]+?)\s*["“”»]\s*(.*)$/.exec(s.trim());
  if (m) return (m[1]! + (m[2] ? ' ' + m[2] : '')).trim();
  return s.replace(/^["“”'‘’«]+|["“”'‘’»]+$/g, '').trim();
};

export function parseLength(s: string): number | undefined {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}
const splitNames = (s: string): string[] =>
  s.split(/\s*(?:,|&|;|\/|\band\b|\bfeat\.?\b|\bfeaturing\b)\s*/i).map((x) => x.trim()).filter((x) => x && x !== '-' && x !== '–' && x !== '—');

function colRole(h: string): 'no' | 'title' | 'lyrics' | 'artists' | 'length' | 'other' {
  const t = h.toLowerCase();
  if (/^(no|#|track)\b/.test(t)) return 'no';
  if (/\btitle\b|\bsong\b|\btrack\b/.test(t)) return 'title';
  if (/lyric|writer/.test(t)) return 'lyrics';
  if (/singer|artist|vocal|perform/.test(t)) return 'artists';
  if (/length|duration|time/.test(t)) return 'length';
  return 'other';
}

/** Pure parser: Wikipedia article HTML in, tracklist sections out. */
export function parseTracklists(html: string): SoundtrackSection[] {
  const re = /<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>|<p>\s*<b>((?:[^<]|<(?!\/?(?:b|p|table|h\d)\b))*)<\/b>\s*<\/p>|<table\b[^>]*class="[^"]*\btracklist\b[^"]*"[^>]*>([\s\S]*?)<\/table>/gi;
  const sections: SoundtrackSection[] = [];
  let heading = ''; let label = '';
  for (const m of html.matchAll(re)) {
    if (m[1]) { heading = plain(m[2]!); label = ''; continue; }
    if (m[3] !== undefined) { label = plain(m[3]); continue; }
    const body = m[4]!;
    const caption = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(body);
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => [...r[1]!.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => plain(c[2]!)));
    const headerIdx = rows.findIndex((r) => r.some((c) => /^title$|^song$/i.test(c)));
    if (headerIdx < 0) continue;
    const roles = rows[headerIdx]!.map(colRole);
    const tracks: SoundtrackTrack[] = [];
    for (const r of rows.slice(headerIdx + 1)) {
      if (r.length !== roles.length) continue; // "Total length" rows etc.
      const get = (role: string) => r[roles.indexOf(role as never)] ?? '';
      const no = Number(get('no').replace(/\.$/, ''));
      const title = stripQuotes(get('title'));
      if (!title || !Number.isFinite(no) || no <= 0) continue;
      const artists = roles.includes('artists') ? splitNames(get('artists')) : [];
      tracks.push({ no, title, artists, lyricists: roles.includes('lyrics') ? splitNames(get('lyrics')) : [], lengthSec: parseLength(get('length')) });
    }
    if (!tracks.length) continue;
    // Real pages put a generic caption ("Track Listing") on every table, so captions only count when they say something.
    const generic = (x: string) => !x || /^track\s?-?lists?(ing)?s?$/i.test(x.trim());
    const cap = caption ? plain(caption[1]!) : '';
    const parts: string[] = [];
    for (const x of [heading, label, cap]) if (!generic(x) && !parts.some((p) => p.toLowerCase() === x.toLowerCase())) parts.push(x);
    let name = parts.join(' · ') || 'Track listing';
    const dup = sections.filter((x) => x.name === name || x.name.startsWith(name + ' (')).length;
    if (dup) name = `${name} (${dup + 1})`;
    sections.push({ name, tracks });
  }
  return sections;
}

const API = 'https://en.wikipedia.org/w/api.php';
// "Bāhubali" (TMDB) vs "Baahubali" (Wikipedia): strip accents and collapse repeated letters before comparing.
export const foldTitle = (x: string) => normalizeTitle(x.normalize('NFD').replace(/\p{M}/gu, '')).replace(/(\p{L})\1+/gu, '$1');
/** Spellings worth trying as Wikipedia page names: as given, accents removed, and long vowels doubled. */
export function titleVariants(title: string): string[] {
  const plainTitle = title.normalize('NFD').replace(/\p{M}/gu, '');
  const doubled = title.replace(/ā/g, 'aa').replace(/ī/g, 'ii').replace(/ū/g, 'uu').replace(/Ā/g, 'Aa').normalize('NFD').replace(/\p{M}/gu, '');
  return [...new Set([title, plainTitle, doubled])];
}
const wikiUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%28/g, '(').replace(/%29/g, ')')}`;

export function wikiSoundtrack(userAgent: string, fetchImpl: typeof fetch = fetch) {
  const get = async (params: Record<string, string>) => {
    const res = await fetchImpl(`${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...(userAgent ? {} : { origin: '*' }), ...params })}`, { headers: uaHeaders(userAgent, { Accept: 'application/json', ...(userAgent ? { 'Api-User-Agent': userAgent } : {}) }) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Wikipedia`);
    return (await res.json()) as any;
  };
  const existing = async (titles: string[]): Promise<string[]> => {
    const d = await get({ action: 'query', titles: titles.join('|'), redirects: '1', prop: 'pageprops', ppprop: 'disambiguation' });
    return (d.query?.pages ?? []).filter((p: any) => !p.missing && !p.invalid && !p.pageprops?.disambiguation).map((p: any) => p.title as string);
  };
  const tracklistsOf = async (title: string): Promise<SoundtrackSection[]> => {
    const d = await get({ action: 'parse', page: title, prop: 'text', redirects: '1', disablelimitreport: '1', disableeditsection: '1' });
    return parseTracklists(String(d.parse?.text ?? ''));
  };
  return {
    async find(title0: string, year?: number, alts: string[] = []): Promise<Soundtrack | null> {
      const variants = [...new Set([...titleVariants(title0), ...alts.slice(0, 3).flatMap(titleVariants)])];
      const y = year ? ` (${year}` : '';
      const soundtrackNames = variants.flatMap((title) => [`${title} (soundtrack)`, ...(year ? [`${title}${y} soundtrack)`, `${title}${y} film soundtrack)`] : []), `${title} (film score)`, `${title} (score)`, `${title} (album)`, `${title} (original motion picture soundtrack)`]);
      const found = await existing(soundtrackNames.slice(0, 50));
      const tryPage = async (pageTitle: string, kind: Soundtrack['pageKind']): Promise<Soundtrack | null> => {
        const sections = await tracklistsOf(pageTitle);
        return sections.length ? { page: { title: pageTitle, url: wikiUrl(pageTitle) }, pageKind: kind, sections, license: 'CC BY-SA 4.0' } : null;
      };
      for (const t of found) { const r = await tryPage(t, 'soundtrack'); if (r) return r; }
      // Search fallback: a page whose title starts with the film title and mentions soundtrack/score/album.
      const want = foldTitle(title0);
      let hit: string | undefined;
      for (const v of [...new Set([...variants.slice(0, 2), ...alts.slice(0, 2)])]) {
        const s = await get({ action: 'query', list: 'search', srsearch: `${v} soundtrack`, srlimit: '8', srnamespace: '0' });
        hit = (s.query?.search ?? []).map((x: any) => String(x.title)).find((t: string) => /soundtrack|score|album/i.test(t) && [want, ...alts.slice(0, 2).map(foldTitle)].some((w) => foldTitle(t).startsWith(w)));
        if (hit) break;
      }
      if (hit) { const r = await tryPage(hit, 'soundtrack'); if (r) return r; }
      // Last resort: the film article itself (some films keep the tracklist in a Music section).
      const filmNames = await existing(variants.flatMap((v) => [...(year ? [`${v} (${year} film)`] : []), `${v} (film)`, v]).slice(0, 50));
      for (const t of filmNames) { const r = await tryPage(t, 'film'); if (r) return r; }
      return null;
    },
  };
}
