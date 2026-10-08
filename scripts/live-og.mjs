const ua = 'MMDE-live-check/0.3 (GitHub Actions; personal non-commercial prototype)';
const get = async (u) => { const r = await fetch(u, { headers: { 'User-Agent': ua, Accept: 'application/json' } }); return r.ok ? r.json() : { error: r.status }; };
const out = {};
for (const term of ['Baahubali (Original Soundtrack)', 'Baahubali Original Soundtrack Volume 1', 'Baahubali background score', 'Baahubali 2 The Conclusion']) {
  const a = await get('https://itunes.apple.com/search?' + new URLSearchParams({ term, entity: 'album', limit: '25' }));
  const d = await get('https://api.deezer.com/search/album?' + new URLSearchParams({ q: term, limit: '25' }));
  out[term] = {
    apple: (a.results ?? [a]).map((r) => `${r.collectionId}|${r.collectionName}|${r.trackCount}|${r.artistName}`).slice(0, 25),
    deezer: (d.data ?? [d]).map((r) => `${r.id}|${r.title}|${r.nb_tracks}|${r.artist?.name}`).slice(0, 25),
  };
  await new Promise((r) => setTimeout(r, 3000));
}
console.log('LIVE_RESULT_START'); console.log(JSON.stringify(out, null, 1)); console.log('LIVE_RESULT_END');
