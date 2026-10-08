import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// @ts-ignore plain JS module
import { classifyNode } from '../scripts/doctor.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const TOKEN = 'eyJ' + 'k'.repeat(60); // shaped like a v4 token, not real

test('classifyNode: too old / works with the flag / native', () => {
  assert.equal(classifyNode('v20.11.0'), 'too-old');
  assert.equal(classifyNode('v22.5.1'), 'too-old');
  assert.equal(classifyNode('v22.6.0'), 'flag');
  assert.equal(classifyNode('v22.13.0'), 'flag'); // the version Sai has
  assert.equal(classifyNode('v22.17.9'), 'flag');
  assert.equal(classifyNode('v22.18.0'), 'native');
  assert.equal(classifyNode('v24.1.0'), 'native');
});

async function withFakeTmdb(accepts: string, run: (base: string) => Promise<void>) {
  const server = createServer((req, res) => {
    const ok = req.headers.authorization === `Bearer ${accepts}`;
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (code: number, body: unknown) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (!ok) return send(401, { status_message: 'Invalid API key' });
    if (url.pathname === '/configuration') return send(200, { images: {} });
    if (url.pathname === '/search/tv') return send(200, { results: [{ id: 37430, name: 'That Time I Got Reincarnated as a Slime', first_air_date: '2018-10-02' }] });
    if (url.pathname === '/search/movie') return send(200, { results: [{ id: 9, title: 'Slime Movie', release_date: '2022-01-01' }] });
    if (url.pathname === '/tv/37430') return send(200, { seasons: [{ season_number: 1, name: 'Season 1', episode_count: 24, air_date: '2018-10-02' }, { season_number: 2, name: 'Season 2', episode_count: 24, air_date: '2021-01-12' }] });
    return send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`); } finally { server.close(); }
}

function runDoctor(envText: string | null, tmdbBase: string) {
  const dir = mkdtempSync(join(tmpdir(), 'mmde-doctor-'));
  copyFileSync(join(root, '.env.example'), join(dir, '.env.example'));
  if (envText !== null) writeFileSync(join(dir, '.env'), envText);
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const p = spawn(process.execPath, [join(root, 'scripts', 'doctor.mjs')], { env: { ...process.env, MMDE_ENV_DIR: dir, MMDE_TMDB_TEST_BASE: tmdbBase, MMDE_OFFLINE: '' }, cwd: root });
    let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

test('doctor: everything works with a valid token (search + seasons through the real server)', async () => {
  await withFakeTmdb(TOKEN, async (base) => {
    const r = await runDoctor(`TMDB_READ_ACCESS_TOKEN=${TOKEN}\n`, base);
    assert.equal(r.code, 0, r.out);
    for (const line of ['PASS  TMDB accepts the token', 'PASS  MMDE server starts', 'PASS  Server sees the TMDB token', 'PASS  Website files are served', 'PASS  Search "slime" through MMDE', 'PASS  Seasons for that title']) assert.ok(r.out.includes(line), `missing: ${line}\n${r.out}`);
    assert.match(r.out, /Season 1: 24 eps \| Season 2: 24 eps/);
    assert.match(r.out, /Everything works/);
    assert.ok(!r.out.includes(TOKEN), 'the token must never be printed');
  });
});

test('doctor: a token TMDB rejects is a FAIL with advice, exit code 1, token not printed', async () => {
  await withFakeTmdb('some-other-token', async (base) => {
    const r = await runDoctor(`TMDB_READ_ACCESS_TOKEN=${TOKEN}\n`, base);
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL  TMDB accepts the token - TMDB rejected this token/);
    assert.ok(!r.out.includes(TOKEN));
  });
});

test('doctor: the short 32-character API Key is caught with a clear message', async () => {
  await withFakeTmdb(TOKEN, async (base) => {
    const r = await runDoctor('TMDB_READ_ACCESS_TOKEN=0123456789abcdef0123456789abcdef\n', base);
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL  TMDB token in \.env - That looks like the short "API Key"/);
  });
});

test('doctor: no .env is a warning (not a failure) and the server/website checks still run', async () => {
  await withFakeTmdb(TOKEN, async (base) => {
    const r = await runDoctor(null, base);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /WARN  \.env file - not found/);
    assert.match(r.out, /PASS  MMDE server starts/);
    assert.match(r.out, /WARN  TMDB search \+ seasons - skipped/);
  });
});
