import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { createApp, type AppDeps } from '../src/server/app.ts';
import { jsonStore } from '../src/server/store.ts';
import { decideCors, parseOrigins } from '../src/server/cors.ts';
import { createRateLimiter } from '../src/server/rateLimit.ts';
import type { MediaResolver } from '../src/providers/types.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const PAGES = 'https://saitejavoonna.github.io';
const SECRET = 'TEST-SECRET-TOKEN-must-never-leak-123';

const slime: MediaResolver = { name: 'fake-tmdb', async search() { return [{ id: 'tmdb-tv-37430', type: 'tv', title: 'That Time I Got Reincarnated as a Slime', altTitles: [], year: 2018, externalIds: { tmdb: '37430', tmdbType: 'tv' } }]; } };

async function boot(over: Partial<AppDeps> = {}) {
  const server = createApp({
    providers: [], mediaResolvers: [slime], linkResolvers: [], store: jsonStore(), webRoot: join(root, 'web'),
    tmdbToken: SECRET, allowedOrigins: [PAGES], seasons: async () => [{ seasonNumber: 1, name: 'Season 1', episodeCount: 24, airDate: '2018-10-02' }],
    rateLimit: { general: { windowMs: 60_000, max: 1000 }, discover: { windowMs: 60_000, max: 1000 } }, ...over,
  });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const get = (url: string, headers: Record<string, string> = {}) => fetch(url, { headers });

// ---------------------------------------------------------------- CORS unit
test('parseOrigins: normalizes, dedupes, drops invalid entries', () => {
  assert.deepEqual(parseOrigins(' https://a.github.io/ , http://localhost:3000,https://a.github.io, nope, ftp://x.com, '), ['https://a.github.io', 'http://localhost:3000']);
  assert.deepEqual(parseOrigins(undefined), []);
  assert.deepEqual(parseOrigins('*'), ['*']);
  assert.deepEqual(parseOrigins('https://a.github.io/some/path'), ['https://a.github.io']);
});

test('decideCors: allowlist, same-origin, no Origin, wildcard, garbage', () => {
  assert.equal(decideCors(undefined, 'api.x', [PAGES]).kind, 'none');
  assert.equal(decideCors('https://api.x', 'api.x', []).kind, 'none');
  const ok = decideCors(PAGES, 'api.x', [PAGES]);
  assert.equal(ok.kind, 'allowed');
  assert.equal(ok.kind === 'allowed' && ok.headers['Access-Control-Allow-Origin'], PAGES);
  assert.equal(ok.kind === 'allowed' && ok.headers.Vary, 'Origin');
  assert.equal(decideCors('https://evil.example', 'api.x', [PAGES]).kind, 'denied');
  assert.equal(decideCors('https://saitejavoonna.github.io.evil.example', 'api.x', [PAGES]).kind, 'denied');
  assert.equal(decideCors('not a url', 'api.x', [PAGES]).kind, 'denied');
  const star = decideCors('https://anything.example', 'api.x', ['*']);
  assert.equal(star.kind === 'allowed' && star.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(decideCors(PAGES, 'api.x', []).kind, 'denied');
});

// ---------------------------------------------------------------- CORS over HTTP
test('CORS: allowed origin gets headers; preflight succeeds; no credentials header', async () => {
  const s = await boot();
  try {
    const r = await get(`${s.base}/api/search?q=slime`, { Origin: PAGES });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), PAGES);
    assert.equal(r.headers.get('vary'), 'Origin');
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
    const pre = await fetch(`${s.base}/api/discover`, { method: 'OPTIONS', headers: { Origin: PAGES, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), PAGES);
    assert.match(pre.headers.get('access-control-allow-methods') ?? '', /POST/);
    assert.match(pre.headers.get('access-control-allow-headers') ?? '', /Content-Type/i);
  } finally { await s.close(); }
});

test('CORS: unlisted origin is refused (403, no CORS headers, no work done); no-Origin clients still work', async () => {
  let searched = 0;
  const counting: MediaResolver = { name: 'c', async search() { searched++; return []; } };
  const s = await boot({ mediaResolvers: [counting] });
  try {
    const r = await get(`${s.base}/api/search?q=slime`, { Origin: 'https://evil.example' });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal(searched, 0, 'a refused origin must not trigger provider calls');
    const pre = await fetch(`${s.base}/api/search`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(pre.status, 403);
    assert.equal((await get(`${s.base}/api/search?q=slime`)).status, 200); // curl / server-to-server
  } finally { await s.close(); }
});

test('CORS: with no allowlist configured only same-origin works; static files unaffected', async () => {
  const s = await boot({ allowedOrigins: [] });
  try {
    assert.equal((await get(`${s.base}/api/search?q=x`, { Origin: PAGES })).status, 403);
    assert.equal((await get(`${s.base}/api/search?q=x`, { Origin: s.base })).status, 200, 'same-origin');
    const home = await get(`${s.base}/`, { Origin: PAGES });
    assert.equal(home.status, 200);
  } finally { await s.close(); }
});

// ---------------------------------------------------------------- rate limiting
test('rate limiter: sliding window, per key, Retry-After', () => {
  const rl = createRateLimiter({ windowMs: 1000, max: 2 });
  assert.equal(rl.check('a', 0).ok, true);
  assert.equal(rl.check('a', 100).ok, true);
  const blocked = rl.check('a', 200);
  assert.equal(blocked.ok, false);
  assert.equal(!blocked.ok && blocked.retryAfterSec, 1);
  assert.equal(rl.check('b', 200).ok, true, 'other clients unaffected');
  assert.equal(rl.check('a', 1001).ok, true, 'window slides');
});

test('rate limit over HTTP: 429 + Retry-After; health is exempt; discover has its own tighter limit', async () => {
  const s = await boot({ rateLimit: { general: { windowMs: 60_000, max: 3 }, discover: { windowMs: 60_000, max: 1 } } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await get(`${s.base}/api/search?q=a`)).status, 200);
    const r = await get(`${s.base}/api/search?q=a`);
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) >= 1);
    for (let i = 0; i < 10; i++) assert.equal((await get(`${s.base}/api/health`)).status, 200);
  } finally { await s.close(); }
  const d = await boot({ rateLimit: { general: { windowMs: 60_000, max: 100 }, discover: { windowMs: 60_000, max: 1 } } });
  try {
    const media = { id: 'm', type: 'tv', title: 'T', altTitles: [], externalIds: {} };
    const post = () => fetch(`${d.base}/api/discover`, { method: 'POST', body: JSON.stringify({ media }) });
    assert.equal((await post()).status, 202);
    assert.equal((await post()).status, 429);
    assert.equal((await get(`${d.base}/api/search?q=a`)).status, 200, 'normal calls still fine');
  } finally { await d.close(); }
});

