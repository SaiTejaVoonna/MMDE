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
import { tmdbSeasons } from '../providers/tmdb.ts';

export interface AppDeps extends Deps {
  mediaResolvers: MediaResolver[];
  store: Store;
  webRoot: string;
  tmdbToken?: string;
}

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

  async function search(q: string) {
    const results: Media[] = [];
    const errors: string[] = [];
    for (const r of deps.mediaResolvers) {
      try { results.push(...await r.search(q)); }
      catch (e) { errors.push(`${r.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
        let merged = mergeMediaResults(results);
    const canonical = merged[0];
    const anilist = deps.mediaResolvers.find((r) => r.name === 'anilist');
    if (canonical && anilist) {
      try { merged = mergeMediaResults([...merged, ...(await anilist.search(canonical.title))]); }
      catch (e) { errors.push(`anilist enrichment: ${e instanceof Error ? e.message : String(e)}`); }
    }
    return { results: merged, errors, sources: deps.mediaResolvers.map((r) => r.name) };
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
      if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, resolvers: deps.mediaResolvers.map((r) => r.name), providers: deps.providers.map((p) => p.name) });
      if (req.method === 'GET' && path === '/api/search') return send(res, 200, await search(url.searchParams.get('q') ?? ''));
      if (req.method === 'GET' && path.startsWith('/api/seasons/')) {
        if (!deps.tmdbToken) return send(res, 503, { error: 'TMDB is not configured on this server' });
        const id = decodeURIComponent(path.slice('/api/seasons/'.length));
        const media = { id, type: 'tv', title: '', altTitles: [], externalIds: { tmdb: id.replace(/^tmdb-tv-/, ''), tmdbType: 'tv' } } as Media;
        return send(res, 200, { seasons: await tmdbSeasons(media, deps.tmdbToken) });
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
