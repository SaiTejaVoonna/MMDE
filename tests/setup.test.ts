import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// @ts-ignore plain JS module
import { applyEnv, checkTokenShape, validateToken } from '../scripts/setup-env.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const FAKE = 'eyJ' + 'x'.repeat(60); // looks like a v4 token, is not real

test('applyEnv sets the token, keeps comments and unrelated lines, adds missing keys', () => {
  const base = '# comment\nTMDB_READ_ACCESS_TOKEN=\nMMDE_WEB_ORIGIN=https://a.github.io\nMMDE_CONTACT=\n';
  const out = applyEnv(base, { TMDB_READ_ACCESS_TOKEN: FAKE, MMDE_CONTACT: 'me@example.com' });
  assert.match(out, /^# comment$/m);
  assert.match(out, new RegExp(`^TMDB_READ_ACCESS_TOKEN=${FAKE}$`, 'm'));
  assert.match(out, /^MMDE_WEB_ORIGIN=https:\/\/a\.github\.io$/m);
  assert.match(out, /^MMDE_CONTACT=me@example\.com$/m);
  assert.equal(applyEnv('', { A_B: '1' }), 'A_B=1\n');
  assert.equal((applyEnv(out, { TMDB_READ_ACCESS_TOKEN: 'NEW'.padEnd(50, 'n') }).match(/TMDB_READ_ACCESS_TOKEN=/g) ?? []).length, 1, 'replaces, never duplicates');
});

test('checkTokenShape catches the common paste mistakes', () => {
  assert.equal(checkTokenShape(FAKE), '');
  assert.match(checkTokenShape(''), /Nothing/);
  assert.match(checkTokenShape('abc def ' + 'x'.repeat(60)), /no spaces or quotes/);
  assert.match(checkTokenShape(`"${FAKE}"`), /no spaces or quotes/);
  assert.match(checkTokenShape('0123456789abcdef0123456789abcdef'), /short "API Key"/);
  assert.match(checkTokenShape('tooshort'), /too short/);
});

test('validateToken: 200 ok, 401 rejected, other status, network failure; token only in the Authorization header', async () => {
  let seen: { url: string; auth: string } | undefined;
  const mk = (status: number) => (async (u: string, init: RequestInit) => { seen = { url: String(u), auth: (init.headers as Record<string, string>).Authorization }; return new Response('{}', { status }); }) as unknown as typeof fetch;
  assert.deepEqual(await validateToken(FAKE, mk(200)), { ok: true });
  assert.equal(seen!.auth, `Bearer ${FAKE}`);
  assert.ok(!seen!.url.includes(FAKE), 'token never in the URL');
  const bad = await validateToken(FAKE, mk(401));
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /rejected/);
  assert.match((await validateToken(FAKE, mk(500))).reason, /HTTP 500/);
  const offline = await validateToken(FAKE, (async () => { throw new Error('x'); }) as unknown as typeof fetch);
  assert.match(offline.reason, /Could not reach TMDB/);
  assert.ok(![bad.reason, offline.reason].some((r) => r.includes(FAKE)), 'messages never echo the token');
});

test('npm run setup: skipping writes nothing; the script never prints a pasted token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mmde-setup-'));
  const r = spawnSync('node', [join(root, 'scripts', 'setup-env.mjs')], { input: '\n', encoding: 'utf8', cwd: dir });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Skipped/);
  assert.ok(!existsSync(join(root, '.env.__never')), 'sanity');
  // a bad paste is rejected before any network call or file write, and is not echoed back
  const bad = spawnSync('node', [join(root, 'scripts', 'setup-env.mjs')], { input: `${'0123456789abcdef'.repeat(2)}\n`, encoding: 'utf8', cwd: dir });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /short "API Key"/);
  assert.ok(!(bad.stdout + bad.stderr).includes('0123456789abcdef0123456789abcdef'));
  void writeFileSync; void readFileSync;
});

test('npm run setup end to end: validates against (fake) TMDB, writes .env with the token, never prints it', async () => {
  const { createServer } = await import('node:http');
  const { copyFileSync, statSync } = await import('node:fs');
  const hits: Array<{ path: string; auth: string }> = [];
  const server = createServer((req, res) => { hits.push({ path: req.url ?? '', auth: String(req.headers.authorization) }); res.writeHead(req.headers.authorization === `Bearer ${FAKE}` ? 200 : 401).end('{}'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const dir = mkdtempSync(join(tmpdir(), 'mmde-env-'));
  copyFileSync(join(root, '.env.example'), join(dir, '.env.example'));
  const env = { ...process.env, MMDE_ENV_DIR: dir, MMDE_TMDB_TEST_BASE: `http://127.0.0.1:${port}` };
  const run = (input: string) => new Promise<{ status: number | null; out: string }>((resolve) => {
    import('node:child_process').then(({ spawn }) => {
      const p = spawn('node', [join(root, 'scripts', 'setup-env.mjs')], { env });
      let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
      p.on('close', (status) => resolve({ status, out })); p.stdin.end(input);
    });
  });
  try {
    const ok = await run(`${FAKE}\nops@example.com\n`);
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.out, /works\./);
    assert.ok(!ok.out.includes(FAKE), 'token must not be printed');
    const env1 = readFileSync(join(dir, '.env'), 'utf8');
    assert.match(env1, new RegExp(`^TMDB_READ_ACCESS_TOKEN=${FAKE}$`, 'm'));
    assert.match(env1, /^MMDE_CONTACT=ops@example\.com$/m);
    assert.match(env1, /^MMDE_WEB_ORIGIN=$/m, 'other template keys preserved');
    if (process.platform !== 'win32') assert.equal(statSync(join(dir, '.env')).mode & 0o077, 0, '.env is owner-only');
    assert.equal(hits[0]!.path, '/configuration');
    // a wrong-but-well-formed token is rejected by "TMDB" (401) and nothing is overwritten
    const wrong = await run(`eyJ${'y'.repeat(60)}\n`);
    assert.equal(wrong.status, 1);
    assert.match(wrong.out, /rejected/);
    assert.equal(readFileSync(join(dir, '.env'), 'utf8'), env1, 'existing .env untouched after a failed validation');
  } finally { server.close(); }
});
