import { decideCors, parseOrigins } from '../server/cors.ts';
import { createRateLimiter } from '../server/rateLimit.ts';
import { CACHE_CONTROL, CACHE_TTL, createEdgeRouter, type CachePolicy, type EdgeAnswer } from './router.ts';

// Cloudflare Worker entry: the lightweight MMDE backend. It adds what the pure router (router.ts) does not know about:
//   CORS allowlist (the Pages site only), per-client rate limits, an optional shared cache in Workers KV, and security headers.
// Secrets and settings come from the Worker's environment: TMDB_READ_ACCESS_TOKEN (secret), MMDE_WEB_ORIGIN, MMDE_CONTACT (plain variables).
// Nothing here ever returns, logs or forwards the token to the browser.

/** The slice of Workers KV we use (so tests can pass a Map-backed fake). */
export interface KVLike { get(key: string): Promise<string | null>; put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<unknown> }
export interface Env { TMDB_READ_ACCESS_TOKEN?: string; MMDE_WEB_ORIGIN?: string; MMDE_CONTACT?: string; CACHE?: KVLike }
export interface Ctx { waitUntil(p: Promise<unknown>): void }
export interface WorkerOptions { fetchImpl?: typeof fetch; /** Requests per minute per client; defaults 120 general, 20 for the heavy lookups. */ limits?: { general: number; heavy: number } }

const HEAVY = new Set(['/api/soundtrack-merged', '/api/albums', '/api/album-tracks', '/api/artwork', '/api/track-links', '/api/search']);
const json = (status: number, body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers } });

/** Same lookup, same key: sort the query, drop `fresh` (it only means "skip the cache"). */
export function cacheKey(url: URL): string {
  const params = [...url.searchParams.entries()].filter(([k]) => k !== 'fresh').sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0));
  return `v1:${url.pathname}?${params.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

export function createWorker(opts: WorkerOptions = {}) {
  const general = createRateLimiter({ windowMs: 60_000, max: opts.limits?.general ?? 120 });
  const heavy = createRateLimiter({ windowMs: 60_000, max: opts.limits?.heavy ?? 20 });
  let router: ReturnType<typeof createEdgeRouter> | undefined; let routerFor = '';
  const routerFrom = (env: Env) => {
    const token = (env.TMDB_READ_ACCESS_TOKEN ?? '').trim(); const contact = (env.MMDE_CONTACT ?? '').trim() || 'set MMDE_CONTACT';
    const sig = `${token}|${contact}`;
    if (!router || sig !== routerFor) { router = createEdgeRouter({ tmdbToken: token || undefined, userAgent: `MMDE/0.3 (personal, non-commercial; ${contact})`, fetchImpl: opts.fetchImpl }); routerFor = sig; }
    return router;
  };

  return {
    async fetch(request: Request, env: Env = {}, ctx?: Ctx): Promise<Response> {
      const url = new URL(request.url);
      const allowed = parseOrigins(env.MMDE_WEB_ORIGIN);
      const cors = decideCors(request.headers.get('origin') ?? undefined, url.host, allowed);
      if (cors.kind === 'denied') return json(403, { error: 'origin not allowed' }, {});
      const corsHeaders = cors.kind === 'allowed' ? cors.headers : {};
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method not allowed' }, { ...corsHeaders, allow: 'GET, HEAD, OPTIONS' });
      if (!url.pathname.startsWith('/api/')) return json(404, { error: 'not found (this is the MMDE API; the website is hosted separately)' }, corsHeaders);

      if (url.pathname !== '/api/health') {
        // Cloudflare puts the visitor's address in CF-Connecting-IP and strips any copy the client sends itself.
        const key = request.headers.get('cf-connecting-ip') ?? 'unknown';
        const g = general.check(key);
        const h = HEAVY.has(url.pathname) ? heavy.check(`h:${key}`) : { ok: true as const };
        const blocked = !g.ok ? g : !h.ok ? h : null;
        if (blocked && !blocked.ok) return json(429, { error: 'too many requests, slow down', retryAfterSec: blocked.retryAfterSec }, { ...corsHeaders, 'retry-after': String(blocked.retryAfterSec), 'cache-control': 'no-store' });
      }

      const reply = (a: EdgeAnswer | { status: number; body: unknown; cache: CachePolicy }, extra: Record<string, string> = {}) =>
        json(a.status, a.body, { ...corsHeaders, 'cache-control': CACHE_CONTROL[a.cache], ...extra });

      const fresh = url.searchParams.get('fresh') === '1';
      const kv = env.CACHE;
      const key = cacheKey(url);
      if (kv && !fresh) {
        try {
          const hit = await kv.get(key);
          if (hit) { const { c, b } = JSON.parse(hit) as { c: CachePolicy; b: unknown }; return reply({ status: 200, body: b, cache: c }, { 'x-mmde-cache': 'hit' }); }
        } catch { /* a broken cache must never break the API */ }
      }

      const answer = await routerFrom(env).handle(url.pathname + url.search);
      // Only complete, successful answers worth reusing go to the shared cache (KV writes are limited on the free plan, so short-lived search answers stay out).
      if (kv && answer.status === 200 && (answer.cache === 'medium' || answer.cache === 'long') && ctx) {
        ctx.waitUntil(Promise.resolve(kv.put(key, JSON.stringify({ c: answer.cache, b: answer.body }), { expirationTtl: Math.max(60, CACHE_TTL[answer.cache]) })).catch(() => undefined));
      }
      return reply(answer, kv ? { 'x-mmde-cache': 'miss' } : {});
    },
  };
}

export default createWorker();
