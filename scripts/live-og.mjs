import { wikiSoundtrack } from '../src/providers/wikiSoundtrack.ts';
import { catalogResolver } from '../src/providers/catalogAlbums.ts';
import { buildMergedSoundtrack } from '../src/app/soundtrackService.ts';
const ua = 'MMDE-live-check/0.6 (GitHub Actions; personal non-commercial prototype)';
const out = { probes: {}, merged: {} };
const get = async (u, headers = {}) => { try { const r = await fetch(u, { headers: { 'User-Agent': ua, Accept: 'application/json', ...headers } }); return r.ok ? await r.json() : { error: r.status }; } catch (e) { return { error: String(e.message) }; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// --- probes of free, no-key sources
const at = await get('https://api.animethemes.moe/anime?' + new URLSearchParams({ 'q': 'Fire Force', 'include': 'animethemes.song.artists', 'page[size]': '5' }));
out.probes.animethemes = at.error ? at : (at.anime ?? []).map((a) => `${a.name} | ${a.year} ${a.season} | themes ${(a.animethemes ?? []).length} | ` + (a.animethemes ?? []).slice(0, 3).map((t) => `${t.slug}: ${t.song?.title} by ${(t.song?.artists ?? []).map((x) => x.name).join(', ')}`).join(' ; '));
await sleep(1200);
const mb = await get('https://musicbrainz.org/ws/2/release-group?' + new URLSearchParams({ query: 'releasegroup:"Fire Force" AND secondarytype:soundtrack', fmt: 'json', limit: '8' }));
out.probes.musicbrainz = mb.error ? mb : (mb['release-groups'] ?? []).map((g) => `${g.title} | ${(g['artist-credit'] ?? []).map((a) => a.name).join(', ')} | ${g['first-release-date']} | score ${g.score}`);
await sleep(1200);
const jk = await get('https://api.jikan.moe/v4/anime?' + new URLSearchParams({ q: 'Fire Force', limit: '3' }));
out.probes.jikan = jk.error ? jk : (jk.data ?? []).map((a) => `${a.mal_id} | ${a.title} | ${a.year} ${a.season} | ${a.title_japanese}`);
if (jk.data?.[0]) { await sleep(1200); const th = await get(`https://api.jikan.moe/v4/anime/${jk.data[0].mal_id}/themes`); out.probes.jikanThemes = th.error ? th : { openings: (th.data?.openings ?? []).slice(0, 4), endings: (th.data?.endings ?? []).slice(0, 4) }; }
// --- merged flow with the new matching rules
const wiki = wikiSoundtrack(ua); const cat = catalogResolver(ua);
const src = { wiki: (t, y, a) => wiki.find(t, y, a), albums: (t, y, x, a) => cat.findAlbums(t, y, x, a), albumTracks: (p, id) => cat.tracks(p, id) };
for (const [label, title, year, ctx] of [
  ['Fire Force', 'Fire Force', 2019, { composers: ['Taku Iwasaki'], alts: ['炎炎ノ消防隊', 'Enen no Shouboutai'] }],
  ['Irregular at Magic High School', 'The Irregular at Magic High School', 2014, { composers: ['Taku Iwasaki'], alts: ['魔法科高校の劣等生', 'Mahouka Koukou no Rettousei'] }],
]) {
  const t0 = Date.now();
  try {
    const m = await buildMergedSoundtrack(src, title, year, ctx);
    out.merged[label] = { seconds: Math.round((Date.now() - t0) / 1000), partial: m.partial, verified: m.verified, counts: m.counts, wikipedia: m.wikipedia?.title ?? null,
      albums: m.albums.slice(0, 8).map((a) => `${a.platform}: ${a.name.slice(0, 70)} | ${a.artist.slice(0, 30)} | ${a.trackCount} | ${a.releaseDate?.slice(0, 10)}`),
      skipped: m.skipped.slice(0, 5).map((x) => `${x.platform}: ${x.name.slice(0, 60)} -> ${x.reason.slice(0, 80)}`) };
  } catch (e) { out.merged[label] = { error: e.message }; }
}
console.log('LIVE_RESULT_START'); console.log(JSON.stringify(out, null, 1)); console.log('LIVE_RESULT_END');
