// Real-browser test of the production arrangement: frontend on one origin, MMDE backend on ANOTHER.
// Part A uses REAL network connections between two loopback origins (different ports = different origins),
// with NO request interception on the API calls, so Chromium itself enforces CORS.
// (Playwright's route.fulfill does not enforce CORS, so it is only used for static config/Pages cases below.)
// The TMDB lookup is stubbed inside the backend (no network, no credential).
//   PW_NODE_MODULES=/path/to/node_modules node scripts/ui-split-origin.mjs [outdir]
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createApp } from '../src/server/app.ts';
import { jsonStore } from '../src/server/store.ts';

const { chromium } = createRequire((process.env.PW_NODE_MODULES ?? '/opt/node22/lib/node_modules') + '/')('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? '.';
const PAGES = 'https://saitejavoonna.github.io';
let failed = false;
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed = true; };

const slime = { name: 'fake-tmdb', async search(q) { return /slime/i.test(q) ? [
  { id: 'tmdb-tv-37430', type: 'tv', title: 'That Time I Got Reincarnated as a Slime', altTitles: [], year: 2018, externalIds: { tmdb: '37430', tmdbType: 'tv' } },
  { id: 'tmdb-movie-9', type: 'movie', title: 'Slime Movie', altTitles: [], year: 2022, externalIds: { tmdb: '9', tmdbType: 'movie' } }] : []; } };
const SEASONS = [{ seasonNumber: 1, name: 'Season 1', episodeCount: 24, airDate: '2018-10-02' }, { seasonNumber: 2, name: 'Season 2', episodeCount: 24, airDate: '2021-01-12' }];
const start = async ({ allowedOrigins = [], tmdbToken = 'stub-token', resolvers = [slime] } = {}) => {
  const s = createApp({ providers: [], mediaResolvers: resolvers, linkResolvers: [], store: jsonStore(), webRoot: join(root, 'web'), tmdbToken, allowedOrigins, seasons: async () => SEASONS });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => s.close(r)) };
};

const web = await start({ resolvers: [] });                       // serves the static frontend (its own /api unused)
const good = await start({ allowedOrigins: [web.url] });           // allows the frontend origin
const strict = await start({ allowedOrigins: [] });                // same-origin only
const noTmdb = await start({ allowedOrigins: [web.url], tmdbToken: '' });
const browser = await chromium.launch();

async function openLoopback(api, config) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  // Only config.js is overridden; everything else, including every /api call, is a real network request.
  await page.route(`${web.url}/config.js`, (route) => route.fulfill({ contentType: 'text/javascript', body: config ?? `window.MMDE_CONFIG = ${JSON.stringify({ apiBaseUrl: api })};` }));
  await page.goto(`${web.url}/`);
  return page;
}

// ---------- A1. frontend origin -> backend that allows it
let page = await openLoopback(good.url);
await page.waitForFunction(() => /Backend: online/.test(document.getElementById('backend-status')?.textContent ?? ''));
check('A1 health reachable cross-origin (real CORS, real network)', (await page.textContent('#backend-status')).includes(new URL(good.url).host));
check('A1 no "TMDB not configured" warning when the server has a token', !/not configured/.test(await page.textContent('#backend-status')));
await page.fill('input.search', 'slime');
await page.keyboard.press('Enter');
await page.waitForSelector('.suggest button');
check('A1 search returns TMDB results through the backend', (await page.textContent('.suggest')).includes('That Time I Got Reincarnated as a Slime'));
await page.click('.suggest button:has-text("That Time I Got Reincarnated as a Slime")');
await page.waitForSelector('.chip strong');
const seasons = await page.locator('.chips .chip').allTextContents();
check('A1 selecting the title loads seasons via /api/seasons', seasons.length === 2 && seasons[0].includes('Season 1') && seasons[0].includes('24 episodes') && seasons[1].includes('2021'));
await page.click('a:has-text("Back to search")');
await page.fill('input.search', 'slime');
await page.keyboard.press('Enter');
await page.waitForSelector('.suggest button');
await page.click('.suggest button:has-text("Slime Movie")');
await page.waitForSelector('text=Movies do not have seasons');
check('A1 a movie explains it has no seasons', true);
await page.screenshot({ path: join(out, 'split-origin-ok.png') });
check('A1 no page errors', page.errors.length === 0);
await page.close();

