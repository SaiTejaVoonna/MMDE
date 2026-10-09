import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { Media } from '../domain/types.ts';
import { normalizeTitle } from '../matching/normalize.ts';
import { mergeMediaResults } from '../app/media.ts';
import type { MediaResolver } from '../providers/types.ts';
import { newSteps, runDiscovery, type Deps, type Step } from './runner.ts';
import type { Store } from './store.ts';
import { organize } from '../app/organize.ts';
import { tmdbSeasons, tmdbDetails, tmdbTrending, type TmdbSeason, type TmdbDetails } from '../providers/tmdb.ts';
import type { Soundtrack } from '../providers/wikiSoundtrack.ts';
import type { TrackLinksResult, TrackQuery } from '../providers/trackLinks.ts';
import type { CatalogAlbum, CatalogPlatform, CatalogTrack } from '../providers/catalogAlbums.ts';
import { buildMergedSoundtrack } from '../app/soundtrackService.ts';
import type { AnimeThemesEntry } from '../providers/animeThemesSearch.ts';
import type { MbRelease } from '../providers/mbReleases.ts';
import type { MergedSoundtrack } from '../app/soundtrackMerge.ts';
import { decideCors } from './cors.ts';
import { clientKey, createRateLimiter, type Limit } from './rateLimit.ts';

export interface AppDeps extends Deps {
  mediaResolvers: MediaResolver[];
  store: Store;
  webRoot: string;
  tmdbToken?: string;
  /** Exact origins allowed to call the API from another site, e.g. ["https://saitejavoonna.github.io"]. Empty = same-origin only. */
  allowedOrigins?: string[];
  /** Trust X-Forwarded-For for rate limiting (only behind a proxy such as Railway). */
  trustProxy?: boolean;
  /** Per-client limits. Defaults: 300 API calls/min, 12 discovery jobs/min. */
  rateLimit?: { general: Limit; discover: Limit };
  /** Injectable for tests; defaults to the real TMDB season lookup. */
  seasons?: (media: Media, token: string) => Promise<TmdbSeason[]>;
  /** Injectable for tests; defaults to the real TMDB details lookup (movie, tv or collection). */
  details?: (id: string, token: string) => Promise<TmdbDetails>;
  /** Injectable for tests; home-page rows ("all" = trending this week, "anime" = popular anime). */
  trending?: (kind: 'all' | 'anime', token: string) => Promise<Media[]>;
  /** Wikipedia tracklist lookup. Absent (offline mode) = the endpoint answers 503. */
  soundtrack?: (title: string, year?: number, alts?: string[]) => Promise<Soundtrack | null>;
  /** Per-track Apple Music / Deezer match. Absent = 503. */
  trackLinks?: (q: TrackQuery) => Promise<TrackLinksResult>;
  /** Apple Music / Deezer albums and playlists named after a film (fallback when Wikipedia has no tracklist). */
  albums?: (title: string, year?: number, extraNames?: string[], alts?: string[]) => Promise<CatalogAlbum[]>;
  albumTracks?: (platform: CatalogPlatform, id: string) => Promise<CatalogTrack[]>;
  /** Anime opening/ending songs per season (AnimeThemes). Optional. */
  animeThemes?: (title: string, alts: string[], firstYear?: number) => Promise<AnimeThemesEntry[]>;
  musicBrainz?: (title: string, alts: string[], composers: string[]) => Promise<MbRelease[]>;
  wikidata?: (title: string, year?: number, alts?: string[]) => Promise<string[]>;
  wikidataComposers?: (title: string, year?: number, alts?: string[]) => Promise<string[]>;
  deezerIsrc?: (id: string) => Promise<string | null>;
}

const DEFAULT_LIMITS = { general: { windowMs: 60_000, max: 300 }, discover: { windowMs: 60_000, max: 12 } };
const TMDB_TV_ID = /^tmdb-tv-\d{1,10}$/;
const TMDB_ID = /^tmdb-(tv|movie|collection)-\d{1,10}$/;

interface Job { id: string; mediaId: string; state: 'running' | 'done' | 'error'; steps: Step[]; error?: string }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon',
};