test('rate limit keys: X-Forwarded-For only trusted behind a proxy', async () => {
  const noTrust = await boot({ rateLimit: { general: { windowMs: 60_000, max: 1 }, discover: { windowMs: 60_000, max: 9 } } });
  try {
    assert.equal((await get(`${noTrust.base}/api/search?q=a`, { 'X-Forwarded-For': '1.1.1.1' })).status, 200);
    assert.equal((await get(`${noTrust.base}/api/search?q=a`, { 'X-Forwarded-For': '2.2.2.2' })).status, 429, 'spoofed header must not dodge the limit');
  } finally { await noTrust.close(); }
  const trust = await boot({ trustProxy: true, rateLimit: { general: { windowMs: 60_000, max: 1 }, discover: { windowMs: 60_000, max: 9 } } });
  try {
    assert.equal((await get(`${trust.base}/api/search?q=a`, { 'X-Forwarded-For': '1.1.1.1' })).status, 200);
    assert.equal((await get(`${trust.base}/api/search?q=a`, { 'X-Forwarded-For': '2.2.2.2' })).status, 200, 'distinct real clients behind the proxy');
    assert.equal((await get(`${trust.base}/api/search?q=a`, { 'X-Forwarded-For': '1.1.1.1' })).status, 429);
  } finally { await trust.close(); }
});

// ---------------------------------------------------------------- seasons endpoint
test('seasons: ok with injected lookup; id validated; 503 without token; 502 on upstream failure', async () => {
  const s = await boot();
  try {
    const r = await get(`${s.base}/api/seasons/tmdb-tv-37430`);
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).seasons[0], { seasonNumber: 1, name: 'Season 1', episodeCount: 24, airDate: '2018-10-02' });
    for (const bad of ['tmdb-movie-1', 'tmdb-tv-abc', 'tmdb-tv-1/../../x', 'anilist-5', 'tmdb-tv-12345678901']) {
      assert.equal((await get(`${s.base}/api/seasons/${encodeURIComponent(bad)}`)).status, 400, bad);
    }
  } finally { await s.close(); }
  const none = await boot({ tmdbToken: undefined });
  try {
    const r = await get(`${none.base}/api/seasons/tmdb-tv-1`);
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /not configured/);
    assert.equal((await get(`${none.base}/api/search?q=slime`)).status, 200, 'search still works without TMDB');
  } finally { await none.close(); }
  const down = await boot({ seasons: async () => { throw new Error('HTTP 401 from TMDB TV details'); } });
  try {
    const r = await get(`${down.base}/api/seasons/tmdb-tv-1`);
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /season lookup failed/);
  } finally { await down.close(); }
});

