import { trackLinkResolver } from '../src/providers/trackLinks.ts';
const ua = 'MMDE-livecheck/0.1 (personal, non-commercial; https://github.com/SaiTejaVoonna/MMDE)';
const r = trackLinkResolver(ua);
const cases = [
  { title: 'Naatu Naatu', artists: ['Rahul Sipligunj', 'Kaala Bhairava'], film: 'RRR', lengthSec: 216, year: 2022 },
  { title: 'Naatu Naatu', artists: ['Rahul Sipligunj', 'Kaala Bhairava'], film: 'RRR' },
  { title: 'Dosti', artists: ['Vedala Hemachandra'], film: 'RRR', lengthSec: 322, year: 2022 },
];
for (const q of cases) {
  try { const out = await r.resolve(q); console.log(JSON.stringify({ q: { ...q, artists: undefined }, matchedOn: out.matchedOn, art: out.art, links: out.links.filter((l) => l.kind === 'resolved').map((l) => l.url) })); }
  catch (e) { console.log('ERROR', q.title, String(e)); }
}