// Compress anything over 1 KB when the browser accepts gzip (soundtrack answers are large and repetitive: this cuts load time on slow networks).
const wantsGzip = (res: ServerResponse) => /\bgzip\b/i.test(String(res.req?.headers['accept-encoding'] ?? ''));
const writeBody = (res: ServerResponse, code: number, headers: Record<string, string>, data: Buffer) => {
  if (data.length > 1024 && wantsGzip(res)) {
    const prev = res.getHeader('vary');
    res.writeHead(code, { ...headers, 'content-encoding': 'gzip', vary: prev ? `${String(prev)}, Accept-Encoding` : 'Accept-Encoding' });
    res.end(gzipSync(data));
  } else res.writeHead(code, headers), res.end(data);
};
/** `cache` lets read-only answers be reused by the browser (and any CDN) for a while; the default stays no-store. */
const send = (res: ServerResponse, code: number, body: unknown, cache = 'no-store') => {
  writeBody(res, code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache }, Buffer.from(JSON.stringify(body)));
};

async function readJson(req: IncomingMessage, limit = 100_000): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function validMedia(m: any): m is Media {
  return !!m && typeof m.id === 'string' && m.id.length <= 200 && typeof m.title === 'string' && m.title.length <= 300 &&
    Array.isArray(m.altTitles) && m.altTitles.every((x: unknown) => typeof x === 'string') && typeof m.type === 'string' &&
    m.externalIds && typeof m.externalIds === 'object';
}

