import { baseKey, norm } from '../text.js';
import { fetchRetry } from '../http.js';

// AniList GraphQL: keyless, CORS-enabled. Best source for anime (alt titles like "Tensura") and seasons.
// Terms (docs.anilist.co): free non-commercial use; do not use as a data store/backup; keep usage light.
const URL_ = 'https://graphql.anilist.co';

async function gql(fetchImpl, query, variables) {
  const res = await fetchRetry(fetchImpl, URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  }, { sleep: gql.sleep });
  if (!res.ok) throw new Error(`HTTP ${res.status} from AniList`);
  const j = await res.json();
  if (j.errors?.length) throw new Error(`AniList: ${j.errors[0].message}`);
  return j.data;
}

const SEARCH = `query($q:String){Page(perPage:15){media(search:$q,type:ANIME,sort:SEARCH_MATCH){
  id idMal title{romaji english native} synonyms format episodes status seasonYear startDate{year} popularity
  coverImage{medium} description(asHtml:false) countryOfOrigin}}}`;

gql.sleep = undefined; // tests can replace this to skip real waiting
export const setSleep = (fn) => { gql.sleep = fn; };

const stripHtml = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const title = (t) => t?.english || t?.romaji || t?.native || '';

export function mapAniListMedia(m) {
  const t = title(m.title);
  return {
    id: `anilist:${m.id}`,
    anilistId: m.id,
    malId: m.idMal ?? undefined,
    kind: 'anime',
    title: t,
    altTitles: [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms ?? [])].filter((x) => x && x !== t),
    year: m.seasonYear ?? m.startDate?.year ?? undefined,
    format: m.format ?? undefined,
    popularity: m.popularity ?? 0,
    episodes: m.episodes ?? undefined,
    poster: m.coverImage?.medium ?? undefined,
    description: stripHtml(m.description).slice(0, 240),
    country: m.countryOfOrigin ?? undefined,
    sources: { anilist: `https://anilist.co/anime/${m.id}` },
  };
}

/** AniList lists every season/cour as its own entry; collapse them so a search shows one card per franchise. */
export function collapseSeasons(items) {
  const groups = new Map();
  for (const it of items) {
    const key = baseKey(it.title) || it.id;
    const cur = groups.get(key);
    if (!cur || (it.year ?? 9999) < (cur.year ?? 9999)) groups.set(key, { ...it, collapsed: (cur?.collapsed ?? 0) + 1 });
    else cur.collapsed = (cur.collapsed ?? 0) + 1;
  }
  return [...groups.values()];
}

export async function searchAniList(text, fetchImpl) {
  const data = await gql(fetchImpl, SEARCH, { q: text });
  return collapseSeasons((data.Page?.media ?? []).map(mapAniListMedia));
}

const FRANCHISE = `query($ids:[Int]){Page(perPage:50){media(id_in:$ids){
  id title{romaji english native} format episodes status startDate{year month day} coverImage{medium}
  relations{edges{relationType(version:2) node{id type title{romaji english native} format episodes status startDate{year month day} coverImage{medium}}}}}}}`;

const dateKey = (d) => (d?.year ?? 9999) * 10000 + (d?.month ?? 0) * 100 + (d?.day ?? 0);
const view = (n, rel) => ({ rel, id: n.id, title: title(n.title), native: n.title?.native, year: n.startDate?.year, episodes: n.episodes ?? undefined, format: n.format, status: n.status, poster: n.coverImage?.medium, url: `https://anilist.co/anime/${n.id}`, _d: dateKey(n.startDate) });
const clean = ({ _d, rel, ...rest }) => rest;
const CHAIN = new Set(['PREQUEL', 'SEQUEL', 'PARENT']);
// Non-chain relations worth listing: side stories/spin-offs/other (recaps and alternate versions are skipped).
const EXTRA = new Set(['SIDE_STORY', 'SPIN_OFF', 'OTHER']);
const EXTRA_FORMATS = new Set(['MOVIE', 'OVA', 'ONA', 'SPECIAL', 'TV_SHORT', 'MUSIC']);

/**
 * Walk PREQUEL/SEQUEL/PARENT links to list every season of a franchise, plus movies/OVAs/specials
 * (SIDE_STORY and chain members). One request per "level", so a long franchise is still only a few calls.
 */
export async function getAniListFranchise(anilistId, fetchImpl, { maxLevels = 8, maxNodes = 40 } = {}) {
  const nodes = new Map();
  const fetched = new Set();
  let frontier = [anilistId];
  for (let level = 0; level < maxLevels && frontier.length && fetched.size < maxNodes; level++) {
    const ids = frontier.filter((i) => !fetched.has(i)).slice(0, 25);
    if (!ids.length) break;
    ids.forEach((i) => fetched.add(i));
    const data = await gql(fetchImpl, FRANCHISE, { ids });
    const next = [];
    for (const m of data.Page?.media ?? []) {
      nodes.set(m.id, view(m));
      for (const e of m.relations?.edges ?? []) {
        const n = e.node;
        if (!n || n.type !== 'ANIME') continue;
        if (CHAIN.has(e.relationType)) {
          if (!nodes.has(n.id)) nodes.set(n.id, view(n));
          if (!fetched.has(n.id)) next.push(n.id);
        } else if (EXTRA.has(e.relationType) && !nodes.has(n.id) && (EXTRA_FORMATS.has(n.format) || (e.relationType === 'SPIN_OFF' && n.format === 'TV'))) {
          nodes.set(n.id, view(n, e.relationType));
        }
      }
    }
    frontier = [...new Set(next)];
  }
  const all = [...nodes.values()].sort((a, b) => a._d - b._d);
  const spin = (n) => n.rel === 'SPIN_OFF' && n.format === 'TV';
  return {
    seasons: all.filter((n) => n.format === 'TV' && !spin(n)).map(clean),
    movies: all.filter((n) => n.format === 'MOVIE').map(clean),
    other: all.filter((n) => n.format && !['TV', 'MOVIE'].includes(n.format) && !spin(n)).map(clean),
    spinoffs: all.filter(spin).map(clean),
  };
}

/** Find the AniList entry for a title found elsewhere (e.g. Wikipedia) so we can still list its seasons. */
export async function resolveAniListId(titleText, fetchImpl) {
  const items = await searchAniList(titleText, fetchImpl);
  const k = norm(titleText);
  const hit = items.find((i) => [i.title, ...i.altTitles].some((t) => baseKey(t) === baseKey(titleText) || norm(t) === k));
  return hit?.anilistId;
}
