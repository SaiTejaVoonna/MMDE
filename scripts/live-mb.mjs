// How good is keyless title search? Wikidata (+Wikipedia images), AniList and TVmaze on the titles Sai uses.
const UA = { 'User-Agent': 'MMDE-livecheck/0.1 (https://github.com/SaiTejaVoonna/MMDE)' };
const wd = async (p) => (await fetch('https://www.wikidata.org/w/api.php?' + new URLSearchParams({ format: 'json', origin: '*', ...p }), { headers: UA })).json();
const FILMY = /film|movie|television series|tv series|anime|web series|animated/i;
for (const q of ['Bahubali', 'RRR', 'Fire Force', 'Kingdom', 'Star Wars', 'Jujutsu Kaisen', 'Pushpa']) {
  console.log(`\n=== ${q}`);
  const s = await wd({ action: 'wbsearchentities', search: q, language: 'en', type: 'item', limit: '12' });
  const hits = (s.search ?? []).filter((x) => FILMY.test(x.description ?? '')).slice(0, 5);
  if (!hits.length) { console.log('  wikidata: no film/series hits'); }
  else {
    const ents = (await wd({ action: 'wbgetentities', ids: hits.map((h) => h.id).join('|'), props: 'claims|sitelinks', sitefilter: 'enwiki' })).entities;
    for (const h of hits) {
      const e = ents[h.id]; const c = e.claims ?? {}; const has = (p) => (c[p] ? 'Y' : '-');
      console.log(`  wikidata ${h.id} | ${h.label} | ${h.description} | poster(P3383)=${has('P3383')} image(P18)=${has('P18')} TMDBfilm(P4947)=${has('P4947')} TMDBtv(P4983)=${has('P4983')} composer(P86)=${has('P86')} enwiki=${e.sitelinks?.enwiki ? 'Y' : '-'}`);
    }
    const top = hits.find((h) => ents[h.id].sitelinks?.enwiki);
    if (top) {
      const t = ents[top.id].sitelinks.enwiki.title;
      const w = await (await fetch('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', origin: '*', prop: 'pageimages|extracts', piprop: 'thumbnail', pithumbsize: '300', exintro: '1', explaintext: '1', exchars: '140', titles: t }), { headers: UA })).json();
      const pg = Object.values(w.query.pages)[0];
      console.log(`  wikipedia "${t}": thumbnail=${pg.thumbnail ? 'Y ' + pg.thumbnail.source.slice(0, 70) : 'NONE'} | extract="${(pg.extract ?? '').replace(/\s+/g, ' ').slice(0, 90)}"`);
    }
  }
}
for (const q of ['Fire Force', 'Jujutsu Kaisen']) {
  const r = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'content-type': 'application/json', ...UA }, body: JSON.stringify({ query: 'query($q:String){Page(perPage:3){media(search:$q,type:ANIME){id title{romaji native} startDate{year} format coverImage{large} relations{edges{relationType node{id title{romaji} seasonYear format}}}}}}', variables: { q } }) });
  const d = await r.json(); const m = d.data?.Page?.media?.[0];
  console.log(`\nAniList "${q}": ${m ? `${m.title.romaji} / ${m.title.native} (${m.startDate.year}) cover=${m.coverImage?.large ? 'Y' : 'N'} relations=${m.relations.edges.length}` : 'none ' + JSON.stringify(d).slice(0, 100)}`);
}
const tv = await (await fetch('https://api.tvmaze.com/search/shows?q=fire%20force', { headers: UA })).json();
console.log(`\nTVmaze "fire force": ${tv.slice(0, 3).map((x) => x.show.name + ' (' + (x.show.premiered ?? '').slice(0, 4) + ') img=' + (x.show.image ? 'Y' : 'N')).join(' | ') || 'none'}`);
