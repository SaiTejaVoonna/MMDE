import { wikiSoundtrack } from '../src/providers/wikiSoundtrack.ts';
import { catalogResolver } from '../src/providers/catalogAlbums.ts';
import { buildMergedSoundtrack } from '../src/app/soundtrackService.ts';
const ua = 'MMDE-live-check/0.5 (GitHub Actions; personal non-commercial prototype)';
const wiki = wikiSoundtrack(ua); const cat = catalogResolver(ua);
const src = { wiki: (t, y, a) => wiki.find(t, y, a), albums: (t, y, x, a) => cat.findAlbums(t, y, x, a), albumTracks: (p, id) => cat.tracks(p, id) };
const cases = [
  ['Kingdom (with composer)', 'Kingdom', 2025, { composers: ['Anirudh Ravichander'], alts: [] }],
  ['Kingdom (no composer known)', 'Kingdom', 2025, { composers: [], alts: [] }],
  ['Slime (alt titles, no composer)', 'That Time I Got Reincarnated as a Slime', 2018, { composers: [], alts: ['Tensei shitara Slime Datta Ken', '転生したらスライムだった件'] }],
];
const out = {};
for (const [label, title, year, ctx] of cases) {
  const t0 = Date.now();
  try {
    const m = await buildMergedSoundtrack(src, title, year, ctx);
    out[label] = { seconds: Math.round((Date.now() - t0) / 1000), partial: m.partial, counts: m.counts, wikipedia: m.wikipedia?.title ?? null,
      albums: m.albums.map((a) => `${a.platform}: ${a.name} | ${a.artist} | ${a.trackCount}`),
      skipped: m.skipped.map((x) => `${x.platform}: ${x.name} -> ${x.reason}`),
      sections: m.sections.slice(0, 8).map((s) => `${s.origin} | ${s.name.slice(0, 60)} | ${s.tracks.length} | green ${s.tracks.filter((x) => x.confidence === 'green').length}`),
      firstTracks: m.sections.flatMap((s) => s.tracks).slice(0, 4).map((t) => `${t.title} [${t.confidence}] ${t.artists.join(', ')}`) };
  } catch (e) { out[label] = { error: e.message }; }
}
console.log('LIVE_RESULT_START'); console.log(JSON.stringify(out, null, 1)); console.log('LIVE_RESULT_END');
