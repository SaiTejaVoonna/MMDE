import type { Media } from '../domain/types.ts';
import { rankByQuery, type TmdbDetails } from './tmdb.ts';
import { createRateLimiter } from './types.ts';

// Title search and title details with NO API key: AniList (anime, GraphQL) and Wikidata + Wikipedia (everything else). Every request here is a plain
// GET/POST that these services allow from a web page (checked live), so the whole thing can run inside the visitor's browser.
// Known gaps compared with TMDB: no movie posters (film posters on Wikipedia are non-free images), weaker popularity ranking, no franchise lists.

const WD = 'https://www.wikidata.org/w/api.php';
const WP = 'https://en.wikipedia.org/w/api.php';
const ANILIST = 'https://graphql.anilist.co';
const FILMY = /\b(film|movie|television series|tv series|anime|web series|animated series|miniseries)\b/i;
const SERIESY = /\b(television series|tv series|anime television|anime series|web series|animated series|miniseries)\b/i;
const NOT_A_TITLE = /\b(season of|first season|second season|third season|fourth season|film series|franchise|video game|manga|novel|character|episode)\b/i;
const LANG_CODE: Record<string, string> = { telugu: 'te', hindi: 'hi', tamil: 'ta', malayalam: 'ml', kannada: 'kn', bengali: 'bn', marathi: 'mr', punjabi: 'pa', japanese: 'ja', korean: 'ko', chinese: 'zh', mandarin: 'zh', cantonese: 'zh', english: 'en', french: 'fr', spanish: 'es', german: 'de', thai: 'th' };

const stripHtml = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
const yearOf = (text?: string) => { const m = /\b(18|19|20)\d{2}\b/.exec(text ?? ''); return m ? Number(m[0]) : undefined; };
const wdYear = (claims: any, prop: string): number | undefined => { const t = claims?.[prop]?.[0]?.mainsnak?.datavalue?.value?.time; const m = typeof t === 'string' ? /^[+-]?(\d{4})/.exec(t) : null; return m ? Number(m[1]) : undefined; };

interface AniNode { id: number; format?: string; episodes?: number; title?: { romaji?: string; english?: string; native?: string }; synonyms?: string[]; startDate?: { year?: number; month?: number; day?: number }; seasonYear?: number; coverImage?: { large?: string; extraLarge?: string }; bannerImage?: string; description?: string; genres?: string[]; averageScore?: number; popularity?: number; relations?: { edges?: Array<{ relationType: string; node: AniNode & { type?: string } }> } }
const aniTitle = (n: AniNode) => n.title?.english || n.title?.romaji || n.title?.native || String(n.id);

