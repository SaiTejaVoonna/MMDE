// Browser-only mode test: opens web/index.html via file:// (NO server) with the four external
// APIs mocked at the network layer. Verifies the single-file bundle, direct fetch wiring,
// settings, discovery pipeline, localStorage persistence and the status rules.
// Needs Playwright + Chromium (not a project dependency):  PW_NODE_MODULES=/path/to/node_modules node scripts/ui-browser-mode.mjs
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
const { chromium } = createRequire((process.env.PW_NODE_MODULES ?? '/opt/node22/lib/node_modules') + '/')('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? '.';
let failed = false;
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed = true; };

const PAGE_TEXT = 'Season 1 used "Kaikai Kitan" by Eve as the first opening theme of Jujutsu Kaisen.';
const calls = { anilist: 0, mb: 0, wiki: 0, anthropic: 0 };
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

await page.route('https://graphql.anilist.co/**', (r) => { calls.anilist++; json(r, { data: { Page: { media: [{ id: 113415, idMal: 40748, seasonYear: 2020, title: { romaji: 'Jujutsu Kaisen', english: 'Jujutsu Kaisen', native: '呪術廻戦' }, synonyms: [] }] } } }); });
await page.route('https://musicbrainz.org/**', (r) => { calls.mb++; json(r, { recordings: [{ id: 'mbid-kaikai', title: 'Kaikai Kitan', length: 215000, 'artist-credit': [{ name: 'Eve' }], isrcs: ['JPPO02000001'] }] }); });
await page.route('https://en.wikipedia.org/**', (r) => {
  calls.wiki++;
  const u = r.request().url();
  if (!u.includes('origin=*')) return r.fulfill({ status: 403, body: 'missing origin=*' }); // real Wikipedia needs it for CORS
  json(r, u.includes('list=search') ? { query: { search: [{ title: 'Jujutsu Kaisen (TV series)' }] } } : { query: { pages: { 1: { extract: PAGE_TEXT } } } });
});
await page.route('https://api.anthropic.com/**', (r) => {
  calls.anthropic++;
  if (r.request().headers()['anthropic-dangerous-direct-browser-access'] !== 'true') return r.fulfill({ status: 403, body: 'missing browser-access header' });
  json(r, { content: [{ type: 'text', text: JSON.stringify([
    { part: { kind: 'season', number: 1 }, role: 'opening', position: 'OP1', title: 'Kaikai Kitan', artists: ['Eve'], quote: '"Kaikai Kitan" by Eve as the first opening theme' },
    { part: { kind: 'season', number: 1 }, role: 'ending', position: 'ED1', title: 'Totally Invented Song', artists: ['Nobody'], quote: 'Totally Invented Song by Nobody was the ending' },
  ]) }] });
});

const url = pathToFileURL(join(root, 'web', 'index.html')).href;
await page.goto(url);
await page.waitForSelector('.search');
check('opens from file:// with no server (landing renders)', (await page.textContent('h1')).includes('Discover the Music'));
check('mode label says direct in browser', (await page.textContent('main')).includes('direct in browser'));

// settings: enable AI extractor with a fake key
await page.click('summary:text-is("Settings")');
await page.fill('#akey', 'sk-test-fake');
await page.click('button:text-is("Save")');
check('settings saved', (await page.textContent('main')).includes('Saved.'));

// offline sample still works
await page.fill('input.search', 'slime');
await page.waitForSelector('.suggest button');
check('local sample found by search (no network needed)', (await page.textContent('.suggest')).includes('Slime'));

// live path: AniList -> discover -> wiki+AI -> MusicBrainz
await page.fill('input.search', 'jujutsu');
// wait until the FIRST suggestion is the new result (the old list for "slime" is still on screen until the debounce fires)
await page.waitForFunction(() => document.querySelectorAll('.suggest button').length === 1 && document.querySelector('.suggest button').firstChild.textContent === 'Jujutsu Kaisen');
await page.click('.suggest button');
await page.waitForSelector('.part', { timeout: 15000 });
const body = await page.textContent('main');
check('result page for AniList title', body.includes('Jujutsu Kaisen') && body.includes('Season 1'));
check('Kaikai Kitan present', body.includes('Kaikai Kitan'));
check('hallucinated song rejected by quote guard', !body.includes('Totally Invented Song'));
check('single source + MusicBrainz match => suggested (never confirmed)', (await page.locator('.track', { hasText: 'Kaikai Kitan' }).locator('.st.suggested').count()) === 1 && (await page.locator('.track .st.confirmed').count()) === 0);
await page.locator('.track', { hasText: 'Kaikai Kitan' }).locator('.tt').click();
const detail = await page.locator('.track.open .detail').textContent();
check('evidence shows Wikipedia source + quote', detail.includes('wikipedia+llm') && detail.includes('wikipedia.org') && detail.includes('Kaikai Kitan'));
check('MusicBrainz id + ISRC shown', detail.includes('mbid-kaikai') && detail.includes('JPPO02000001'));
check('5 platform search links on the row', (await page.locator('.track').first().locator('.row .plat.search').count()) === 5);
check('each external API was actually called', calls.anilist > 0 && calls.mb > 0 && calls.wiki > 0 && calls.anthropic > 0);
await page.screenshot({ path: join(out, 'browser-mode-result.png'), fullPage: true });

// persistence: reload keeps the stored result without re-fetching
const before = { ...calls };
await page.reload();
await page.waitForSelector('.part');
check('reload restores result from localStorage', (await page.textContent('main')).includes('Kaikai Kitan'));
check('no new network calls on reload', JSON.stringify(before) === JSON.stringify(calls));

// provider failure degrades gracefully
await page.unroute('https://musicbrainz.org/**');
await page.route('https://musicbrainz.org/**', (r) => r.fulfill({ status: 503, body: 'busy' }));
await page.click('button:text-is("Re-discover")');
await page.waitForSelector('.part', { timeout: 15000 });
check('MusicBrainz 503 shows a provider note, results still render', (await page.textContent('main')).includes('Provider notes') && (await page.textContent('main')).includes('Kaikai Kitan'));

// live off => no network provider calls for the sample
await page.evaluate(() => { localStorage.setItem('mmde.settings.v1', JSON.stringify({ live: false, anthropicKey: '' })); localStorage.removeItem('mmde.results.v1'); });
const n = { ...calls };
await page.goto(url + '#/');
await page.fill('input.search', 'slime');
await page.waitForSelector('.suggest button');
await page.click('.suggest button');
await page.waitForSelector('.part');
check('live off: Slime sample works and makes no API calls', (await page.locator('.track').count()) === 5 && JSON.stringify(n) === JSON.stringify(calls));

check('no page errors', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(failed ? 1 : 0);
