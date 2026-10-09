// Real browser (mobile size), real GitHub Pages beta, real services. Prints what a visitor would see.
import { chromium } from 'playwright';
const BASE = 'https://saitejavoonna.github.io/MMDE/beta/';
let status = 0;
for (let i = 0; i < 12; i++) { const r = await fetch(BASE, { cache: 'no-store' }).catch(() => null); status = r?.status ?? 0; const t = r ? await r.text() : ''; if (status === 200 && t.includes('mmde-static.js')) break; console.log('waiting for Pages deploy, status', status); await new Promise((r) => setTimeout(r, 10000)); }
console.log('beta page status:', status);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
for (const [query, pickText] of [['fire force', null], ['rrr', null], ['bahubali', null]]) {
  const pg = await ctx.newPage();
  const errs = []; const failed = [];
  pg.on('pageerror', (e) => errs.push(String(e)));
  pg.on('requestfailed', (r) => failed.push(new URL(r.url()).host + ' ' + (r.failure()?.errorText ?? '')));
  pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });
  console.log(`\n=== "${query}"`);
  const t0 = Date.now();
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pg.waitForSelector('.hero', { timeout: 20000 });
  console.log('home status line:', await pg.$eval('#backend-status', (e) => e.innerText).catch(() => '?'));
  await pg.type('input.search', query, { delay: 30 });
  try { await pg.waitForSelector('.suggest button, .suggest .srow', { timeout: 30000 }); } catch { console.log('NO SUGGESTIONS'); }
  const sug = await pg.$$eval('.suggest .srow, .suggest button', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 70)));
  console.log('suggestions:', JSON.stringify(sug));
  if (!sug.length) { console.log('errors:', errs, 'failed:', failed); await pg.close(); continue; }
  console.log(`search took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await pg.click('.suggest .srow, .suggest button');
  try { await pg.waitForSelector('.dhero', { timeout: 40000 }); } catch { console.log('NO DETAILS PAGE'); }
  console.log('title:', await pg.$eval('.dhero h2', (e) => e.innerText).catch(() => '?'), '| seasons:', await pg.$$eval('.tl .tlitem', (e) => e.length), '| poster img:', await pg.$$eval('.dhero img', (e) => e.length));
  const t1 = Date.now();
  try { await pg.waitForSelector('.tlist .trow', { timeout: 60000 }); console.log(`first songs after ${((Date.now() - t1) / 1000).toFixed(1)}s`); } catch { console.log('NO SONGS within 60s'); }
  try { await pg.waitForFunction(() => !document.querySelector('.pending-note') && document.querySelector('.tlist .trow'), null, { timeout: 120000 }); console.log(`all stages done after ${((Date.now() - t1) / 1000).toFixed(1)}s`); } catch { console.log('stages not finished within 120s'); }
  console.log('sources:', JSON.stringify(await pg.$$eval('.srcchip', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')))));
  console.log('songs:', await pg.$$eval('.tlist .trow', (e) => e.length), '| sample:', JSON.stringify(await pg.$$eval('.tlist .trow .tinfo strong', (e) => e.slice(0, 5).map((x) => x.innerText.trim()))));
  console.log('summary line:', (await pg.$eval('.pending-note + .note, .tcount', (e) => e.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 120));
  console.log('page errors:', JSON.stringify(errs.slice(0, 5)), '| failed requests:', JSON.stringify([...new Set(failed)].slice(0, 8)));
  await pg.close();
}
await browser.close();