export function keylessTitles(fetchImpl: typeof fetch = fetch) {
  const aniWait = createRateLimiter(700);
  const wdWait = createRateLimiter(150);
  const ani = async (query: string, variables: Record<string, unknown>): Promise<any> => {
    await aniWait();
    const res = await fetchImpl(ANILIST, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from AniList`);
    const d = (await res.json()) as any;
    if (d.errors?.length) throw new Error(String(d.errors[0]?.message ?? 'AniList error'));
    return d.data;
  };
  const wd = async (params: Record<string, string>): Promise<any> => {
    await wdWait();
    const res = await fetchImpl(`${WD}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Wikidata`);
    return res.json();
  };
  const wp = async (params: Record<string, string>): Promise<any> => {
    const res = await fetchImpl(`${WP}?${new URLSearchParams({ format: 'json', origin: '*', formatversion: '2', ...params })}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Wikipedia`);
    return res.json();
  };

  const aniToMedia = (n: AniNode): Media => ({
    id: `al-${n.id}`, type: n.format === 'MOVIE' ? 'movie' : 'tv', title: aniTitle(n),
    altTitles: [...new Set([n.title?.native, n.title?.romaji, n.title?.english, ...(n.synonyms ?? []).slice(0, 2)].filter((x): x is string => !!x && x !== aniTitle(n)))],
    year: n.startDate?.year ?? n.seasonYear, externalIds: { anilist: String(n.id) },
    ...(n.coverImage?.large ? { posterPath: n.coverImage.large } : {}),
    ...(n.description ? { overview: stripHtml(n.description).slice(0, 220) } : {}),
    ...(typeof n.popularity === 'number' ? { popularity: n.popularity } : {}),
    originalLanguage: 'ja', animation: true,
  });
  const SEARCH_Q = 'query($q:String){Page(perPage:10){media(search:$q,type:ANIME,sort:SEARCH_MATCH){id format title{romaji english native} synonyms startDate{year} seasonYear coverImage{large} description popularity relations{edges{relationType}}}}}';
  const TRENDING_Q = 'query{Page(perPage:20){media(type:ANIME,sort:TRENDING_DESC,format_in:[TV,MOVIE]){id format title{romaji english native} synonyms startDate{year} seasonYear coverImage{large} description popularity relations{edges{relationType}}}}}';
  const isRoot = (n: AniNode) => n.format === 'MOVIE' || !(n.relations?.edges ?? []).some((e) => e.relationType === 'PREQUEL');

  async function searchAnime(query: string): Promise<Media[]> {
    const d = await ani(SEARCH_Q, { q: query });
    return ((d?.Page?.media ?? []) as AniNode[]).filter((n) => (n.format === 'TV' || n.format === 'MOVIE' || n.format === 'ONA') && isRoot(n)).slice(0, 6).map(aniToMedia);
  }

  async function searchWikidata(query: string): Promise<Media[]> {
    const s = await wd({ action: 'wbsearchentities', search: query, language: 'en', type: 'item', limit: '20' });
    const hits = ((s.search ?? []) as any[]).filter((x) => FILMY.test(String(x.description ?? '')) && !NOT_A_TITLE.test(String(x.description ?? ''))).slice(0, 8);
    return hits.map((h): Media => ({
      id: `wd-${h.id}`, type: SERIESY.test(String(h.description)) ? 'tv' : 'movie', title: String(h.label ?? h.id), altTitles: [],
      year: yearOf(String(h.description)), externalIds: { wikidata: String(h.id) }, overview: String(h.description ?? '').slice(0, 220),
    }));
  }

  /** Wikipedia full-text search finds films Wikidata's label search misses ("Baahubali 2: The Conclusion", "Kingdom (2025 film)"). */
  async function searchWikipedia(query: string): Promise<Media[]> {
    const d = await wp({ action: 'query', generator: 'search', gsrsearch: `${query} film`, gsrlimit: '15', prop: 'pageprops|description', ppprop: 'wikibase_item' });
    const pages = ((d?.query?.pages ?? []) as any[]).sort((x, y) => Number(x.index ?? 0) - Number(y.index ?? 0));
    return pages
      .filter((p) => p.pageprops?.wikibase_item && FILMY.test(String(p.description ?? '')) && !NOT_A_TITLE.test(String(p.description ?? '')) && !/soundtrack|album|documentary/i.test(String(p.description ?? '')))
      .slice(0, 8)
      .map((p): Media => ({
        id: `wd-${p.pageprops.wikibase_item}`, type: SERIESY.test(String(p.description)) ? 'tv' : 'movie', title: String(p.title).replace(/\s*\((\d{4} )?(Indian |Telugu |Tamil |Hindi )?(film|TV series|television series)\)$/i, ''), altTitles: [],
        year: yearOf(String(p.description)), externalIds: { wikidata: String(p.pageprops.wikibase_item) }, overview: String(p.description ?? '').slice(0, 220),
      }));
  }

  const norm = (x: string) => x.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  return {
    /** Anime from AniList (with covers), everything else from Wikidata. Same title in both: the AniList entry wins (it has a cover and seasons). */
    async search(query: string): Promise<{ results: Media[]; errors: string[] }> {
      const errors: string[] = [];
      const [a, w, p] = await Promise.allSettled([searchAnime(query), searchWikidata(query), searchWikipedia(query)]);
      const anime = a.status === 'fulfilled' ? a.value : (errors.push(`anilist: ${(a.reason as Error)?.message ?? 'failed'}`), [] as Media[]);
      const fromWd = w.status === 'fulfilled' ? w.value : (errors.push(`wikidata: ${(w.reason as Error)?.message ?? 'failed'}`), [] as Media[]);
      const fromWp = p.status === 'fulfilled' ? p.value : (errors.push(`wikipedia: ${(p.reason as Error)?.message ?? 'failed'}`), [] as Media[]);
      const wdSeen = new Set<string>();
      const wiki = [...fromWp, ...fromWd].filter((m) => { const q = m.externalIds?.wikidata ?? m.id; if (wdSeen.has(q)) return false; wdSeen.add(q); return true; });
      const seen = new Set(anime.flatMap((m) => [m.title, ...m.altTitles].map(norm)));
      const merged = [...anime, ...wiki.filter((m) => !seen.has(norm(m.title)))];
      // An AniList title that matches the typed name exactly (in any language) puts anime first; otherwise movies are not pushed down.
      const typed = norm(query);
      const animeFirst = anime.some((m) => [m.title, ...m.altTitles].some((x) => norm(x) === typed));
      return { results: rankByQuery(merged, query, { anime: animeFirst }), errors };
    },

    async trending(kind: 'all' | 'anime'): Promise<Media[]> {
      if (kind !== 'anime') return []; // keyless sources have no "trending movies"
      const d = await ani(TRENDING_Q, {});
      return ((d?.Page?.media ?? []) as AniNode[]).filter(isRoot).slice(0, 14).map(aniToMedia);
    },

    /** Details for `al-<id>` (AniList) or `wd-Q<id>` (Wikidata). Composer and other-language titles come from Wikidata when it knows the title. */
    async details(id: string, extra: { composersFor?: (title: string, year?: number, alts?: string[]) => Promise<string[]>; titlesFor?: (title: string, year?: number, alts?: string[]) => Promise<string[]> } = {}): Promise<TmdbDetails> {
      const al = /^al-(\d+)$/.exec(id);
      if (al) return anilistDetails(Number(al[1]), extra);
      const w = /^wd-(Q\d+)$/.exec(id);
      if (w) return wikidataDetails(w[1]!, extra);
      throw new Error('unknown id');
    },
  };

  async function anilistDetails(startId: number, extra: { composersFor?: (t: string, y?: number, a?: string[]) => Promise<string[]>; titlesFor?: (t: string, y?: number, a?: string[]) => Promise<string[]> }): Promise<TmdbDetails> {
    const NODE_Q = 'query($id:Int){Media(id:$id,type:ANIME){id format episodes title{romaji english native} synonyms startDate{year month day} seasonYear description genres averageScore coverImage{extraLarge large} bannerImage relations{edges{relationType node{id format type title{romaji english} episodes startDate{year month day} seasonYear coverImage{large}}}}}}';
    const get = async (id: number): Promise<AniNode> => (await ani(NODE_Q, { id })).Media as AniNode;
    const link = (n: AniNode, type: 'PREQUEL' | 'SEQUEL') => n.relations?.edges?.find((e) => e.relationType === type && e.node.type === 'ANIME' && e.node.format === 'TV')?.node;
    // Each season of an anime is its own AniList entry; PREQUEL/SEQUEL links chain them. Walk back to season 1, then forward.
    let first = await get(startId);
    const chain: AniNode[] = [];
    const seen = new Set<number>([first.id]);
    for (let i = 0; i < 8; i++) { const p = link(first, 'PREQUEL'); if (!p || seen.has(p.id)) break; seen.add(p.id); first = await get(p.id); }
    chain.push(first);
    let cur = first;
    for (let i = 0; i < 8; i++) { const nx = link(cur, 'SEQUEL'); if (!nx || chain.some((c) => c.id === nx.id)) break; cur = await get(nx.id); chain.push(cur); }
    const year = first.startDate?.year ?? first.seasonYear;
    const title = aniTitle(first);
    const alts = [...new Set([first.title?.native, first.title?.romaji, first.title?.english, ...(first.synonyms ?? [])].filter((x): x is string => !!x && x !== title))].slice(0, 8);
    const [composers, moreTitles] = await Promise.all([extra.composersFor?.(title, year, alts).catch(() => [] as string[]) ?? [], extra.titlesFor?.(title, year, alts).catch(() => [] as string[]) ?? []]);
    const isMovie = first.format === 'MOVIE';
    return {
      id: `al-${startId}`, kind: isMovie ? 'movie' : 'tv', title, overview: first.description ? stripHtml(first.description) : undefined, year,
      ...(first.coverImage?.extraLarge || first.coverImage?.large ? { posterPath: first.coverImage?.extraLarge ?? first.coverImage?.large } : {}),
      ...(first.bannerImage ? { backdropPath: first.bannerImage } : {}),
      genres: [...new Set(['Animation', ...(first.genres ?? [])])], originalLanguage: 'ja', spokenLanguages: ['Japanese'],
      ...(first.averageScore ? { voteAverage: Math.round(first.averageScore) / 10 } : {}),
      composers: composers ?? [], altTitles: [...new Set([...alts, ...(moreTitles ?? [])])].slice(0, 8),
      ...(isMovie ? { runtimeMin: undefined } : {
        seasons: chain.map((n, i) => ({ seasonNumber: i + 1, name: `Season ${i + 1}`, episodeCount: n.episodes ?? 0, airDate: n.startDate?.year ? `${n.startDate.year}-${String(n.startDate.month ?? 1).padStart(2, '0')}-${String(n.startDate.day ?? 1).padStart(2, '0')}` : undefined, ...(n.coverImage?.large ? { posterPath: n.coverImage.large } : {}), overview: aniTitle(n) })) as TmdbDetails['seasons'],
      }),
    };
  }

  async function wikidataDetails(qid: string, extra: { composersFor?: (t: string, y?: number, a?: string[]) => Promise<string[]>; titlesFor?: (t: string, y?: number, a?: string[]) => Promise<string[]> }): Promise<TmdbDetails> {
    const ent = (await wd({ action: 'wbgetentities', ids: qid, props: 'labels|descriptions|claims|sitelinks', sitefilter: 'enwiki', languages: 'en' })).entities?.[qid];
    if (!ent) throw new Error('title not found on Wikidata');
    const claims = ent.claims ?? {};
    const title = String(ent.labels?.en?.value ?? qid);
    const description = String(ent.descriptions?.en?.value ?? '');
    const year = wdYear(claims, 'P577') ?? yearOf(description);
    const ids = (p: string, max: number) => ((claims[p] ?? []) as any[]).map((c) => c?.mainsnak?.datavalue?.value?.id).filter((x): x is string => typeof x === 'string').slice(0, max);
    const labelIds = [...ids('P86', 3), ...ids('P136', 4), ...ids('P364', 1)];
    const labels: Record<string, string> = {};
    if (labelIds.length) { const l = (await wd({ action: 'wbgetentities', ids: labelIds.join('|'), props: 'labels', languages: 'en' })).entities ?? {}; for (const k of Object.keys(l)) labels[k] = String(l[k]?.labels?.en?.value ?? ''); }
    const wikiTitle = ent.sitelinks?.enwiki?.title as string | undefined;
    let overview: string | undefined; let posterPath: string | undefined;
    if (wikiTitle) {
      try {
        const p = (await wp({ action: 'query', prop: 'extracts|pageimages', exintro: '1', explaintext: '1', exchars: '700', piprop: 'thumbnail', pithumbsize: '400', titles: wikiTitle })).query?.pages?.[0];
        overview = p?.extract ? String(p.extract).replace(/\s+/g, ' ').trim() : undefined;
        posterPath = p?.thumbnail?.source ? String(p.thumbnail.source) : undefined;
      } catch { /* the page works without the extract */ }
    }
    const composers = ids('P86', 3).map((q) => labels[q]).filter(Boolean);
    const alts0: string[] = [];
    const [wdComposers, moreTitles] = await Promise.all([composers.length ? [] : extra.composersFor?.(title, year, alts0).catch(() => [] as string[]) ?? [], extra.titlesFor?.(title, year, alts0).catch(() => [] as string[]) ?? []]);
    const langName = labels[ids('P364', 1)[0] ?? ''] ?? '';
    const isTv = SERIESY.test(description);
    const runtime = Number(claims.P2047?.[0]?.mainsnak?.datavalue?.value?.amount);
    let seasons: TmdbDetails['seasons'];
    if (isTv) seasons = await wikidataSeasons(ids('P527', 20));
    return {
      id: `wd-${qid}`, kind: isTv ? 'tv' : 'movie', title, overview: overview ?? (description || undefined), year,
      ...(posterPath ? { posterPath } : {}),
      ...(Number.isFinite(runtime) && runtime > 0 && !isTv ? { runtimeMin: Math.round(runtime) } : {}),
      genres: ids('P136', 4).map((q) => labels[q]).filter(Boolean) as string[],
      originalLanguage: LANG_CODE[langName.toLowerCase().replace(/ language$/, '')], spokenLanguages: langName ? [langName.replace(/ language$/i, '')] : [],
      composers: composers.length ? composers : (wdComposers ?? []), altTitles: [...new Set(moreTitles ?? [])].slice(0, 8),
      ...(seasons && seasons.length ? { seasons } : {}),
    };
  }

  async function wikidataSeasons(partIds: string[]): Promise<NonNullable<TmdbDetails['seasons']>> {
    if (!partIds.length) return [];
    const ents = (await wd({ action: 'wbgetentities', ids: partIds.join('|'), props: 'labels|descriptions|claims', languages: 'en' })).entities ?? {};
    const rows = partIds.map((q) => ents[q]).filter(Boolean).filter((e: any) => /season/i.test(String(e.labels?.en?.value ?? '') + ' ' + String(e.descriptions?.en?.value ?? '')))
      .map((e: any) => ({ label: String(e.labels?.en?.value ?? ''), date: wdYear(e.claims, 'P580') ?? wdYear(e.claims, 'P577'), episodes: Number(e.claims?.P1113?.[0]?.mainsnak?.datavalue?.value?.amount) || 0 }));
    rows.sort((a, b) => (a.date ?? 9999) - (b.date ?? 9999) || a.label.localeCompare(b.label, undefined, { numeric: true }));
    return rows.map((r, i) => ({ seasonNumber: i + 1, name: `Season ${i + 1}`, episodeCount: r.episodes, ...(r.date ? { airDate: `${r.date}-01-01` } : {}), overview: r.label })) as NonNullable<TmdbDetails['seasons']>;
  }
}
