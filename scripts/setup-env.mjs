// One-time local setup: asks for your TMDB "API Read Access Token", TESTS it against TMDB, and saves it to .env
// (git-ignored, never committed, never sent to the browser). Run:  npm run setup
// The token is typed/pasted at the prompt (not as a command-line argument, so it stays out of shell history).
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Test hooks only: where to write .env, and which API host to test the token against.
const envDir = process.env.MMDE_ENV_DIR || root;
const tmdbBase = process.env.MMDE_TMDB_TEST_BASE || 'https://api.themoviedb.org/3';

/** Update/insert KEY=value lines, keeping comments and unrelated lines. Pure. */
export function applyEnv(existing, updates) {
  const lines = String(existing ?? '').split(/\r?\n/);
  const done = new Set();
  const out = lines.map((line) => {
    const m = /^([A-Z_][A-Z0-9_]*)=/.exec(line);
    if (m && m[1] in updates) { done.add(m[1]); return `${m[1]}=${updates[m[1]]}`; }
    return line;
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  for (const [k, v] of Object.entries(updates)) if (!done.has(k)) out.push(`${k}=${v}`);
  return out.join('\n') + '\n';
}

/** What kind of mistake does this pasted value look like? Returns an error string or ''. */
export function checkTokenShape(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return 'Nothing was entered.';
  if (/\s|["']/.test(t)) return 'The token must be one piece with no spaces or quotes. Paste only the token itself.';
  if (/^[a-f0-9]{32}$/i.test(t)) return 'That looks like the short "API Key". You need the much longer "API Read Access Token" from the same TMDB page.';
  if (t.length < 40) return 'That is too short to be the "API Read Access Token" (it is a very long string).';
  return '';
}

/** Ask TMDB whether the token works (HTTP 200 = valid, 401 = rejected). Never logs the token. */
export async function validateToken(token, fetchImpl = fetch) {
  let res;
  try { res = await fetchImpl(`${tmdbBase}/configuration`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } }); }
  catch { return { ok: false, reason: 'Could not reach TMDB (check your internet connection) so the token could not be tested.' }; }
  if (res.status === 200) return { ok: true };
  if (res.status === 401) return { ok: false, reason: 'TMDB rejected this token (401). Copy the "API Read Access Token" again, without extra characters.' };
  return { ok: false, reason: `TMDB answered HTTP ${res.status}; try again in a minute.` };
}

async function main() {
  const envPath = join(envDir, '.env');
  const rl = createInterface({ input: stdin });
  const lines = rl[Symbol.asyncIterator]();
  // Reads one line; end of input (piped input, Ctrl+D) counts as an empty answer instead of crashing.
  const ask = async (prompt) => { stdout.write(prompt); const r = await lines.next(); return r.done ? '' : String(r.value); };
  console.log('MMDE local setup\n');
  console.log('Your TMDB token is saved ONLY in the file .env on this computer. It is git-ignored and never sent to the browser.');
  console.log('Get it: themoviedb.org > Settings > API > "API Read Access Token" (the long one).\n');
  const token = (await ask('Paste your TMDB API Read Access Token (or just press Enter to skip): ')).trim();
  let contact = '';
  if (token) {
    const problem = checkTokenShape(token);
    if (problem) { console.error('\nNot saved. ' + problem); rl.close(); process.exit(1); }
    process.stdout.write('Testing the token with TMDB... ');
    const v = await validateToken(token);
    if (!v.ok) { console.error('\nNot saved. ' + v.reason); rl.close(); process.exit(1); }
    console.log('works.');
    contact = (await ask('Optional contact (your email) for the User-Agent sent to music databases, or Enter to skip: ')).trim();
  }
  rl.close();
  if (!token) { console.log('Skipped. You can run "npm run setup" again any time.'); return; }
  const base = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(join(root, '.env.example'), 'utf8');
  const updates = { TMDB_READ_ACCESS_TOKEN: token };
  if (contact) updates.MMDE_CONTACT = contact;
  writeFileSync(envPath, applyEnv(base, updates));
  try { chmodSync(envPath, 0o600); } catch { /* not supported on Windows */ }
  console.log(`\nSaved to ${envPath} (${token.length} characters; not shown).`);
  console.log('Next: run  npm start  then open http://localhost:8787');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
