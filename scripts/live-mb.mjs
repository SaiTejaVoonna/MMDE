// Throwaway live check (run from GitHub Actions, where the real services are reachable). No secrets used.
import { buildMergedSoundtrack } from '../src/app/soundtrackService.ts';
import { wikiSoundtrack } from '../src/providers/wikiSoundtrack.ts';
import { catalogResolver } from '../src/providers/catalogAlbums.ts';
import { animeThemesSource } from '../src/providers/animeThemesSearch.ts';
import { mbReleaseSource } from '../src/providers/mbReleases.ts';
const ua = 'MMDE-livecheck/0.1 (personal, non-commercial; https://github.com/SaiTejaVoonna/MMDE)';
const c = catalogResolver(ua); const mb = mbReleaseSource(ua); const at = animeThemesSource(ua);
const src = { wiki: (t, y, a) => wikiSoundtrack(ua).find(t, y, a), albums: c.findAlbums, albumTracks: c.tracks, animeThemes: at.find, musicBrainz: mb.find };
const cases = [
  { title: 'Bāhubali 2: The Conclusion', year: 2017, composers: ['M. M. Keeravani'], alts: ['Baahubali 2: The Conclusion', 'బాహుబలి 2'] },
  { title: 'Fire Force', year: 2019, composers: ['Kenichiro Suehiro'], alts: ['炎炎ノ消防隊', 'Enen no Shouboutai'], anime: true },
  { title: 'RRR', year: 2022, composers: ['M. M. Keeravani'], alts: ['RRR: Rise Roar Revolt'] },
];
for (const k of cases) {
  console.log(`\n=== ${k.title} ===`);
  try {
    const rels = await mb.find(k.title, k.alts, k.composers);
    console.log('MusicBrainz releases:', rels.map((r) => `${r.title} [${r.language ?? '?'}] label=${r.label ?? '-'} date=${r.date ?? '-'} upc=${r.barcode ?? '-'} tracks=${r.tracks.length} isrc=${r.tracks.filter((t) => t.isrcs.length).length}`));
    const m = await buildMergedSoundtrack(src, k.title, k.year, { composers: k.composers, alts: k.alts, anime: k.anime });
    console.log('counts', JSON.stringify(m.counts), 'verified', m.verified, 'partial', m.partial, 'languages', JSON.stringify(m.languages));
    console.log('sections:', m.sections.map((s) => `${s.name}${s.language ? ' [' + s.language + ']' : ''} (${s.tracks.length})`));
    const withProof = m.sections.flatMap((s) => s.tracks).filter((t) => t.proof);
    console.log('songs with proof:', withProof.length, 'with ISRC:', withProof.filter((t) => t.proof.isrc).length, 'with versions:', m.sections.flatMap((s) => s.tracks).filter((t) => t.versions?.length).length);
    for (const t of withProof.slice(0, 3)) console.log('  sample:', t.title, JSON.stringify(t.proof), t.confidence);
    for (const t of m.sections.flatMap((s) => s.tracks).filter((t) => t.versions?.length).slice(0, 3)) console.log('  version:', t.title, '->', JSON.stringify(t.versions));
    console.log('skipped:', m.skipped.map((x) => x.name));
  } catch (e) { console.log('ERROR', e instanceof Error ? e.message : e); }
}
