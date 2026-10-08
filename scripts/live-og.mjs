import { wikiSoundtrack } from '../src/providers/wikiSoundtrack.ts';
import { trackLinkResolver } from '../src/providers/trackLinks.ts';
const ua = 'MMDE-live-check/0.1 (GitHub Actions; personal non-commercial prototype)';
const out = { wiki: null, links: [], errors: [] };
try {
  const st = await wikiSoundtrack(ua).find('They Call Him OG', 2025);
  out.wiki = st && { page: st.page, kind: st.pageKind, sections: st.sections.map((s) => ({ name: s.name, count: s.tracks.length, first: s.tracks[0], last: s.tracks[s.tracks.length - 1] })) };
  const gambheera = st?.sections.flatMap((s) => s.tracks.map((t) => ({ section: s.name, ...t }))).find((t) => /Return of Gambheera/i.test(t.title));
  out.gambheera = gambheera ?? null;
} catch (e) { out.errors.push('wiki: ' + e.message); }
const r = trackLinkResolver(ua);
for (const q of [
  { title: 'Firestorm', artists: ['Thaman S'], film: 'They Call Him OG' },
  { title: 'Suvvi Suvvi', artists: ['Sruthi Ranjani'], film: 'They Call Him OG' },
  { title: 'The Return of Gambheera', artists: [], film: 'They Call Him OG' },
]) {
  try { const x = await r.resolve(q); out.links.push({ q: q.title, matchedOn: x.matchedOn, art: x.art, kinds: Object.fromEntries(x.links.map((l) => [l.platform, l.kind + ' ' + l.url.slice(0, 90)])) }); }
  catch (e) { out.errors.push(q.title + ': ' + e.message); }
}
console.log('LIVE_RESULT_START'); console.log(JSON.stringify(out, null, 1)); console.log('LIVE_RESULT_END');
