import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Media } from '../domain/types.ts';
import { normalizeTitle } from '../matching/normalize.ts';
import { mergeMediaResults } from '../app/media.ts';
import type { MediaResolver } from '../providers/types.ts';
import { newSteps, runDiscovery, type Deps, type Step } from './runner.ts';
import type { Store } from './store.ts';
import { organize } from '../app/organize.ts';
import { tmdbSeasons, tmdbDetails, type TmdbSeason, type TmdbDetails } from '../providers/tmdb.ts';
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
  /** Per-client limits. Defaults: 120 API calls/min, 12 discovery jobs/min. */
  rateLimit?: { general: Limit; discover: Limit };
  /** Injectable for tests; defaults to the real TMDB season lookup. */
  seasons?: (media: Media, token: string) => Promise<TmdbSeason[]>;
  /** Injectable for tests; defaults to the real TMDB details lookup (movie, tv or collection). */
  details?: (id: string, token: string) => Promise<TmdbDetails>;
}

const DEFAULT_LIMITS = { general: { windowMs: 60_000, max: 120 }, discover: { windowMs: 60_000, max: 12 } };
const TMDB_TV_ID = /^tmdb-tv-\d{1,10}$/;
const TMDB_ID = /^tmdb-(tv|movie|collection)-\d{1,10}$/;

interface Job { id: string; mediaId: string; state: 'running' | 'done' | 'error'; steps: Step[]; error?: string }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon',
};

const send = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
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
  const getDetails = deps.details ?? ((id: string, token: string) => tmdbDetails(id, token));

  /**
   * Query resolvers in parallel (results keep resolver order). Optional `sources` (resolver names) narrows the
   * lookup, e.g. the fast TMDB phase; if none of the requested sources exist on this server (say TMDB has no
   * credential) all resolvers are used so search still answers.
   */
  async function search(q: string, sources?: string[]) {
    const wanted = sources?.length ? deps.mediaResolvers.filter((r) => sources.includes(r.name)) : [];
    const used = wanted.length ? wanted : deps.mediaResolvers;
    const settled = await Promise.allSettled(used.map((r) => r.search(q)));
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
      res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream' });
      res.end(data);
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
      if (req.method === 'GET' && path === '/api/search') return send(res, 200, await search(url.searchParams.get('q') ?? '', (url.searchParams.get('sources') ?? '').split(',').map((x) => x.trim()).filter(Boolean)));
      if (req.method === 'GET' && path.startsWith('/api/seasons/')) {
        if (!deps.tmdbToken) return send(res, 503, { error: 'TMDB is not configured on this server' });
        const id = decodeURIComponent(path.slice('/api/seasons/'.length));
        if (!TMDB_TV_ID.test(id)) return send(res, 400, { error: 'invalid media id (expected tmdb-tv-<number>)' });
        const media = { id, type: 'tv', title: '', altTitles: [], externalIds: { tmdb: id.replace(/^tmdb-tv-/, ''), tmdbType: 'tv' } } as Media;
        try { return send(res, 200, { seasons: await getSeasons(media, deps.tmdbToken) }); }
        catch (e) { return send(res, 502, { error: `season lookup failed: ${e instanceof Error ? e.message : 'upstream error'}` }); }
      }
      if (req.method === 'GET' && path.startsWith('/api/details/')) {
        if (!deps.tmdbToken) return send(res, 503, { error: 'TMDB is not configured on this server' });
        const id = decodeURIComponent(path.slice('/api/details/'.length));
        if (!TMDB_ID.test(id)) return send(res, 400, { error: 'invalid id (expected tmdb-tv-, tmdb-movie- or tmdb-collection- plus a number)' });
        try { return send(res, 200, await getDetails(id, deps.tmdbToken)); }
        catch (e) { return send(res, 502, { error: `details lookup failed: ${e instanceof Error ? e.message : 'upstream error'}` }); }
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
