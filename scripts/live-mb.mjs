import { catalogResolver } from '../src/providers/catalogAlbums.ts';
import { buildMergedSoundtrack } from '../src/app/soundtrackService.ts';
import { wikiSoundtrack } from '../src/providers/wikiSoundtrack.ts';
const ua = 'MMDE-livecheck/0.1 (personal, non-commercial; https://github.com/SaiTejaVoonna/MMDE)';
let lookups = 0; let searches = 0;
const counting = async (u, i) => { const s = String(u); if (s.includes('itunes.apple.com/lookup')) { lookups++; console.log('  apple lookup:', s.slice(0, 140)); } else if (s.includes('itunes.apple.com/search')) searches++; return fetch(u, i); };
const c = catalogResolver(ua, counting);
const src = { wiki: (t, y, a) => wikiSoundtrack(ua).find(t, y, a), albums: c.findAlbums, albumTracks: c.tracks };
for (const k of [{ title: 'Bāhubali 2: The Conclusion', year: 2017, composers: ['M. M. Keeravani'], alts: ['Baahubali 2: The Conclusion'] }, { title: 'Fire Force', year: 2019, composers: ['Kenichiro Suehiro'], alts: ['炎炎ノ消防隊'] }]) {
  lookups = 0; searches = 0;
  for (const stage of ['wiki', 'fast']) {
    const t0 = Date.now();
    const m = await buildMergedSoundtrack(src, k.title, k.year, { ...k, fast: stage === 'fast', wikiOnly: stage === 'wiki' });
    console.log(`${k.title} [${stage}] ${((Date.now() - t0) / 1000).toFixed(1)}s songs=${m.counts.total} green=${m.counts.green} albums=${m.albums.length} appleSearches=${searches} appleLookups=${lookups}`);
    console.log('  sections:', m.sections.map((s) => `${s.name.slice(0, 50)}(${s.tracks.length})`).join(' | ').slice(0, 400));
  }
}
