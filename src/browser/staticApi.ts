import type { Media } from '../domain/types.ts';
import { buildMergedSoundtrack } from '../app/soundtrackService.ts';
import { animeThemesSource } from '../providers/animeThemesSearch.ts';
import { catalogResolver } from '../providers/catalogAlbums.ts';
import { keylessTitles } from '../providers/keylessTitles.ts';
import { mbReleaseSource } from '../providers/mbReleases.ts';
import { tmdbDetails, tmdbResolver, tmdbTrending } from '../providers/tmdb.ts';
import { trackLinkResolver } from '../providers/trackLinks.ts';
import { wikiSoundtrack } from '../providers/wikiSoundtrack.ts';
import { wikidataTitleSource } from '../providers/wikidataTitles.ts';

/**
 * The same endpoints the server offers (/api/search, /api/details, /api/soundtrack-merged ...), answered INSIDE the visitor's browser.
 * Every lookup goes straight from the page to Wikipedia, Wikidata, AniList, MusicBrainz, AnimeThemes and Apple (all allow that: checked live),
 * so each visitor has their own rate limits and no server (or secret) is needed. Deezer is left out: it sends no CORS headers.
 * An optional TMDB token the visitor pastes (kept only in their browser) unlocks TMDB search, posters and details.
 */
export interface StaticApiOptions { getToken?: () => string | undefined; fetchImpl?: typeof fetch }

export function createStaticApi(opts: StaticApiOptions = {}) {
  const f: typeof fetch = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  // Empty user agent = no custom headers (a browser cannot set User-Agent, and a custom header would trigger a CORS preflight).
  const catalog = catalogResolver('', f, { deezer: false });
  const mb = mbReleaseSource('', f);
  const themes = animeThemesSource('', f);
  const wdt = wikidataTitleSource('', f);
  const wiki = wikiSoundtrack('', f);
  const links = trackLinkResolver('', f, { deezer: false });
  const keyless = keylessTitles(f);
  const src = {
    wiki: (t: string, y?: number, a?: string[]) => wiki.find(t, y, a), albums: catalog.findAlbums, albumTracks: catalog.tracks,
    animeThemes: themes.find, musicBrainz: mb.find, wikidata: wdt.find, wikidataComposers: wdt.composers,
  };
  const merged = new Map<string, { at: number; value: unknown }>();
  const token = () => (opts.getToken?.() ?? '').trim() || undefined;

  async function call(path: string): Promise<any> {
    const url = new URL(path, 'http://mmde.local');
    const p = url.pathname; const q = url.searchParams;
    const t = token();

    if (p === '/api/health') return { ok: true, mode: 'static', tmdb: !!t, cors: false, resolvers: t ? ['tmdb', 'anilist', 'wikidata'] : ['anilist', 'wikidata'], providers: [] };

    if (p === '/api/search') {
      const query = (q.get('q') ?? '').trim();
      if (!query) return { results: [], errors: [], sources: [] };
      if (t) {
        try { return { results: await tmdbResolver(t, f).search(query, { deep: q.get('deep') === '1' }), errors: [], sources: ['tmdb'] }; }
        catch (e) { const r = await keyless.search(query); return { ...r, errors: [`tmdb: ${e instanceof Error ? e.message : 'failed'}`, ...r.errors], sources: ['anilist', 'wikidata'] }; }
      }
      const r = await keyless.search(query);
      return { ...r, sources: ['anilist', 'wikidata'] };
    }

    if (p === '/api/trending') {
      const kind = q.get('kind') === 'anime' ? 'anime' : 'all';
      try { return { results: (t ? await tmdbTrending(t, kind, f) : await keyless.trending(kind)) as Media[] }; }
      catch (e) { throw new Error(`trending lookup failed: ${e instanceof Error ? e.message : 'upstream error'}`); }
    }

    if (p.startsWith('/api/details/')) {
      const id = decodeURIComponent(p.slice('/api/details/'.length));
      if (/^tmdb-(tv|movie|collection)-\d+$/.test(id)) {
        if (!t) throw new Error('This title comes from TMDB. Paste your free TMDB token under "Better search" on the home page, or search again without it.');
        return tmdbDetails(id, t, f);
      }
      if (/^(al-\d+|wd-Q\d+)$/.test(id)) return keyless.details(id, { composersFor: wdt.composers, titlesFor: wdt.find });
      throw new Error('invalid id');
    }

    if (p === '/api/soundtrack-merged') {
      const title = (q.get('title') ?? '').trim();
      const yearRaw = q.get('year');
      const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : undefined;
      if (title.length < 2 || title.length > 120) throw new Error('title must be 2-120 characters');
      const list = (name: string, max: number, len: number) => (q.get(name) ?? '').split('|').map((x) => x.trim()).filter((x) => x && x.length <= len).slice(0, max);
      const composers = list('composer', 4, 80); const alts = list('alt', 8, 120);
      const seasonRaw = q.get('season'); const airRaw = q.get('seasonYear');
      const season = seasonRaw && /^\d{1,2}$/.test(seasonRaw) && Number(seasonRaw) >= 1 ? { number: Number(seasonRaw), airYear: airRaw && /^\d{4}$/.test(airRaw) ? Number(airRaw) : undefined } : undefined;
      const anime = q.get('anime') === '1';
      const wikiOnly = q.get('stage') === 'wiki';
      const fast = wikiOnly || q.get('fast') === '1';
      const fresh = q.get('fresh') === '1';
      const key = `${wikiOnly ? 'wiki|' : fast ? 'fast|' : ''}${title.toLowerCase()}|${year ?? ''}|${composers.join('+').toLowerCase()}|${alts.join('+').toLowerCase()}|${season ? season.number + '@' + (season.airYear ?? '') : ''}|${anime ? 'anime' : ''}`;
      const hit = fresh ? undefined : merged.get(key);
      if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.value;
      const built = await buildMergedSoundtrack(src, title, year, { composers, alts, season, anime, fast, wikiOnly });
      // Deezer is not reachable from a browser: say so instead of implying it was checked.
      const value = { ...built, sources: (built.sources ?? []).map((x) => (x.key === 'catalog' ? { ...x, label: 'Apple Music (Deezer is not in the browser version)' } : x)) };
      if (!value.partial) merged.set(key, { at: Date.now(), value });
      return value;
    }

    if (p === '/api/track-links') {
      const title = (q.get('title') ?? '').trim(); const film = (q.get('film') ?? '').trim();
      const artists = (q.get('artist') ?? '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 4);
      if (title.length < 1 || title.length > 140 || film.length > 140) throw new Error('invalid title or film');
      const lenRaw = q.get('length'); const yrRaw = q.get('year');
      return links.resolve({ title, artists, film, lengthSec: lenRaw && /^\d{1,4}$/.test(lenRaw) && Number(lenRaw) > 0 ? Number(lenRaw) : undefined, year: yrRaw && /^\d{4}$/.test(yrRaw) ? Number(yrRaw) : undefined });
    }

    if (p === '/api/deezer-isrc') return { isrc: null }; // Deezer cannot be called from a browser

    throw new Error(`This part is not available in the browser-only version (${p})`);
  }

  return { call };
}
