import type { IncomingMessage } from 'node:http';

// Tiny in-memory sliding-window limiter. A public backend that proxies TMDB (and other providers) must not
// let one client burn the shared quota. Per-process only, which is fine for a single small instance.
export interface Limit { windowMs: number; max: number }

export function createRateLimiter(limit: Limit) {
  const hits = new Map<string, number[]>();
  let lastSweep = 0;
  return {
    check(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
      if (now - lastSweep > limit.windowMs) {
        lastSweep = now;
        for (const [k, v] of hits) if (!v.some((t) => now - t < limit.windowMs)) hits.delete(k);
      }
      const recent = (hits.get(key) ?? []).filter((t) => now - t < limit.windowMs);
      if (recent.length >= limit.max) {
        hits.set(key, recent);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0]! + limit.windowMs - now) / 1000)) };
      }
      recent.push(now);
      hits.set(key, recent);
      return { ok: true };
    },
  };
}

/**
 * Behind a proxy (Railway) the socket address is the proxy itself, so only then read X-Forwarded-For, and use the
 * LAST entry: that is the address the single trusted proxy appended. The first entries can be forged by the client.
 */
export function clientKey(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const parts = String(req.headers['x-forwarded-for'] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
