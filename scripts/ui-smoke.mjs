// STALE: written for the legacy bundle (web/mmde.js). web/index.html now loads web/mmde-phase1.js, so this test already
// fails on origin/main (verified 2026-10-08). Not run in CI. Kept until the legacy browser-only mode is revived or removed.
// Browser smoke test. Needs Playwright + Chromium installed (not a project dependency).
// Usage: MMDE_OFFLINE=1 npm start &  then  PW_NODE_MODULES=/path/to/node_modules node scripts/ui-smoke.mjs ./out
import { createRequire } from 'node:module';
const require = createRequire((process.env.PW_NODE_MODULES ?? '/opt/node22/lib/node_modules') + '/');
const { chromium } = require('playwright');
const SP = process.argv[2] ?? '.';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const notFound = [];
page.on('response', (r) => { if (r.status() === 404) notFound.push(new URL(r.url()).pathname); });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text()); });
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) process.exitCode = 1; };

await page.goto('http://localhost:8787/');
check('landing renders hero', (await page.textContent('h1')).includes('Discover the Music'));
await page.screenshot({ path: `${SP}/1-landing.png` });

await page.fill('input.search', 'slime');
await page.waitForSelector('.suggest button');
check('typeahead shows Slime', (await page.textContent('.suggest')).includes('Reincarnated as a Slime'));
await page.screenshot({ path: `${SP}/2-suggest.png` });

await page.click('.suggest button');
await page.waitForSelector('.part', { timeout: 10000 });
check('result page has Season 1', (await page.textContent('h3.part')).includes('Season 1'));
const rows = await page.locator('.track').count();
check('5 tracks rendered', rows === 5);
const body = await page.textContent('main');
check('OP1 Nameless Story shown', body.includes('Nameless Story'));
check('Scarlet Bond OST release shown', body.includes('Scarlet Bond') && body.includes('Soundtrack releases'));
check('unverified badge shown (offline)', body.includes('unverified'));
await page.screenshot({ path: `${SP}/3-result.png`, fullPage: true });

await page.click('.track .tt');
check('first row shows 5 platform links', (await page.locator('.track').first().locator('.row .plat').count()) === 5);
check('detail expands with evidence', (await page.locator('.track.open .detail').textContent()).includes('curated-seed'));
check('search links are labelled as search', (await page.locator('.track').first().locator('.plat.search').count()) === 5);
const href = await page.locator('.track').first().locator('.plat').first().getAttribute('href');
check('platform link is https', href?.startsWith('https://'));
await page.screenshot({ path: `${SP}/4-expanded.png`, fullPage: true });

await page.click('button.chip:text-is("Endings")');
check('Endings filter hides openings', !(await page.textContent('main')).includes('Nameless Story') && (await page.textContent('main')).includes('Little Soldier'));
await page.click('button.chip:text-is("OST")');
check('OST filter shows the OST release', (await page.textContent('main')).includes('Scarlet Bond'));

await page.reload();
await page.waitForSelector('.part');
check('reload on #/media/slime serves stored result', (await page.locator('.track').count()) === 5);

await page.setViewportSize({ width: 390, height: 800 });
await page.screenshot({ path: `${SP}/5-mobile.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check('no horizontal overflow on mobile', !overflow);

check('no JS/console errors', errors.length === 0);
const unexpected404 = notFound.filter((u) => !u.startsWith('/api/media/'));
check('only expected 404s (not-yet-discovered media): ' + JSON.stringify([...new Set(notFound)]), unexpected404.length === 0);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
