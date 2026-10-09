// Which public APIs allow a browser page on GitHub Pages to call them directly (CORS)? We send the Pages origin and print the answer headers.
const ORIGIN = 'https://saitejavoonna.github.io';
const tests = [
  ['TMDB (no token: 401 is expected, we only read headers)', 'https://api.themoviedb.org/3/search/movie?query=rrr'],
  ['Wikipedia', 'https://en.wikipedia.org/w/api.php?action=query&format=json&titles=RRR_(film)&origin=*'],
  ['Wikidata', 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=RRR&language=en&format=json&origin=*'],
  ['MusicBrainz', 'https://musicbrainz.org/ws/2/release?query=release:%22RRR%22&fmt=json&limit=1'],
  ['AnimeThemes', 'https://api.animethemes.moe/anime?q=fire%20force&page%5Bsize%5D=1'],
  ['AniList (GET)', 'https://graphql.anilist.co'],
  ['Jikan (MyAnimeList)', 'https://api.jikan.moe/v4/anime?q=fire%20force&limit=1'],
  ['TVmaze', 'https://api.tvmaze.com/search/shows?q=fire%20force'],
  ['Apple iTunes Search', 'https://itunes.apple.com/search?term=rrr&entity=album&limit=1'],
  ['Deezer', 'https://api.deezer.com/search/album?q=rrr&limit=1'],
  ['YouTube Data API (no key: 403 expected)', 'https://www.googleapis.com/youtube/v3/search?part=snippet&q=rrr'],
];
for (const [name, url] of tests) {
  try {
    const r = await fetch(url, { headers: { Origin: ORIGIN, 'User-Agent': 'MMDE-corscheck/0.1 (https://github.com/SaiTejaVoonna/MMDE)' } });
    const o = await fetch(url, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' } }).catch(() => null);
    console.log(`${name}: status ${r.status} | allow-origin=${r.headers.get('access-control-allow-origin') ?? 'NONE'} | preflight=${o ? o.status + ' ' + (o.headers.get('access-control-allow-origin') ?? 'NONE') : 'error'} | rate=${r.headers.get('x-ratelimit-limit') ?? r.headers.get('ratelimit-limit') ?? '-'}`);
  } catch (e) { console.log(`${name}: ERROR ${String(e).slice(0, 80)}`); }
}
