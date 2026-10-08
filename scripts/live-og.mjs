import { wikiSoundtrack } from '../src/providers/wikiSoundtrack.ts';
import { catalogResolver } from '../src/providers/catalogAlbums.ts';
import { buildMergedSoundtrack } from '../src/app/soundtrackService.ts';
const ua = 'MMDE-live-check/0.2 (GitHub Actions; personal non-commercial prototype)';
const wiki = wikiSoundtrack(ua); const cat = catalogResolver(ua);
const src = { wiki: (t, y) => wiki.find(t, y), albums: (t, y, x) => cat.findAlbums(t, y, x), albumTracks: (p, id) => cat.tracks(p, id) };
const out = {};
for (const [title, year] of [['They Call Him OG', 2025], ['Bāhubali 2: The Conclusion', 2017]]) {
  const t0 = Date.now();
  try {
    const m = await buildMergedSoundtrack(src, title, year);
    out[title] = {
      seconds: Math.round((Date.now() - t0) / 1000), partial: m.partial, counts: m.counts, wikipedia: m.wikipedia?.title ?? null,
      albums: m.albums.map((a) => `${a.platform}: ${a.name} (${a.trackCount})`),
      sections: m.sections.map((s) => `${s.origin} | ${s.name.slice(0, 70)} | ${s.tracks.length} | green ${s.tracks.filter((x) => x.confidence === 'green').length}`),
      viaWiki: m.albums.filter((a) => a.viaWiki).length,
      sample: m.sections.flatMap((s) => s.tracks).filter((x) => /Gambheera|Firestorm|Saahore|Dandalayya/i.test(x.title)).slice(0, 4).map((x) => ({ title: x.title, conf: x.confidence, ev: x.evidence.map((e) => e.source), links: x.links })),
    };
  } catch (e) { out[title] = { error: e.message }; }
}
console.log('LIVE_RESULT_START'); console.log(JSON.stringify(out, null, 1)); console.log('LIVE_RESULT_END');