// ---------- A2. backend that does NOT list the frontend: the BROWSER blocks the response
page = await openLoopback(strict.url);
await page.waitForFunction(() => /Cannot reach the MMDE backend/.test(document.getElementById('backend-status')?.textContent ?? ''));
check('A2 CORS-refused backend: clear message that mentions MMDE_WEB_ORIGIN', /MMDE_WEB_ORIGIN/.test(await page.textContent('#backend-status')));
const blocked = await page.evaluate(async (u) => { try { await fetch(u + '/api/health'); return 'readable'; } catch { return 'blocked by browser'; } }, strict.url);
check('A2 proof: the browser itself blocks reading the response', blocked === 'blocked by browser');
await page.fill('input.search', 'slime');
await page.keyboard.press('Enter');
await page.waitForFunction(() => /Cannot reach/.test(document.querySelector('.search-status')?.textContent ?? ''));
check('A2 search shows the same explanation and does not crash', page.errors.length === 0);
await page.close();

// ---------- A3. backend without TMDB credentials
page = await openLoopback(noTmdb.url);
await page.waitForFunction(() => /Backend: online/.test(document.getElementById('backend-status')?.textContent ?? ''));
check('A3 health tells the operator TMDB is not configured', /TMDB is not configured/.test(await page.textContent('#backend-status')));
await page.close();

// ---------- B. static-hosting cases, simulating the real Pages origin (route.fulfill is fine here: no backend involved)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
async function openPages(config) {
  const p = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.route(`${PAGES}/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^\/MMDE\/?/, '') || 'index.html';
    if (name === 'config.js') return route.fulfill({ contentType: 'text/javascript', body: config });
    try { return route.fulfill({ contentType: MIME[extname(name)] ?? 'text/plain', body: await readFile(join(root, 'web', name)) }); }
    catch { return route.fulfill({ status: 404, body: 'not found' }); }
  });
  await p.goto(`${PAGES}/MMDE/`);
  return p;
}
page = await openPages('window.MMDE_CONFIG = { apiBaseUrl: "" };');
await page.waitForFunction(() => document.getElementById('backend-status')?.textContent.length > 0);
check('B1 github.io with the default empty config tells the owner to set the backend URL', /no backend URL is configured/.test(await page.textContent('#backend-status')));
await page.fill('input.search', 'slime');
await page.keyboard.press('Enter');
await page.waitForFunction(() => /no backend URL/.test(document.querySelector('.search-status')?.textContent ?? ''));
check('B1 search says so too, without sending any request', page.errors.length === 0);
await page.close();
for (const bad of ['javascript:alert(1)', 'https://x.example"};alert(1);//', 'ftp://example.com', 'https://a b.example']) {
  page = await openPages(`window.MMDE_CONFIG = { apiBaseUrl: ${JSON.stringify(bad)} };`);
  let fetched = false;
  page.on('request', (r) => { if (/example|alert/.test(r.url())) fetched = true; });
  await page.waitForFunction(() => document.getElementById('backend-status')?.textContent.length > 0);
  check(`B2 hostile apiBaseUrl rejected, never fetched: ${bad.slice(0, 30)}`, /not a valid http\(s\) URL/.test(await page.textContent('#backend-status')) && !fetched && page.errors.length === 0);
  await page.close();
}

await browser.close();
await Promise.all([web.close(), good.close(), strict.close(), noTmdb.close()]);
process.exit(failed ? 1 : 0);
