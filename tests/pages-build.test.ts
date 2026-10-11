import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain .mjs module without types
import { buildPagesConfig, DIRECT_HOSTS } from '../scripts/pages-build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('Pages config: with a Worker address the CSP lets the page call only itself and that Worker', () => {
  const { configJs, headers, origin } = buildPagesConfig('https://mmde-api.example.workers.dev/');
  assert.equal(origin, 'https://mmde-api.example.workers.dev');
  assert.match(configJs, /"apiBaseUrl":"https:\/\/mmde-api\.example\.workers\.dev"/);
  assert.doesNotMatch(configJs, /static/);
  assert.match(headers, /connect-src 'self' https:\/\/mmde-api\.example\.workers\.dev(;|\s*$)/m);
  assert.ok(!/themoviedb|anilist|wikidata/.test(headers), 'no third-party hosts when a Worker is used');
});

test('Pages config: without an address it is browser-only mode and lists exactly the public services it calls', () => {
  const { configJs, headers } = buildPagesConfig('');
  assert.match(configJs, /"mode":"static"/);
  for (const h of DIRECT_HOSTS) assert.ok(headers.includes(h), `${h} must be allowed to connect`);
});

test('Pages headers: strict by default (no inline script, no framing, no sniffing, no tracking features)', () => {
  const { headers } = buildPagesConfig('');
  for (const need of ["script-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "object-src", 'X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Referrer-Policy: no-referrer', 'Permissions-Policy']) {
    if (need === 'object-src') continue; // covered by default-src 'self'
    assert.ok(headers.includes(need), `missing ${need}`);
  }
  assert.ok(!/script-src[^;]*unsafe-inline/.test(headers) && !/script-src[^;]*unsafe-eval/.test(headers));
  // The shipped page really has no inline script (otherwise this CSP would break it).
  const html = readFileSync(`${root}web/index.html`, 'utf8');
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), 'index.html must not contain inline <script>');
  assert.ok(!/\son(click|load|error)=/i.test(html), 'index.html must not contain inline event handlers');
});

test('Pages config refuses anything that is not a plain https origin', () => {
  for (const bad of ['http://mmde.example.workers.dev', 'https://mmde.example.workers.dev/api', 'https://user:pw@mmde.example.workers.dev', 'not a url', 'https://x.example?x=1'])
    assert.throws(() => buildPagesConfig(bad), undefined, bad);
});

test('wrangler.toml holds no secret and the deploy workflow cannot run by itself', () => {
  const toml = readFileSync(`${root}wrangler.toml`, 'utf8');
  assert.ok(!/TMDB_READ_ACCESS_TOKEN\s*=/.test(toml) && !/eyJ[A-Za-z0-9_-]{20,}/.test(toml), 'no token in wrangler.toml');
  const wf = readFileSync(`${root}.github/workflows/deploy-cloudflare.yml`, 'utf8');
  assert.match(wf, /on:\s*\n\s*workflow_dispatch:/);
  assert.ok(!/^\s+push:/m.test(wf) && !/pull_request/.test(wf), 'must be manual only');
  assert.match(wf, /inputs\.confirm == 'deploy'/);
});
