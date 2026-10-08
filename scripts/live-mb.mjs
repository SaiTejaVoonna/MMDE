import { buildMergedSoundtrack } from '../src/app/soundtrackService.ts';
import { wikiSoundtrack } from '../src/providers/wikiSoundtrack.ts';
import { catalogResolver } from '../src/providers/catalogAlbums.ts';
import { animeThemesSource } from '../src/providers/animeThemesSearch.ts';
import { mbReleaseSource } from '../src/providers/mbReleases.ts';
import { wikidataTitleSource } from '../src/providers/wikidataTitles.ts';
import { trackLinkResolver } from '../src/providers/trackLinks.ts';
const ua = 'MMDE-livecheck/0.1 (personal, non-commercial; https://github.com/SaiTejaVoonna/MMDE)';
const c = catalogResolver(ua); const mb = mbReleaseSource(ua); const at = animeThemesSource(ua); const wd = wikidataTitleSource(ua);
const src = { wiki: (t, y, a) => wikiSoundtrack(ua).find(t, y, a), albums: c.findAlbums, albumTracks: c.tracks, animeThemes: at.find, musicBrainz: mb.find, wikidata: wd.find, wikidataComposers: wd.composers };
const cases = [
  { title: 'Kingdom', year: 2025, composers: [], alts: [] },
  { title: 'Bāhubali 2: The Conclusion', year: 2017, composers: [], alts: ['Baahubali 2: The Conclusion'] },
  { title: 'Fire Force', year: 2019, composers: ['Kenichiro Suehiro'], alts: ['炎炎ノ消防隊'], anime: true },
];
for (const k of cases) {
  console.log(`\n=== ${k.title} (TMDB composers: ${JSON.stringify(k.composers)})`);
  try {
    const m = await buildMergedSoundtrack(src, k.title, k.year, k);
    console.log('composers used:', JSON.stringify(m.composers), 'source:', m.composerSource, 'verified:', m.verified, 'counts', JSON.stringify(m.counts), 'skipped:', m.skipped.map((x) => x.name));
    console.log('sources:', m.sources.map((s) => `${s.key}:${s.state}`).join(' '));
    console.log('types:', JSON.stringify(m.sections.flatMap((s) => s.tracks).reduce((a, t) => ({ ...a, [t.type]: (a[t.type] ?? 0) + 1 }), {})));
  } catch (e) { console.log('ERROR', String(e)); }
}
console.log('\n=== track links without length/year (weak) vs with');
const r = trackLinkResolver(ua);
for (const q of [{ title: 'Naatu Naatu', artists: ['Rahul Sipligunj'], film: 'RRR' }, { title: 'Naatu Naatu', artists: ['Rahul Sipligunj'], film: 'RRR', lengthSec: 216, year: 2022 }]) {
  try { const out = await r.resolve(q); console.log(JSON.stringify({ hasLength: !!q.lengthSec, resolved: out.links.filter((l) => l.kind === 'resolved').map((l) => l.url), art: !!out.art })); } catch (e) { console.log('ERROR', String(e)); }
}
