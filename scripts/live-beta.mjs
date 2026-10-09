const UA = { 'User-Agent': 'MMDE-livecheck/0.1 (https://github.com/SaiTejaVoonna/MMDE)' };
const j = async (u) => (await fetch(u, { headers: UA })).json();
for (const q of ['bahubali', 'baahubali 2', 'pushpa', 'kingdom telugu', 'jawan', 'kalki', 'rrr']) {
  console.log(`\n=== ${q}`);
  const wd = await j('https://www.wikidata.org/w/api.php?' + new URLSearchParams({ action: 'wbsearchentities', search: q, language: 'en', type: 'item', limit: '20', format: 'json', origin: '*' }));
  console.log('wikidata:', (wd.search ?? []).map((x) => `${x.label} [${(x.description ?? '').slice(0, 40)}]`).slice(0, 8).join(' | '));
  const wp = await j('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', list: 'search', srsearch: q + ' film', srlimit: '8', format: 'json', formatversion: '2', origin: '*', srprop: 'snippet' }));
  console.log('wikipedia search:', (wp.query?.search ?? []).map((x) => x.title).join(' | '));
  const wp2 = await j('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'opensearch', search: q, limit: '8', format: 'json', origin: '*' }));
  console.log('wikipedia opensearch:', (wp2[1] ?? []).join(' | '));
  const titles = (wp.query?.search ?? []).slice(0, 8).map((x) => x.title).join('|');
  if (titles) { const pp = await j('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', prop: 'pageprops|description', ppprop: 'wikibase_item', titles, format: 'json', formatversion: '2', origin: '*' })); console.log('  qids/descriptions:', (pp.query?.pages ?? []).map((p) => `${p.title}=${p.pageprops?.wikibase_item ?? '-'}|${(p.description ?? '').slice(0, 40)}`).join(' ; ')); }
}
