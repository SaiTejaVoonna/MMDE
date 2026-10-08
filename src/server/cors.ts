// Minimal, allowlist-based CORS for a separately hosted frontend (e.g. GitHub Pages).
// Same-origin requests and non-browser clients (no Origin header) are never affected.
// No credentials/cookies are used by MMDE, so Access-Control-Allow-Credentials is never sent.

/** "https://a.github.io/, http://localhost:3000" -> ["https://a.github.io", "http://localhost:3000"]. Invalid entries are dropped. */
export function parseOrigins(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of String(raw ?? '').split(',')) {
    const v = part.trim().replace(/\/+$/, '');
    if (!v) continue;
    if (v === '*') { out.push('*'); continue; }
    try {
      const u = new URL(v);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.push(u.origin);
    } catch { /* ignore invalid entry */ }
  }
  return [...new Set(out)];
}

export type CorsDecision =
  | { kind: 'none' }                              // no Origin header, or same-origin: nothing to do
  | { kind: 'allowed'; headers: Record<string, string> }
  | { kind: 'denied' };                           // cross-origin and not on the allowlist

export function decideCors(origin: string | undefined, host: string | undefined, allowed: string[]): CorsDecision {
  if (!origin) return { kind: 'none' };
  let originHost = '';
  try { originHost = new URL(origin).host; } catch { return { kind: 'denied' }; }
  if (host && originHost === host) return { kind: 'none' };
  const common = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' };
  if (allowed.includes('*')) return { kind: 'allowed', headers: { ...common, 'Access-Control-Allow-Origin': '*' } };
  if (allowed.includes(origin)) return { kind: 'allowed', headers: { ...common, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } };
  return { kind: 'denied' };
}
