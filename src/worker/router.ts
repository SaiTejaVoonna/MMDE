import type { Media } from '../domain/types.ts';
import { mergeMediaResults } from '../app/media.ts';
import { buildMergedSoundtrack } from '../app/soundtrackService.ts';
import { animeThemesSource } from '../providers/animeThemesSearch.ts';
import { aniListResolver } from '../providers/anilist.ts';
import { artworkFinder } from '../providers/artwork.ts';
import { catalogResolver, type CatalogPlatform } from '../providers/catalogAlbums.ts';
import { deezerIsrcResolver } from '../providers/deezerIsrc.ts';
import { keylessTitles } from '../providers/keylessTitles.ts';
import { mbReleaseSource } from '../providers/mbReleases.ts';
import { tmdbDetails, tmdbResolver, tmdbSeasons, tmdbTrending } from '../providers/tmdb.ts';
import { trackLinkResolver } from '../providers/trackLinks.ts';
import { wikiSoundtrack } from '../providers/wikiSoundtrack.ts';
import { wikidataTitleSource } from '../providers/wikidataTitles.ts';

// The MMDE API as a plain function: path in, {status, body, cache} out. No Node or Cloudflare types here, so it is unit-tested
// with a fake fetch and runs unchanged inside a Cloudflare Worker (src/worker/index.ts adds CORS, rate limits and the shared cache).
// Same endpoints and answers as src/server/app.ts, minus the server-only job store and static files.

export interface EdgeOptions {
  /** TMDB "API Read Access Token". Absent = keyless sources only (AniList, Wikipedia, Wikidata); TMDB ids answer 503. */
  tmdbToken?: string;
  /** Sent to MusicBrainz / AnimeThemes / Wikipedia. Should say who to contact. */
  userAgent: string;
  fetchImpl?: typeof fetch;
}
/** How long a client or CDN may reuse the answer. */
export type CachePolicy = 'none' | 'short' | 'medium' | 'long';
export interface EdgeAnswer { status: number; body: unknown; cache: CachePolicy; /** Extra lifetime hint for a shared cache (seconds). */ ttl?: number }

export const CACHE_CONTROL: Record<CachePolicy, string> = {
  none: 'no-store',
  short: 'public, max-age=60, stale-while-revalidate=600',
  medium: 'public, max-age=120, stale-while-revalidate=1800',
  long: 'public, max-age=3600, stale-while-revalidate=86400',
};
/** Shared-cache lifetime per policy (seconds). */
export const CACHE_TTL: Record<CachePolicy, number> = { none: 0, short: 300, medium: 6 * 3600, long: 24 * 3600 };

class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
const bad = (m: string) => new HttpError(400, m);
const TMDB_TV_ID = /^tmdb-tv-\d{1,10}$/;
const TMDB_ID = /^tmdb-(tv|movie|collection)-\d{1,10}$/;
const KEYLESS_ID = /^(al-\d{1,10}|wd-Q\d{1,12})$/;
const year4 = (raw: string | null) => (raw && /^\d{4}$/.test(raw) ? Number(raw) : undefined);

