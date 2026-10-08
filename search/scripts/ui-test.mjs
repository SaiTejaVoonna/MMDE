// Browser test: opens search/index.html over file:// (no server) with AniList + Wikipedia mocked at the
// network layer. Needs Playwright + Chromium (not a project dependency):
//   PW_NODE_MODULES=/path/to/node_modules node search/scripts/ui-test.mjs [outdir]
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
const { chromium } = createRequire((process.env.PW_NODE_MODULES ?? '/opt/node22/lib/node_modules') + '/')('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? '.';
let failed = false;
const check = (name, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed = true; };
const cors = { 'access-control-allow-origin': '*' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });

const media = (id, eng, rom, year, syn = []) => ({ id, idMal: id, title: { romaji: rom, english: eng, native: 'x' }, synonyms: syn, format: 'TV', episodes: 24, status: 'FINISHED', seasonYear: year, startDate: { year }, coverImage: { medium: null }, description: 'desc', countryOfOrigin: 'JP' });
const node = (id, fmt, year, title) => ({ id, type: 'ANIME', title: { romaji: title, english: title }, format: fmt, episodes: 12, status: 'FINISHED', startDate: { year, month: 1, day: 1 }, coverImage: { medium: null } });
const N = { 1: node(1, 'TV', 2018, 'Slime S1'), 2: node(2, 'TV', 2021, 'Slime S2'), 3: node(3, 'TV', 2021, 'Slime S2 Part 2'), 4: node(4, 'TV', 2024, 'Slime S3'), 5: node(5, 'MOVIE', 2022, 'Slime Movie: Scarlet Bond'), 6: node(6, 'OVA', 2019, 'Slime OVA') };
const rel = { 1: [['SEQUEL', 2], ['SIDE_STORY', 6]], 2: [['PREQUEL', 1], ['SEQUEL', 3], ['SIDE_STORY', 5]], 3: [['PREQUEL', 2], ['SEQUEL', 4]], 4: [['PREQUEL', 3]], 5: [], 6: [] };
const wikiPages = (items) => ({ query: { pages: Object.fromEntries(items.map((t, i) => [i + 1, { pageid: i + 1, index: i + 1, title: t[0], description: t[1] }])) } });

let aniFail = false;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('https://graphql.anilist.co/**', (route) => {
  if (aniFail) return json(route, {}, 429);
  const { variables } = JSON.parse(route.request().postData());
  if (variables.q !== undefined) {
    const q = variables.q.toLowerCase();
    if (/slime|tensura|tensei/.test(q)) return json(route, { data: { Page: { media: [media(1, 'That Time I Got Reincarnated as a Slime', 'Tensei shitara Slime Datta Ken', 2018, ['Tensura']), media(2, 'That Time I Got Reincarnated as a Slime Season 2', 'Tensei shitara Slime Datta Ken 2nd Season', 2021)] } } });
    return json(route, { data: { Page: { media: [] } } });
  }
  return json(route, { data: { Page: { media: variables.ids.filter((i) => N[i]).map((i) => ({ ...N[i], relations: { edges: rel[i].map(([t, id]) => ({ relationType: t, node: N[id] })) } })) } } });
});
await page.route('https://en.wikipedia.org/**', (route) => {
  const u = decodeURIComponent(route.request().url()).replace(/\+/g, ' ');
  if (u.includes('prop=extracts')) return json(route, { query: { pages: { 1: { extract: 'A salaryman is reincarnated as a slime.' } } } });
  if (/og telugu film/i.test(u)) return json(route, wikiPages([['They Call Him OG', '2025 Indian Telugu-language action film'], ['OG (disambiguation)', 'Topics referred to by the same term']]));
  if (/bahubali/i.test(u)) return json(route, wikiPages([['Baahubali: The Beginning', '2015 Indian epic action film'], ['Baahubali 2: The Conclusion', '2017 Indian epic action film']]));
  if (/xss/i.test(u)) return json(route, wikiPages([['<img src=x onerror=window.__pwned=1>Evil', '2020 American film']]));
  if (/slime|tensura/i.test(u)) return json(route, wikiPages([['That Time I Got Reincarnated as a Slime', 'Japanese light novel series'], ['Slime (toy)', 'Toy']]));
  return json(route, { batchcomplete: '' });
});

