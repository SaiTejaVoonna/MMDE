import { catalogResolver, isFilmAlbum, looseFold } from './catalogAlbums.ts';
import { uaHeaders } from './http.ts';

// Artwork fallback chain for titles that TMDB cannot (or may not) illustrate. Tried in order, first accepted picture wins:
//   1. AniList cover (anime only)      2. TVmaze (TV series; no key)      3. Wikipedia lead image (series, some films)
//   4. the soundtrack ALBUM cover from Apple Music, labelled as an album cover, never as a poster.
// Every candidate must pass a name check (and a year check when we know the year): a title-only guess is how wrong pictures happen.

export interface Artwork { url: string; source: 'anilist' | 'tvmaze' | 'wikipedia' | 'apple-album'; kind: 'poster' | 'album'; /** The name of the item the picture belongs to, for display and debugging. */ matched: string }
export interface ArtworkQuery { title: string; year?: number; type?: 'movie' | 'tv'; anime?: boolean; alts?: string[] }

const yearOk = (want: number | undefined, got: number | undefined) => want === undefined || got === undefined || Math.abs(want - got) <= 1;
/** Same title, ignoring accents, punctuation, case and doubled letters; a trailing "(2022 film)" style qualifier is allowed. */
export const sameTitle = (a: string, b: string) => {
  const strip = (x: string) => x.replace(/\s*\((?:\d{4}\s+)?(?:[\w ]+\s)?(?:film|movie|tv series|television series|anime|series)\)\s*$/i, '');
  const letters = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const x = strip(a); const y = strip(b);
  // looseFold collapses doubled letters ("Bāhubali" ~ "Baahubali"), so the length guard looks at the real letters ("RRR" stays 3).
  return letters(x).length >= 2 && letters(y).length >= 2 && looseFold(x) === looseFold(y);
};

export function artworkFinder(userAgent: string, fetchImpl: typeof fetch = fetch) {
  const json = async (url: string): Promise<any | null> => {
    const res = await fetchImpl(url, { headers: uaHeaders(userAgent, { Accept: 'application/json' }) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  const names = (q: ArtworkQuery) => [q.title, ...(q.alts ?? []).slice(0, 3)];

  async function anilist(q: ArtworkQuery): Promise<Artwork | null> {
    if (!q.anime) return null;
    const res = await fetchImpl('https://graphql.anilist.co', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: 'query($q:String){Page(perPage:6){media(search:$q,type:ANIME,sort:SEARCH_MATCH){id title{romaji english native} synonyms startDate{year} seasonYear coverImage{large}}}}', variables: { q: q.title } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const media = (((await res.json()) as any)?.data?.Page?.media ?? []) as any[];
    const hit = media.find((m) => /^https:\/\//.test(String(m.coverImage?.large ?? '')) && yearOk(q.year, m.startDate?.year ?? m.seasonYear) && [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms ?? [])].filter(Boolean).some((n: string) => names(q).some((w) => sameTitle(n, w))));
    return hit ? { url: String(hit.coverImage.large), source: 'anilist', kind: 'poster', matched: String(hit.title?.english || hit.title?.romaji || hit.id) } : null;
  }

  async function tvmaze(q: ArtworkQuery): Promise<Artwork | null> {
    if (q.type === 'movie') return null;
    const list = await json(`https://api.tvmaze.com/search/shows?${new URLSearchParams({ q: q.title })}`);
    for (const row of (Array.isArray(list) ? list : []).slice(0, 6)) {
      const s = row?.show; const img = s?.image?.original ?? s?.image?.medium;
      const premiered = typeof s?.premiered === 'string' ? Number(s.premiered.slice(0, 4)) : undefined;
      if (img && /^https:\/\//.test(img) && names(q).some((w) => sameTitle(String(s.name ?? ''), w)) && yearOk(q.year, premiered)) {
        return { url: String(img), source: 'tvmaze', kind: 'poster', matched: String(s.name) };
      }
    }
    return null;
  }

  async function wikipedia(q: ArtworkQuery): Promise<Artwork | null> {
    const kind = q.type === 'tv' || q.anime ? 'TV series' : 'film';
    const d = await json(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: `${q.title} ${q.year ?? ''} ${kind}`.replace(/\s+/g, ' ').trim(), gsrlimit: '5', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '500', format: 'json', formatversion: '2', origin: '*' })}`);
    const pages = ((d?.query?.pages ?? []) as any[]).sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
    const hit = pages.find((p) => p.thumbnail?.source && /^https:\/\//.test(p.thumbnail.source) && names(q).some((w) => sameTitle(String(p.title ?? ''), w)));
    return hit ? { url: String(hit.thumbnail.source), source: 'wikipedia', kind: 'poster', matched: String(hit.title) } : null;
  }

  async function appleAlbum(q: ArtworkQuery): Promise<Artwork | null> {
    const albums = await catalogResolver(userAgent, fetchImpl, { deezer: false }).findAlbums(q.title, q.year, [], q.alts ?? []);
    const hit = albums.find((a) => a.platform === 'apple' && a.art && isFilmAlbum(q.title, a.name, q.alts ?? []));
    // Apple serves any size: ask for a sharper one than the 300 px the catalog list uses.
    return hit ? { url: hit.art!.replace(/\/\d+x\d+(bb)?\.(jpg|webp|png)$/i, '/600x600bb.$2'), source: 'apple-album', kind: 'album', matched: hit.name } : null;
  }

  return {
    /** Never throws: a failing source is skipped. Returns null when nothing passes the checks. */
    async find(q: ArtworkQuery): Promise<Artwork | null> {
      for (const step of [anilist, tvmaze, wikipedia, appleAlbum]) {
        try { const hit = await step(q); if (hit) return hit; } catch { /* try the next source */ }
      }
      return null;
    },
  };
}
