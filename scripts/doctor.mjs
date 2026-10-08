// One command that checks the whole local setup:  npm run doctor
// Node version, project files, .env + token, TMDB (token really works), port, then it starts the REAL MMDE server
// and runs the real search + seasons through it. Prints PASS / WARN / FAIL with what to do. Never prints the token.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTokenShape, validateToken } from './setup-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envDir = process.env.MMDE_ENV_DIR || root;
const results = [];
const note = (level, name, detail = '') => { results.push(level); console.log(`${level.padEnd(4)}  ${name}${detail ? ' - ' + detail : ''}`); };
const pass = (n, d) => note('PASS', n, d);
const warn = (n, d) => note('WARN', n, d);
const fail = (n, d) => note('FAIL', n, d);

/** "v22.13.0" -> 'too-old' | 'flag' (works, scripts add --experimental-strip-types) | 'native'. Pure, exported for tests. */
export function classifyNode(version) {
  const [maj, min] = String(version).replace(/^v/, '').split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 6)) return 'too-old';
  if (maj === 22 && min < 18) return 'flag';
  return 'native';
}

const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const portInUse = (port) => new Promise((resolve) => { const s = createServer(); s.once('error', () => resolve(true)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(false))); });
const getJson = async (url) => { const r = await fetch(url); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('MMDE doctor\n');

  // 1. Node
  const kind = classifyNode(process.version);
  if (kind === 'too-old') fail('Node version', `${process.version} is too old. Install the current "LTS" (22.x) from nodejs.org, then reopen the terminal.`);
  else if (kind === 'flag') pass('Node version', `${process.version} works (npm scripts add --experimental-strip-types for you). Upgrading to 22.18+ is optional.`);
  else pass('Node version', `${process.version}`);

  // 2. Project files
  const need = ['package.json', 'src/server/main.ts', 'web/index.html', 'web/config.js', 'web/mmde-phase1.js', '.env.example'];
  const missing = need.filter((f) => !existsSync(join(root, f)));
  if (missing.length) fail('Project files', `missing: ${missing.join(', ')}. Are you inside the MMDE folder on the right branch?`);
  else pass('Project files', 'all present');

  // 3. .env and token
  const envPath = join(envDir, '.env');
  let token = '';
  if (!existsSync(envPath)) warn('.env file', 'not found. Run:  npm run setup   (TMDB checks below are skipped)');
  else {
    const m = /^TMDB_READ_ACCESS_TOKEN=(.*)$/m.exec(readFileSync(envPath, 'utf8'));
    token = (m?.[1] ?? '').trim();
    if (!token) warn('TMDB token in .env', 'empty. Run:  npm run setup');
    else {
      const shape = checkTokenShape(token);
      if (shape) { fail('TMDB token in .env', shape + ' Run:  npm run setup'); token = ''; }
      else pass('TMDB token in .env', `present (${token.length} characters, not shown)`);
    }
  }

  // 4. Token really works at TMDB
  const testBase = process.env.MMDE_TMDB_TEST_BASE;
  if (token) {
    const v = await validateToken(token, testBase ? ((u, i) => fetch(String(u).replace('https://api.themoviedb.org/3', testBase), i)) : fetch);
    if (v.ok) pass('TMDB accepts the token', 'HTTP 200'); else { fail('TMDB accepts the token', v.reason); token = ''; }
  }

  // 5. Default port
  const wantPort = Number(process.env.PORT || 8787);
  if (await portInUse(wantPort)) warn(`Port ${wantPort}`, 'already in use (MMDE may already be running; close that window before running npm start)');
  else pass(`Port ${wantPort}`, 'free');

  // 6. Start the real server and test it
  const port = await freePort();
  const flags = classifyNode(process.version) === 'native' ? [] : ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];
  const child = spawn(process.execPath, [...flags, `--env-file-if-exists=${envPath}`, join(root, 'src/server/main.ts'), `--port=${port}`], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  try {
    let up = false;
    for (let i = 0; i < 60 && !up && child.exitCode === null; i++) { try { up = (await fetch(`${base}/api/health`)).ok; } catch { await sleep(250); } }
    if (!up) fail('MMDE server starts', 'did not come up. Server output:\n' + log.split('\n').filter(Boolean).slice(-8).map((l) => '      ' + l).join('\n'));
    else {
      pass('MMDE server starts', 'health check answered');
      const h = (await getJson(`${base}/api/health`)).body;
      if (token) { if (h.tmdb) pass('Server sees the TMDB token', 'configured'); else fail('Server sees the TMDB token', 'server says TMDB is not configured'); }
      const home = await fetch(`${base}/`); const html = await home.text();
      if (home.ok && html.includes('MMDE')) pass('Website files are served', 'index.html OK'); else fail('Website files are served', `HTTP ${home.status}`);
      const cfg = await fetch(`${base}/config.js`);
      if (cfg.ok) pass('config.js is served', 'OK'); else fail('config.js is served', `HTTP ${cfg.status}`);
      if (token && h.tmdb) {
        const s = await getJson(`${base}/api/search?q=slime&sources=tmdb,local-seeds`);
        const tv = (s.body.results ?? []).find((r) => /^tmdb-tv-\d+$/.test(r.id) && /slime/i.test(r.title));
        if (s.status !== 200) fail('Search "slime" through MMDE', `HTTP ${s.status}`);
        else if (!tv) fail('Search "slime" through MMDE', `no TMDB TV result. Sources: ${(s.body.sources ?? []).join(', ')}. Errors: ${(s.body.errors ?? []).join(' | ') || 'none'}. Got ${(s.body.results ?? []).length} results: ${(s.body.results ?? []).slice(0, 6).map((r) => `${r.title} [${r.id}]`).join('; ') || 'none'}. (Often a network blip: run the doctor again.)`);
        else {
          pass('Search "slime" through MMDE', `${s.body.results.length} results; found "${tv.title}" (${tv.id})`);
          const seasons = await getJson(`${base}/api/seasons/${encodeURIComponent(tv.id)}`);
          const list = seasons.body.seasons ?? [];
          if (seasons.status === 200 && list.length) pass('Seasons for that title', list.map((x) => `${x.name}: ${x.episodeCount} eps`).join(' | '));
          else fail('Seasons for that title', `HTTP ${seasons.status} ${seasons.body.error ?? ''}`);
        }
      } else warn('TMDB search + seasons', 'skipped (no working token). Run:  npm run setup');
    }
  } finally { child.kill(); }

  const bad = results.filter((r) => r === 'FAIL').length;
  const warns = results.filter((r) => r === 'WARN').length;
  console.log(`\n${bad ? `${bad} problem(s) found. Fix the FAIL lines above (top to bottom), then run: npm run doctor` : warns ? `No failures, ${warns} warning(s). You can run: npm start` : 'Everything works. Run: npm start   then open http://localhost:8787'}`);
  process.exit(bad ? 1 : 0);
}

// Run only when invoked directly (so tests can import classifyNode without running the checks).
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) await main();