export function createEdgeRouter(opts: EdgeOptions) {
  const ua = opts.userAgent;
  const base: typeof fetch = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  // The Workers runtime sends NO User-Agent by default (a browser or Node does), and Wikimedia answers such requests with 403 (seen in the live run).
  // Every outgoing call that lacks one gets ours, which names the project and a contact, as Wikimedia and MusicBrainz ask.
  const f: typeof fetch = (u, init) => { const h = new Headers(init?.headers); if (!h.has('user-agent')) h.set('user-agent', ua); return base(u, { ...init, headers: h }); };
  const token = opts.tmdbToken?.trim() || undefined;
  const catalog = catalogResolver(ua, f);
  const mb = mbReleaseSource(ua, f);
  const themes = animeThemesSource(ua, f);
  const wdt = wikidataTitleSource(ua, f);
  const wiki = wikiSoundtrack(ua, f);
  const links = trackLinkResolver(ua, f);
  const isrc = deezerIsrcResolver(ua, f);
  const keyless = keylessTitles(f);
  const art = artworkFinder(ua, f);
  const src = { wiki: (t: string, y?: number, a?: string[]) => wiki.find(t, y, a), albums: catalog.findAlbums, albumTracks: catalog.tracks, animeThemes: themes.find, musicBrainz: mb.find, wikidata: wdt.find, wikidataComposers: wdt.composers };
  const merged = new Map<string, { at: number; value: unknown }>();

  /** TMDB first when a token exists (AniList enriches the best hit, as on the server); otherwise AniList + Wikidata + Wikipedia without a key. */
  async function search(q: string, deep: boolean) {
    if (!token) { const r = await keyless.search(q); return { ...r, sources: ['anilist', 'wikidata', 'wikipedia'] }; }
    const errors: string[] = [];
    let results: Media[] = [];
    try { results = await tmdbResolver(token, f).search(q, { deep }); }
    catch (e) { errors.push(`tmdb: ${e instanceof Error ? e.message : 'failed'}`); }
    if (!results.length) { const r = await keyless.search(q); return { results: r.results, errors: [...errors, ...r.errors], sources: ['anilist', 'wikidata', 'wikipedia'] }; }
    let out = mergeMediaResults(results);
    const top = out[0];
    if (top) { try { out = mergeMediaResults([...out, ...(await aniListResolver(f).search(top.title))]); } catch (e) { errors.push(`anilist enrichment: ${e instanceof Error ? e.message : 'failed'}`); } }
    return { results: out, errors, sources: ['tmdb', 'anilist'] };
  }

  const list = (q: URLSearchParams, name: string, max: number, len: number) => (q.get(name) ?? '').split('|').map((x) => x.trim()).filter((x) => x && x.length <= len).slice(0, max);

  async function route(path: string): Promise<EdgeAnswer> {
    const url = new URL(path, 'http://mmde.local');
    const p = url.pathname; const q = url.searchParams;

    if (p === '/api/health') return { status: 200, cache: 'none', body: { ok: true, mode: 'edge', tmdb: !!token, resolvers: token ? ['tmdb', 'anilist'] : ['anilist', 'wikidata', 'wikipedia'], providers: [] } };

    if (p === '/api/search') {
      const query = (q.get('q') ?? '').trim();
      if (query.length > 120) throw bad('query too long');
      if (!query) return { status: 200, cache: 'short', body: { results: [], errors: [], sources: [] } };
      const r = await search(query, q.get('deep') === '1');
      return { status: 200, cache: r.errors.length ? 'none' : 'short', body: r };
    }

    if (p === '/api/trending') {
      const kind = q.get('kind') === 'anime' ? 'anime' : 'all';
      const results = token ? await tmdbTrending(token, kind, f) : await keyless.trending(kind);
      return { status: 200, cache: 'long', body: { results } };
    }

    if (p.startsWith('/api/details/')) {
      const id = decodeURIComponent(p.slice('/api/details/'.length));
      if (TMDB_ID.test(id)) {
        if (!token) throw new HttpError(503, 'TMDB is not configured on this server');
        return { status: 200, cache: 'long', body: await tmdbDetails(id, token, f) };
      }
      if (KEYLESS_ID.test(id)) return { status: 200, cache: 'long', body: await keyless.details(id, { composersFor: wdt.composers, titlesFor: wdt.find }) };
      throw bad('invalid id (expected tmdb-tv-, tmdb-movie-, tmdb-collection-, al- or wd-Q plus a number)');
    }

    if (p.startsWith('/api/seasons/')) {
      if (!token) throw new HttpError(503, 'TMDB is not configured on this server');
      const id = decodeURIComponent(p.slice('/api/seasons/'.length));
      if (!TMDB_TV_ID.test(id)) throw bad('invalid media id (expected tmdb-tv-<number>)');
      const media = { id, type: 'tv', title: '', altTitles: [], externalIds: { tmdb: id.replace(/^tmdb-tv-/, ''), tmdbType: 'tv' } } as Media;
      return { status: 200, cache: 'long', body: { seasons: await tmdbSeasons(media, token, f) } };
    }

    if (p === '/api/soundtrack-merged') {
      const title = (q.get('title') ?? '').trim(); const year = year4(q.get('year'));
      if (title.length < 2 || title.length > 120) throw bad('title must be 2-120 characters');
      const composers = list(q, 'composer', 4, 80); const alts = list(q, 'alt', 8, 120);
      const seasonRaw = q.get('season');
      const season = seasonRaw && /^\d{1,2}$/.test(seasonRaw) && Number(seasonRaw) >= 1 ? { number: Number(seasonRaw), airYear: year4(q.get('seasonYear')) } : undefined;
      const anime = q.get('anime') === '1'; const wikiOnly = q.get('stage') === 'wiki';
      const fast = wikiOnly || q.get('fast') === '1'; const fresh = q.get('fresh') === '1';
      const key = `${wikiOnly ? 'wiki|' : fast ? 'fast|' : ''}${title.toLowerCase()}|${year ?? ''}|${composers.join('+').toLowerCase()}|${alts.join('+').toLowerCase()}|${season ? season.number + '@' + (season.airYear ?? '') : ''}|${anime ? 'anime' : ''}`;
      const hit = fresh ? undefined : merged.get(key);
      if (hit && Date.now() - hit.at < 6 * 3600_000) return { status: 200, cache: 'medium', body: hit.value };
      const value = await buildMergedSoundtrack(src, title, year, { composers, alts, season, anime, fast, wikiOnly });
      if (value.partial) return { status: 200, cache: 'none', body: value };
      merged.set(key, { at: Date.now(), value });
      if (merged.size > 200) merged.delete(merged.keys().next().value as string);
      return { status: 200, cache: fresh ? 'none' : 'medium', body: value };
    }

    if (p === '/api/track-links') {
      const title = (q.get('title') ?? '').trim(); const film = (q.get('film') ?? '').trim();
      const artists = list(q, 'artist', 4, 80);
      if (title.length < 1 || title.length > 140 || film.length > 140) throw bad('invalid title or film');
      const lenRaw = q.get('length');
      const lengthSec = lenRaw && /^\d{1,4}$/.test(lenRaw) && Number(lenRaw) > 0 ? Number(lenRaw) : undefined;
      return { status: 200, cache: 'long', body: await links.resolve({ title, artists, film, lengthSec, year: year4(q.get('year')) }) };
    }

    if (p === '/api/albums') {
      const title = (q.get('title') ?? '').trim();
      if (title.length < 2 || title.length > 120) throw bad('title must be 2-120 characters');
      return { status: 200, cache: 'medium', body: { albums: await catalog.findAlbums(title, year4(q.get('year'))) } };
    }

    if (p === '/api/album-tracks') {
      const platform = q.get('platform') ?? ''; const id = q.get('id') ?? '';
      if (!['apple', 'deezer', 'deezer-playlist'].includes(platform) || !/^\d{1,15}$/.test(id)) throw bad('invalid platform or id');
      const store = q.get('country') ?? undefined;
      if (store !== undefined && !/^[a-z]{2}$/.test(store)) throw bad('invalid store');
      return { status: 200, cache: 'long', body: { tracks: await catalog.tracks(platform as CatalogPlatform, id, store) } };
    }

    if (p === '/api/deezer-isrc') {
      const id = q.get('id') ?? '';
      if (!/^\d{1,15}$/.test(id)) throw bad('id must be a Deezer track number');
      return { status: 200, cache: 'long', body: { isrc: await isrc(id) } };
    }

    if (p === '/api/artwork') {
      const title = (q.get('title') ?? '').trim();
      if (title.length < 2 || title.length > 120) throw bad('title must be 2-120 characters');
      const type = q.get('type') === 'movie' ? 'movie' : q.get('type') === 'tv' ? 'tv' : undefined;
      const found = await art.find({ title, year: year4(q.get('year')), type, anime: q.get('anime') === '1', alts: list(q, 'alt', 3, 120) });
      // "Nothing found" is cached briefly: it may be a passing failure, and a miss must not stick for a day.
      return { status: 200, cache: found ? 'long' : 'short', body: { artwork: found } };
    }

    throw new HttpError(404, 'not found');
  }

  return {
    /** Never throws: validation problems -> 400, unknown paths -> 404, upstream failures -> 502 (message only, never a stack or a secret). */
    async handle(path: string): Promise<EdgeAnswer> {
      let answer: EdgeAnswer;
      try { answer = await route(path); }
      catch (e) {
        if (e instanceof HttpError) answer = { status: e.status, cache: 'none', body: { error: e.message } };
        else answer = { status: 502, cache: 'none', body: { error: `lookup failed: ${e instanceof Error ? e.message : 'upstream error'}` } };
      }
      // Last line of defence: whatever an upstream put in its error text, the credential never leaves this function.
      if (token) { const text = JSON.stringify(answer.body); if (text.includes(token)) answer = { ...answer, body: JSON.parse(text.split(token).join('[redacted]')) }; }
      return answer;
    },
  };
}