// ---------------------------------------------------------------- secrets never leave the server
test('the TMDB credential never appears in any API response (health, search, seasons, errors, 404, 429)', async () => {
  const s = await boot({ rateLimit: { general: { windowMs: 60_000, max: 6 }, discover: { windowMs: 60_000, max: 9 } } });
  try {
    const bodies: string[] = [];
    for (const p of ['/api/health', '/api/search?q=slime', '/api/seasons/tmdb-tv-37430', '/api/seasons/bad', '/api/media/none', '/api/nope', '/api/search?q=x']) {
      const r = await get(s.base + p, { Origin: PAGES });
      bodies.push(await r.text(), JSON.stringify([...r.headers.entries()]));
    }
    assert.ok(bodies.every((b) => !b.includes(SECRET)), 'secret leaked');
    const health = await (await get(`${s.base}/api/health`)).json();
    assert.equal(health.tmdb, true, 'health reports only a boolean');
  } finally { await s.close(); }
});

test('frontend files: no credentials, no token storage, loads config.js first, uses the configured API base', () => {
  const dir = join(root, 'web');
  const sources = readdirSync(dir).filter((f) => /\.(js|html|css)$/.test(f) && f !== 'mmde.js').map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);
  assert.ok(sources.length >= 4);
  for (const [name, text] of sources) {
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(text), `${name}: JWT-like token`);
    assert.ok(!/\b[a-f0-9]{32}\b/.test(text), `${name}: 32-hex key-like string`);
    assert.ok(!/Authorization|Bearer\s/i.test(text), `${name}: must not send credentials from the browser`);
    assert.ok(!/TMDB_READ_ACCESS_TOKEN\s*[:=]\s*['"]?\w{8,}/.test(text), `${name}: env value`);
  }
  const phase1 = readFileSync(join(dir, 'mmde-phase1.js'), 'utf8');
  // The browser may keep ONLY the user's own library (followed titles, favorite songs) in localStorage, under one fixed key.
  assert.ok(!/sessionStorage|indexedDB|document\.cookie/.test(phase1), 'no other browser storage');
  const storageLines = phase1.split('\n').filter((l) => /localStorage/.test(l));
  assert.ok(storageLines.length > 0 && storageLines.every((l) => /LIB_KEY/.test(l)), 'every localStorage use goes through the library key');
  assert.match(phase1, /const LIB_KEY = 'mmde\.library\.v1'/);
  assert.ok(!/localStorage[^;]*(token|secret|password|apikey)/i.test(phase1), 'never store credentials');
  assert.match(phase1, /MMDE_CONFIG/);
  assert.match(phase1, /API_BASE \+ path/);
  assert.ok(!/fetch\(\s*['"]\/api/.test(phase1), 'no hardcoded relative fetch');
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.ok(html.indexOf('config.js') > -1 && html.indexOf('config.js') < html.indexOf('mmde-phase1.js'), 'config.js must load before the app');
  assert.match(readFileSync(join(dir, 'config.js'), 'utf8'), /apiBaseUrl:\s*""/, 'committed default is same-origin');
});

test('repo hygiene: .env ignored, .env.example has names only, Dockerfile pins Node 22 and ignores .env', () => {
  assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^\.env$/m);
  const example = readFileSync(join(root, '.env.example'), 'utf8');
  for (const line of example.split('\n').filter((l) => /^[A-Z_]+=/.test(l))) assert.ok(/=\s*$/.test(line) || /^(PORT|MMDE_TRUST_PROXY)=/.test(line), `.env.example must not contain values: ${line}`);
  assert.match(example, /MMDE_WEB_ORIGIN=/);
  const docker = readFileSync(join(root, 'Dockerfile'), 'utf8');
  assert.match(docker, /FROM node:22/);
  assert.match(readFileSync(join(root, '.dockerignore'), 'utf8'), /^\.env$/m);
});

// ---------------------------------------------------------------- review follow-ups
test('rate limit key behind a proxy uses the LAST X-Forwarded-For entry (a forged prefix cannot dodge the limit)', async () => {
  const s = await boot({ trustProxy: true, rateLimit: { general: { windowMs: 60_000, max: 1 }, discover: { windowMs: 60_000, max: 9 } } });
  try {
    assert.equal((await get(`${s.base}/api/search?q=a`, { 'X-Forwarded-For': 'forged-1, 9.9.9.9' })).status, 200);
    assert.equal((await get(`${s.base}/api/search?q=a`, { 'X-Forwarded-For': 'forged-2, 9.9.9.9' })).status, 429, 'same real client, different forged prefix');
    assert.equal((await get(`${s.base}/api/search?q=a`, { 'X-Forwarded-For': 'forged-1, 8.8.8.8' })).status, 200, 'different real client');
  } finally { await s.close(); }
});

test('search: resolvers run in parallel, "sources" narrows them, unknown sources fall back to all, failures are reported per resolver', async () => {
  const calls: string[] = [];
  const mk = (name: string, ms: number, fail = false): MediaResolver => ({ name, async search() { calls.push(name); await new Promise((r) => setTimeout(r, ms)); if (fail) throw new Error('boom'); return [{ id: `${name}-1`, type: 'tv', title: `Title from ${name}`, altTitles: [], externalIds: {} }]; } });
  const s = await boot({ mediaResolvers: [mk('tmdb', 150), mk('anilist', 150), mk('wikipedia', 150, true)] });
  try {
    const t0 = Date.now();
    const all = await (await get(`${s.base}/api/search?q=x`)).json();
    assert.ok(Date.now() - t0 < 420, `parallel, not sequential (took ${Date.now() - t0}ms)`);
    assert.deepEqual(all.sources, ['tmdb', 'anilist', 'wikipedia']);
    assert.deepEqual(all.errors.filter((e: string) => e.startsWith('wikipedia')), ['wikipedia: boom']);
    calls.length = 0;
    const fast = await (await get(`${s.base}/api/search?q=x&sources=tmdb,local-seeds`)).json();
    assert.deepEqual(fast.sources, ['tmdb']);
    assert.ok(!calls.includes('anilist') && !calls.includes('wikipedia'), 'slow sources not called in the fast phase');
    const fallback = await (await get(`${s.base}/api/search?q=x&sources=does-not-exist`)).json();
    assert.deepEqual(fallback.sources, ['tmdb', 'anilist', 'wikipedia']);
  } finally { await s.close(); }
  // server without a TMDB resolver: the fast request still answers using what exists
  const noTmdb = await boot({ mediaResolvers: [mk('anilist', 5)], tmdbToken: undefined });
  try { assert.deepEqual((await (await get(`${noTmdb.base}/api/search?q=x&sources=tmdb,local-seeds`)).json()).sources, ['anilist']); }
  finally { await noTmdb.close(); }
});

test('frontend phase 1 asks the backend for the fast TMDB path', () => {
  assert.match(readFileSync(join(root, 'web', 'mmde-phase1.js'), 'utf8'), /sources=tmdb,local-seeds/);
});

test('no browser code path accepts, stores or sends a TMDB credential (including the legacy browser-only bundle)', () => {
  const srcs = ['src/browser/browserApi.ts', 'src/browser/ui.js', 'src/browser/api.ts', 'src/browser/main.ts', 'src/browser/serverApi.ts'];
  for (const f of srcs) assert.ok(!/tmdbToken|TMDB API Read Access Token|providers\/tmdb/.test(readFileSync(join(root, f), 'utf8')), `${f}: browser-side TMDB credential handling`);
  const bundle = readFileSync(join(root, 'web', 'mmde.js'), 'utf8');
  assert.ok(!/Authorization|Bearer/.test(bundle), 'built bundle must not contain bearer-token code');
});

test('guard: any script imported by a test must only run when invoked directly (otherwise the import exits the test process and the suite silently "passes")', () => {
  const testsDir = join(root, 'tests');
  for (const f of readdirSync(testsDir).filter((n) => n.endsWith('.test.ts'))) {
    const src = readFileSync(join(testsDir, f), 'utf8');
    for (const m of src.matchAll(/from\s+'\.\.\/scripts\/([\w.-]+\.mjs)'/g)) {
      const script = readFileSync(join(root, 'scripts', m[1]!), 'utf8');
      assert.match(script, /import\.meta\.url\)\s*===\s*(?:resolve\()?process\.argv\[1\]|resolve\(fileURLToPath\(import\.meta\.url\)\)\s*===\s*resolve\(process\.argv\[1\]\)/, `${f} imports scripts/${m[1]} which has no "run only when invoked directly" guard`);
    }
  }
});

test('/api/details validates the id, needs a token, and never leaks it', async () => {
  const s = await boot({ details: async (id) => ({ id, kind: 'movie', title: 'X', genres: [], spokenLanguages: [] }) });
  try {
    const ok = await get(`${s.base}/api/details/tmdb-movie-11`);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).title, 'X');
    for (const bad of ['tmdb-person-1', 'tmdb-movie-abc', 'tmdb-tv-1/../../x', 'anilist-5']) assert.equal((await get(`${s.base}/api/details/${encodeURIComponent(bad)}`)).status, 400, bad);
  } finally { await s.close(); }
  const none = await boot({ tmdbToken: undefined });
  try { assert.equal((await get(`${none.base}/api/details/tmdb-movie-11`)).status, 503); } finally { await none.close(); }
  const down = await boot({ details: async () => { throw new Error(`boom ${SECRET}`.replace(SECRET, 'x')); } });
  try { assert.equal((await get(`${down.base}/api/details/tmdb-tv-1`)).status, 502); } finally { await down.close(); }
});
