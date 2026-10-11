// Measures discovery quality on real titles against a running MMDE API (the Worker via `wrangler dev`, the Node server, or a deployed Worker).
//   BASE_URL=http://127.0.0.1:8788 node scripts/golden.mjs [--titles=2] [--json=out.json]
// For each title: search -> details -> soundtrack (wiki stage, then full) -> artwork. Prints a table and a JSON summary.
// It measures; it never "passes" or "fails" quality (only a dead API is an error). Sai decides what counts as good.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.env.BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const limit = Number(arg('titles') ?? 999);
const { titles } = JSON.parse(readFileSync(join(root, 'data', 'golden', 'titles.json'), 'utf8'));

const get = async (path, timeoutMs = 120_000) => {
  const t0 = Date.now();
  try {
    const r = await fetch(base + path, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body, ms: Date.now() - t0, cache: r.headers.get('x-mmde-cache') };
  } catch (e) { return { status: 0, body: { error: String(e?.message ?? e) }, ms: Date.now() - t0 }; }
};
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => `${k}=${encodeURIComponent(v === true ? '1' : v)}`).join('&');
const pct = (n, d) => (d ? Math.round((100 * n) / d) + '%' : '-');

const health = await get('/api/health');
console.log(`API ${base}: HTTP ${health.status} ${JSON.stringify(health.body)}`);
if (health.status !== 200) { console.error('API is not answering'); process.exit(1); }

const rows = [];
for (const t of titles.slice(0, limit)) {
  const row = { query: t.query, kind: t.kind };
  const s = await get(`/api/search?${q({ q: t.query })}`);
  const results = s.body.results ?? [];
  row.search = { status: s.status, ms: s.ms, results: results.length, errors: s.body.errors ?? [], top: results.slice(0, 3).map((r) => `${r.title}${r.year ? ' (' + r.year + ')' : ''}`) };
  const pick = results.find((r) => r.title?.toLowerCase().includes(String(t.expect).toLowerCase()) && (!t.year || !r.year || Math.abs(r.year - t.year) <= 1)) ?? null;
  row.found = !!pick;
  row.hasPoster = !!pick?.posterPath;
  if (pick) {
    const d = await get(`/api/details/${encodeURIComponent(pick.id)}`);
    const det = d.body ?? {};
    row.details = { status: d.status, ms: d.ms, composers: det.composers ?? [], alts: (det.altTitles ?? []).length, year: det.year };
    const title = det.title ?? pick.title; const year = det.year ?? pick.year ?? t.year;
    const extra = { composer: (det.composers ?? []).join('|'), alt: (det.altTitles ?? []).join('|'), anime: t.anime || (det.genres ?? []).includes('Animation') };
    const w = await get(`/api/soundtrack-merged?${q({ title, year, stage: 'wiki', ...extra })}`);
    row.wikiStage = { status: w.status, ms: w.ms, songs: w.body.counts?.total ?? 0 };
    const f = await get(`/api/soundtrack-merged?${q({ title, year, ...extra })}`);
    const sec = (f.body.sections ?? []);
    const tracks = sec.flatMap((x) => x.tracks ?? []);
    const apple = tracks.filter((x) => /music\.apple\.com|itunes\.apple\.com/.test(x.links?.apple ?? x.links?.catalog ?? Object.values(x.links ?? {}).join(' '))).length;
    const deezer = tracks.filter((x) => /deezer\.com/.test(Object.values(x.links ?? {}).join(' '))).length;
    row.full = {
      status: f.status, ms: f.ms, songs: f.body.counts?.total ?? 0, green: f.body.counts?.green ?? 0, amber: f.body.counts?.amber ?? 0, red: f.body.counts?.red ?? 0,
      withProof: tracks.filter((x) => x.proof?.isrc).length, withAppleLink: apple, withDeezerLink: deezer, albums: (f.body.albums ?? []).length, languages: (f.body.languages ?? []).map((l) => `${l.language}:${l.songs}`),
      verified: f.body.verified, composerSource: f.body.composerSource, partial: !!f.body.partial,
      sources: (f.body.sources ?? []).map((x) => `${x.key}:${x.state}`), error: f.status !== 200 ? f.body.error : undefined,
    };
    row.meetsFloor = row.full.songs >= (t.minSongs ?? 0);
    const a = await get(`/api/artwork?${q({ title, year, type: det.kind === 'tv' ? 'tv' : det.kind === 'movie' ? 'movie' : undefined, anime: extra.anime })}`);
    row.artwork = { status: a.status, ms: a.ms, found: a.body.artwork ? `${a.body.artwork.source}/${a.body.artwork.kind}` : null };
  }
  rows.push(row);
  const f = row.full;
  console.log(`\n== ${t.query}  [${t.kind}]`);
  console.log(`   search ${row.search.status} ${row.search.ms}ms, ${row.search.results} results, top: ${row.search.top.join(' | ') || '-'}${row.search.errors.length ? '  ERRORS: ' + row.search.errors.join('; ') : ''}`);
  if (!row.found) { console.log('   expected title NOT found in results'); continue; }
  console.log(`   poster: ${row.hasPoster ? 'yes' : 'no'}   composers: ${row.details.composers.join(', ') || '-'}   alt titles: ${row.details.alts}`);
  console.log(`   wiki stage ${row.wikiStage.ms}ms -> ${row.wikiStage.songs} songs`);
  console.log(`   full ${f.ms}ms HTTP ${f.status}: ${f.songs} songs (green ${f.green} / amber ${f.amber} / red ${f.red}), exact Apple link ${pct(f.withAppleLink, f.songs)}, Deezer ${pct(f.withDeezerLink, f.songs)}, ISRC proof ${pct(f.withProof, f.songs)}, albums ${f.albums}, verified: ${f.verified}, composer from: ${f.composerSource ?? '-'}, partial: ${f.partial}`);
  console.log(`   sources: ${f.sources.join(' ') || '-'}   languages: ${f.languages.join(' ') || '-'}${f.error ? '   ERROR: ' + f.error : ''}`);
  console.log(`   artwork: ${row.artwork.found ?? 'none'} (${row.artwork.ms}ms)   floor ${t.minSongs}: ${row.meetsFloor ? 'met' : 'NOT met'}`);
}
const done = rows.filter((r) => r.full);
const tot = done.reduce((a, r) => ({ songs: a.songs + r.full.songs, green: a.green + r.full.green, apple: a.apple + r.full.withAppleLink, isrc: a.isrc + r.full.withProof }), { songs: 0, green: 0, apple: 0, isrc: 0 });
console.log(`\nSUMMARY: ${rows.length} titles, ${rows.filter((r) => r.found).length} found, ${done.filter((r) => r.meetsFloor).length} met their song floor, ${rows.filter((r) => r.artwork?.found).length + rows.filter((r) => r.hasPoster && !r.artwork?.found).length} have a picture; songs ${tot.songs}, green ${pct(tot.green, tot.songs)}, exact Apple link ${pct(tot.apple, tot.songs)}, ISRC proof ${pct(tot.isrc, tot.songs)}`);
if (arg('json')) writeFileSync(arg('json'), JSON.stringify(rows, null, 2));
