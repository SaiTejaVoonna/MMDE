// Live search check (run in CI, where the network is open): runs real queries against AniList and
// Wikipedia and writes out/latest.md with PASS/FAIL expectations, top results and anime seasons.
//   node search/scripts/check.js            (TMDB is skipped unless TMDB_API_KEY is set)
import { mkdir, writeFile } from 'node:fs/promises';
import { getDetail, searchAll } from '../src/search.js';

const UA = `MMDE-search-check/0.1 (personal, non-commercial; github.com/${process.env.GITHUB_REPOSITORY ?? 'SaiTejaVoonna/MMDE'})`;
const fetchImpl = (url, init = {}) => fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers ?? {}) } });
const tmdbKey = process.env.TMDB_API_KEY ?? '';

// [query, expectation description, test(results, detail)]
const CASES = [
  ['slime', 'a Slime title in the top 3', (r) => r.slice(0, 3).some((x) => /slime/i.test(x.title))],
  ['tensura', 'top result is Slime', (r) => /slime/i.test(r[0]?.title ?? '')],
  ['that time i got reincarnated as a slime', 'top result is Slime', (r) => /slime/i.test(r[0]?.title ?? '')],
  ['tensei shitara slime datta ken', 'top result is Slime', (r) => /slime/i.test(r[0]?.title ?? '')],
  ['og telugu movie', 'OG in the top 3', (r) => r.slice(0, 3).some((x) => /\bOG\b/.test(x.title))],
  ['bahubali', 'a Baahubali title in the top 3', (r) => r.slice(0, 3).some((x) => /baahubali|bahubali/i.test(x.title))],
  ['rrr telugu movie', 'RRR in the top 3', (r) => r.slice(0, 3).some((x) => /\bRRR\b/.test(x.title))],
  ['pushpa', 'a Pushpa title in the top 3', (r) => r.slice(0, 3).some((x) => /pushpa/i.test(x.title))],
  ['attack on titan', 'top is Attack on Titan, 3+ seasons', (r, d) => /attack on titan|shingeki/i.test(r[0]?.title ?? '') && (d?.franchise?.seasons.length ?? 0) >= 3],
  ['jujutsu kaisen', 'top is Jujutsu Kaisen, 2+ seasons', (r, d) => /jujutsu/i.test(r[0]?.title ?? '') && (d?.franchise?.seasons.length ?? 0) >= 2],
];

const lines = ['# MMDE search check', '', `Generated ${new Date().toISOString()} on Node ${process.version}; TMDB ${tmdbKey ? 'ON' : 'off (no key)'}`, ''];
const summary = [];
let pass = 0;
for (const [q, what, test] of CASES) {
  let out;
  let detail = null;
  let err = '';
  try {
    out = await searchAll(q, { fetchImpl, tmdbKey });
    if (out.results[0] && (out.results[0].kind === 'anime' || out.results[0].anilistId)) detail = await getDetail(out.results[0], { fetchImpl, tmdbKey });
  } catch (e) { err = e.message; out = { parsed: {}, results: [], notes: [] }; }
  const ok = !err && test(out.results, detail);
  if (ok) pass++;
  summary.push(`| ${ok ? 'PASS' : 'FAIL'} | ${q} | ${what} | ${out.results.length} |`);
  lines.push(`## ${ok ? 'PASS' : 'FAIL'}: "${q}"`, '', `expect: ${what}`, `parsed: ${JSON.stringify({ text: out.parsed?.text, lang: out.parsed?.lang, type: out.parsed?.type })}`,
    `sources: ${out.notes.map((n) => (n.skipped ? `${n.source} off` : n.ok ? `${n.source} ${n.count}` : `${n.source} FAILED ${n.error}`)).join(' | ')}${err ? ` | ERROR ${err}` : ''}`, '');
  out.results.slice(0, 6).forEach((r, i) => lines.push(`${i + 1}. ${r.title} (${[r.kind, r.year, r.language].filter(Boolean).join(', ')}) [${Object.keys(r.sources).join('+')}]${r.description ? ' - ' + r.description.slice(0, 90) : ''}`));
  if (detail?.franchise) {
    const f = detail.franchise;
    lines.push('', `seasons (${f.seasons.length}): ${f.seasons.map((s) => `${s.title} [${s.year}]`).join(' | ')}`, `movies (${f.movies.length}): ${f.movies.map((s) => s.title).join(' | ')}`, `other (${f.other.length}): ${f.other.slice(0, 8).map((s) => `${s.title} (${s.format})`).join(' | ')}`);
  }
  if (detail?.notes?.length) lines.push(`detail notes: ${detail.notes.join(' | ')}`);
  lines.push('');
}
const head = `# MMDE search check\n\n**${pass}/${CASES.length} expectations passed**\n\n| result | query | expectation | results |\n|---|---|---|---|\n${summary.join('\n')}\n\n`;
const md = head + lines.slice(3).join('\n');
await mkdir('out', { recursive: true });
await writeFile('out/latest.md', md);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, md, { flag: 'a' });
console.log(head);
