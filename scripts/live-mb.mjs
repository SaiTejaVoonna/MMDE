const ua = 'MMDE-livecheck/0.1 (personal, non-commercial; https://github.com/SaiTejaVoonna/MMDE)';
const get = async (params) => (await fetch('https://www.wikidata.org/w/api.php?' + new URLSearchParams({ format: 'json', origin: '*', ...params }), { headers: { 'User-Agent': ua } })).json();
for (const [name, year] of [['RRR', 2022], ['Fire Force', 2019], ['Baahubali 2: The Conclusion', 2017]]) {
  console.log('\n===', name);
  const s = await get({ action: 'wbsearchentities', search: name, language: 'en', type: 'item', limit: '6' });
  console.log((s.search ?? []).map((x) => `${x.id} ${x.label} | ${x.description}`));
  const hit = (s.search ?? []).find((x) => /film|series|anime/i.test(x.description ?? ''));
  if (!hit) { console.log('no film hit'); continue; }
  const e = (await get({ action: 'wbgetentities', ids: hit.id, props: 'claims|labels', languages: 'en' })).entities[hit.id];
  const props = Object.keys(e.claims ?? {});
  const labels = (await get({ action: 'wbgetentities', ids: props.slice(0, 50).join('|'), props: 'labels', languages: 'en' })).entities;
  console.log(hit.id, e.labels?.en?.value, 'properties:', props.map((p) => `${p}=${labels[p]?.labels?.en?.value}`).join('; '));
  for (const p of props) {
    const l = labels[p]?.labels?.en?.value ?? '';
    if (/soundtrack|score|album|composer|music|MusicBrainz|Discogs|iTunes|Apple|Spotify|Deezer|IMDb|ISRC/i.test(l)) console.log('  ', p, l, JSON.stringify(e.claims[p].slice(0, 3).map((c) => c.mainsnak?.datavalue?.value)).slice(0, 300));
  }
}