await page.goto(pathToFileURL(join(here, '..', 'index.html')).href);
check('opens from file:// with no server', (await page.textContent('h1')).includes('MMDE'));

await page.fill('#q', 'tensura');
await page.waitForSelector('#results .card');
let cards = await page.locator('#results .card').count();
check('"tensura" finds Slime as ONE card (seasons collapsed, AniList+Wikipedia merged)', cards === 1 && (await page.textContent('#results')).includes('That Time I Got Reincarnated as a Slime'));
check('card shows both source links', (await page.locator('#results .card .src').allTextContents()).join(',') === 'AniList,Wikipedia');
check('status line lists each source count', /AniList 1/.test(await page.textContent('#status')) && /Wikipedia 1/.test(await page.textContent('#status')));
await page.screenshot({ path: join(out, 'search-results.png') });

await page.click('#results .card');
await page.waitForSelector('h3:text("Seasons")');
const seasons = await page.locator('section:has(h3:text("Seasons")) .row').allTextContents();
check('anime detail lists 4 seasons in order (S1..S4)', seasons.length === 4 && seasons[0].includes('S1') && seasons[0].includes('Slime S1') && seasons[3].includes('Slime S3'));
check('movies and OVAs/specials listed', (await page.textContent('#detail')).includes('Slime Movie: Scarlet Bond') && (await page.textContent('#detail')).includes('Slime OVA'));
check('no stray "null" text in the detail view', !(await page.textContent('#detail')).includes('null'));
check('Wikipedia summary shown', (await page.textContent('#detail')).includes('A salaryman is reincarnated'));
await page.screenshot({ path: join(out, 'search-detail.png'), fullPage: true });
check('results list is hidden while the detail view is open', await page.locator('#results').isHidden());
await page.click('button:text("Results")');
check('Back returns to the results list', await page.locator('#results').isVisible());

await page.fill('#q', 'og telugu movie');
await page.waitForFunction(() => document.querySelector('#results .card .title')?.textContent === 'They Call Him OG');
check('"og telugu movie" finds OG first; hints parsed', /language: telugu/.test(await page.textContent('#status')) && /type: movie/.test(await page.textContent('#status')));
check('AniList not queried for a Telugu search', !/AniList \d/.test(await page.textContent('#status')) && !/AniList FAILED/.test(await page.textContent('#status')));

await page.fill('#q', 'bahubali');
await page.waitForFunction(() => document.querySelector('#results .card .title')?.textContent.startsWith('Baahubali'));
check('"bahubali" finds Baahubali', (await page.locator('#results .card .title').first().textContent()).includes('Baahubali'));

aniFail = true;
await page.fill('#q', 'slime');
await page.waitForFunction(() => /AniList FAILED/.test(document.querySelector('#status').textContent));
check('AniList 429 is shown, Wikipedia results still render', (await page.locator('#results .card').count()) >= 1 && /AniList FAILED: HTTP 429/.test(await page.textContent('#status')));
aniFail = false;

await page.fill('#q', 'xss test');
await page.waitForFunction(() => document.querySelector('#results .card .title')?.textContent.includes('Evil'));
check('HTML in titles is rendered as text (no injection)', (await page.evaluate(() => window.__pwned)) === undefined && (await page.locator('#results img[src="x"]').count()) === 0 && (await page.textContent('#results')).includes('<img src=x'));

await page.fill('#q', 'zzzzzz');
await page.waitForFunction(() => document.querySelector('#results .empty'));
check('no-results state explains itself', (await page.textContent('#results')).includes('No results'));

await page.setViewportSize({ width: 390, height: 800 });
await page.fill('#q', 'bahubali');
await page.waitForSelector('#results .card');
check('no horizontal overflow on mobile', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
check('no page errors', errors.length === 0);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(failed ? 1 : 0);