export function createApp(deps: AppDeps): Server {
  const jobs = new Map<string, Job>();
  const allowedOrigins = deps.allowedOrigins ?? [];
  const limits = deps.rateLimit ?? DEFAULT_LIMITS;
  const generalLimiter = createRateLimiter(limits.general);
  const discoverLimiter = createRateLimiter(limits.discover);
  const getSeasons = deps.seasons ?? tmdbSeasons;
  const soundtrackCache = new Map<string, { at: number; value: Soundtrack | null }>();
  const mergedCache = new Map<string, { at: number; value: MergedSoundtrack }>();
  const trendingCache = new Map<string, { at: number; value: Media[] }>();
  const getTrending = deps.trending ?? ((kind: 'all' | 'anime', token: string) => tmdbTrending(token, kind));
  const getDetails = deps.details ?? ((id: string, token: string) => tmdbDetails(id, token));

  /**
   * Query resolvers in parallel (results keep resolver order). Optional `sources` (resolver names) narrows the
   * lookup, e.g. the fast TMDB phase; if none of the requested sources exist on this server (say TMDB has no
   * credential) all resolvers are used so search still answers.
   */
  async function search(q: string, sources?: string[], deep = false) {
    const wanted = sources?.length ? deps.mediaResolvers.filter((r) => sources.includes(r.name)) : [];
    const used = wanted.length ? wanted : deps.mediaResolvers;
    const settled = await Promise.allSettled(used.map((r) => r.search(q, { deep })));
    const results: Media[] = [];
    const errors: string[] = [];
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') results.push(...s.value);
      else errors.push(`${used[i]!.name}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
    });
    let merged = mergeMediaResults(results);
    const canonical = merged[0];
    const anilist = used.find((r) => r.name === 'anilist');
    if (canonical && anilist) {
      try { merged = mergeMediaResults([...merged, ...(await anilist.search(canonical.title))]); }
      catch (e) { errors.push(`anilist enrichment: ${e instanceof Error ? e.message : String(e)}`); }
    }
    return { results: merged, errors, sources: used.map((r) => r.name) };
  }

  async function serveStatic(pathname: string, res: ServerResponse) {
    const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^([/\\])+/, '');
    const full = join(deps.webRoot, rel);
    if (!full.startsWith(deps.webRoot + sep) && full !== deps.webRoot) return send(res, 403, { error: 'forbidden' });
    try {
      const data = await readFile(full);
      const type = MIME[extname(full)] ?? 'application/octet-stream';
      // "no-cache" = the browser re-checks before reuse, so a new deploy shows up without a hard refresh.
      const headers = { 'content-type': type, 'cache-control': 'no-cache' };
      if (/^(text\/|application\/(javascript|json))/.test(type)) writeBody(res, 200, headers, data); else { res.writeHead(200, headers); res.end(data); }
    } catch {
      send(res, 404, { error: 'not found' });
    }
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');

      if (path.startsWith('/api/')) {
        // CORS: allowlist only. Cross-origin callers that are not listed are refused before any work is done.
        const cors = decideCors(req.headers.origin, req.headers.host, allowedOrigins);
        if (cors.kind === 'denied') return send(res, 403, { error: 'origin not allowed' });
        if (cors.kind === 'allowed') for (const [k, v] of Object.entries(cors.headers)) res.setHeader(k, v);
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        // Rate limiting (health is exempt so platform health checks never get a 429).
        if (path !== '/api/health') {
          const key = clientKey(req, !!deps.trustProxy);
          const general = generalLimiter.check(key);
          const discover = req.method === 'POST' && path === '/api/discover' ? discoverLimiter.check(key) : { ok: true as const };
          const blocked = !general.ok ? general : !discover.ok ? discover : null;
          if (blocked && !blocked.ok) {
            res.setHeader('Retry-After', String(blocked.retryAfterSec));
            return send(res, 429, { error: 'too many requests, slow down', retryAfterSec: blocked.retryAfterSec });
          }
        }
      }

      if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, tmdb: !!deps.tmdbToken, cors: allowedOrigins.length > 0, resolvers: deps.mediaResolvers.map((r) => r.name), providers: deps.providers.map((p) => p.name) });
      if (req.method === 'GET' && path === '/api/search') return send(res, 200, await search(url.searchParams.get('q') ?? '', (url.searchParams.get('sources') ?? '').split(',').map((x) => x.trim()).filter(Boolean), url.searchParams.get('deep') === '1'));
      if (req.method === 'GET' && path.startsWith('/api/seasons/')) {
        if (!deps.tmdbToken) return send(res, 503, { error: 'TMDB is not configured on this server' });
        const id = decodeURIComponent(path.slice('/api/seasons/'.length));
        if (!TMDB_TV_ID.test(id)) return send(res, 400, { error: 'invalid media id (expected tmdb-tv-<number>)' });
        const media = { id, type: 'tv', title: '', altTitles: [], externalIds: { tmdb: id.replace(/^tmdb-tv-/, ''), tmdbType: 'tv' } } as Media;
        try { return send(res, 200, { seasons: await getSeasons(media, deps.tmdbToken) }); }
        catch (e) { return send(res, 502, { error: `season lookup failed: ${e instanceof Error ? e.message : 'upstream error'}` }); }
      }
      if (req.method === 'GET' && path === '/api/trending') {
        if (!deps.tmdbToken) return send(res, 503, { error: 'TMDB is not configured on this server' });
        const kind = url.searchParams.get('kind') === 'anime' ? 'anime' : 'all';
        const hit = trendingCache.get(kind);
        if (hit && Date.now() - hit.at < 3600_000) return send(res, 200, { results: hit.value });
        try { const value = await getTrending(kind, deps.tmdbToken); trendingCache.set(kind, { at: Date.now(), value }); return send(res, 200, { results: value }); }
        catch (e) { return send(res, 502, { error: `trending lookup failed: ${e instanceof Error ? e.message : 'upstream error'}` }); }
      }
      if (req.method === 'GET' && path.startsWith('/api/details/')) {
        if (!deps.tmdbToken) return send(res, 503, { error: 'TMDB is not configured on this server' });
        const id = decodeURIComponent(path.slice('/api/details/'.length));
        if (!TMDB_ID.test(id)) return send(res, 400, { error: 'invalid id (expected tmdb-tv-, tmdb-movie- or tmdb-collection- plus a number)' });
        try { return send(res, 200, await getDetails(id, deps.tmdbToken)); }
        catch (e) { return send(res, 502, { error: `details lookup failed: ${e instanceof Error ? e.message : 'upstream error'}` }); }
      }
      if (req.method === 'GET' && path === '/api/soundtrack') {
        if (!deps.soundtrack) return send(res, 503, { error: 'soundtrack lookup is not available on this server' });
        const title = (url.searchParams.get('title') ?? '').trim();
        const yearRaw = url.searchParams.get('year');
        const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : undefined;
        if (title.length < 2 || title.length > 120) return send(res, 400, { error: 'title must be 2-120 characters' });
        const key = `${title.toLowerCase()}|${year ?? ''}`;
        const hit = soundtrackCache.get(key);
        if (hit && Date.now() - hit.at < 6 * 3600_000) return send(res, 200, { soundtrack: hit.value });
        try {
          const value = await deps.soundtrack(title, year);
          soundtrackCache.set(key, { at: Date.now(), value });
          if (soundtrackCache.size > 500) soundtrackCache.delete(soundtrackCache.keys().next().value as string);
          return send(res, 200, { soundtrack: value });
        } catch (e) { return send(res, 502, { error: `soundtrack lookup failed: ${e instanceof Error ? e.message : 'upstream error'}` }); }
      }
      if (req.method === 'GET' && path === '/api/track-links') {
        if (!deps.trackLinks) return send(res, 503, { error: 'track links are not available on this server' });
        const title = (url.searchParams.get('title') ?? '').trim();
        const film = (url.searchParams.get('film') ?? '').trim();
        const artists = (url.searchParams.get('artist') ?? '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 4);
        if (title.length < 1 || title.length > 140 || film.length > 140) return send(res, 400, { error: 'invalid title or film' });
        const lenRaw = url.searchParams.get('length'); const yrRaw = url.searchParams.get('year');
        const lengthSec = lenRaw && /^\d{1,4}$/.test(lenRaw) && Number(lenRaw) > 0 ? Number(lenRaw) : undefined;
        const year = yrRaw && /^\d{4}$/.test(yrRaw) ? Number(yrRaw) : undefined;
        try { return send(res, 200, await deps.trackLinks({ title, artists, film, lengthSec, year })); }
        catch (e) { return send(res, 502, { error: `track link lookup failed: ${e instanceof Error ? e.message : 'upstream error'}` }); }
      }
      if (req.method === 'GET' && path === '/api/albums') {
        if (!deps.albums) return send(res, 503, { error: 'album lookup is not available on this server' });
        const title = (url.searchParams.get('title') ?? '').trim();
        const yearRaw = url.searchParams.get('year');
        if (title.length < 2 || title.length > 120) return send(res, 400, { error: 'title must be 2-120 characters' });
        try { return send(res, 200, { albums: await deps.albums(title, yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : undefined) }); }
        catch (e) { return send(res, 502, { error: `album lookup failed: ${e instanceof Error ? e.message : 'upstream error'}` }); }
      }
      if (req.method === 'GET' && path === '/api/album-tracks') {
        if (!deps.albumTracks) return send(res, 503, { error: 'album lookup is not available on this server' });
        const platform = url.searchParams.get('platform') ?? '';
        const id = url.searchParams.get('id') ?? '';
        if (!['apple', 'deezer', 'deezer-playlist'].includes(platform) || !/^\d{1,15}$/.test(id)) return send(res, 400, { error: 'invalid platform or id' });
        try { return send(res, 200, { tracks: await deps.albumTracks(platform as CatalogPlatform, id) }); }
        catch (e) { return send(res, 502, { error: `track list failed: ${e instanceof Error ? e.message : 'upstream error'}` }); }
      }
      if (req.method === 'GET' && path === '/api/soundtrack-merged') {
        if (!deps.soundtrack || !deps.albums || !deps.albumTracks) return send(res, 503, { error: 'soundtrack lookup is not available on this server' });
        const title = (url.searchParams.get('title') ?? '').trim();
        const yearRaw = url.searchParams.get('year');
        const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : undefined;
        if (title.length < 2 || title.length > 120) return send(res, 400, { error: 'title must be 2-120 characters' });
        const list = (name: string, max: number, len: number) => (url.searchParams.get(name) ?? '').split('|').map((x) => x.trim()).filter((x) => x && x.length <= len).slice(0, max);
        const composers = list('composer', 4, 80); const alts = list('alt', 8, 120);
        const seasonRaw = url.searchParams.get('season'); const airRaw = url.searchParams.get('seasonYear');
        const season = seasonRaw && /^\d{1,2}$/.test(seasonRaw) && Number(seasonRaw) >= 1 ? { number: Number(seasonRaw), airYear: airRaw && /^\d{4}$/.test(airRaw) ? Number(airRaw) : undefined } : undefined;
        const anime = url.searchParams.get('anime') === '1';
        const stageRaw = url.searchParams.get('stage'); const wikiOnly = stageRaw === 'wiki';
        const fast = wikiOnly || url.searchParams.get('fast') === '1'; const fresh = url.searchParams.get('fresh') === '1';
        const key = `${wikiOnly ? 'wiki|' : fast ? 'fast|' : ''}${title.toLowerCase()}|${year ?? ''}|${composers.join('+').toLowerCase()}|${alts.join('+').toLowerCase()}|${season ? season.number + '@' + (season.airYear ?? '') : ''}|${anime ? 'anime' : ''}`;
        const hit = fresh ? undefined : mergedCache.get(key);
        const reuse = fresh ? 'no-store' : 'public, max-age=120, stale-while-revalidate=1800';
        if (hit && Date.now() - hit.at < 6 * 3600_000) return send(res, 200, hit.value, reuse);
        try {
          const value = await buildMergedSoundtrack({ wiki: deps.soundtrack, albums: deps.albums, albumTracks: deps.albumTracks, animeThemes: deps.animeThemes, musicBrainz: deps.musicBrainz, wikidata: deps.wikidata, wikidataComposers: deps.wikidataComposers }, title, year, { composers, alts, season, anime, fast, wikiOnly });
          if (!value.partial) { mergedCache.set(key, { at: Date.now(), value }); if (mergedCache.size > 300) mergedCache.delete(mergedCache.keys().next().value as string); }
          return send(res, 200, value, value.partial ? 'no-store' : reuse);
        } catch (e) { return send(res, 502, { error: `soundtrack lookup failed: ${e instanceof Error ? e.message : 'upstream error'}` }); }
      }
      if (req.method === 'GET' && path === '/api/deezer-isrc') {
        if (!deps.deezerIsrc) return send(res, 503, { error: 'ISRC lookup is not available on this server' });
        const id = url.searchParams.get('id') ?? '';
        if (!/^\d{1,15}$/.test(id)) return send(res, 400, { error: 'id must be a Deezer track number' });
        try { return send(res, 200, { isrc: await deps.deezerIsrc(id) }); }
        catch (e) { return send(res, 502, { error: `ISRC lookup failed: ${e instanceof Error ? e.message : 'upstream error'}` }); }
      }
      if (req.method === 'GET' && path === '/api/media') return send(res, 200, { items: await deps.store.list() });
      if (req.method === 'GET' && path.startsWith('/api/media/')) {
        const r = await deps.store.get(decodeURIComponent(path.slice('/api/media/'.length)));
        if (!r) return send(res, 404, { error: 'not discovered yet' });
        return send(res, 200, { ...r, groups: organize(r.tracks) });
      }
      if (req.method === 'POST' && path === '/api/discover') {
        const body = (await readJson(req)) as { media?: unknown };
        if (!validMedia(body.media)) return send(res, 400, { error: 'invalid media' });
        const media = body.media;
        const job: Job = { id: randomUUID(), mediaId: media.id, state: 'running', steps: newSteps() };
        jobs.set(job.id, job);
        while (jobs.size > 300) jobs.delete(jobs.keys().next().value as string); // bound memory on a public server
        void runDiscovery(media, deps, (key, state, detail) => {
          const s = job.steps.find((x) => x.key === key)!;
          s.state = state; s.detail = detail;
        })
          .then(async (result) => { await deps.store.put(result); job.state = 'done'; })
          .catch((e) => { job.state = 'error'; job.error = e instanceof Error ? e.message : String(e); });
        return send(res, 202, { jobId: job.id, mediaId: media.id });
      }
      if (req.method === 'GET' && path.startsWith('/api/jobs/')) {
        const job = jobs.get(path.slice('/api/jobs/'.length));
        return job ? send(res, 200, job) : send(res, 404, { error: 'no such job' });
      }
      if (req.method === 'GET') return serveStatic(path, res);
      send(res, 405, { error: 'method not allowed' });
    } catch (e) {
      send(res, 400, { error: e instanceof Error ? e.message : 'bad request' });
    }
  });
}
