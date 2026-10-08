import { createRateLimiter } from './types.ts';

// Soundtrack discovery straight from music catalogs, for films Wikipedia has no tracklist for:
// Apple Music (public iTunes Search API) and Deezer (public API), no keys needed. Links point at the platform; nothing is hosted.
// YouTube and Spotify need API keys to list albums/playlists, so they are not covered here.

export type CatalogPlatform = 'apple' | 'deezer' | 'deezer-playlist';
export interface CatalogAlbum { platform: CatalogPlatform; id: string; name: string; artist: string; art?: string; url: string; trackCount?: number; kind: 'album' | 'playlist'; /** Found because Wikipedia's tracklist names this album (not because its name contains the film title). */ viaWiki?: boolean }
export interface CatalogTrack { no: number; title: string; artists: string[]; lengthSec?: number; url: string; id: string; art?: string }

/** Lowercase, accents removed, punctuation -> space, repeated letters collapsed ("Bāhubali" ~ "Baahubali"). */
export const looseFold = (x: string) =>
  x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/(\p{L})\1+/gu, '$1').trim();

const SOUNDTRACKY = /soundtrack|\bost\b|motion picture|original score|film score|\bscore\b|jukebox|music from/i;

/** An album belongs to the film when its name contains the whole film title (accent/spelling tolerant). */
export function isFilmAlbum(filmTitle: string, albumName: string): boolean {
  const film = looseFold(filmTitle);
  return film.length >= 3 && looseFold(albumName).includes(film);
}

const GENERIC_WORDS = /\b(extended|background|original|motion|picture|soundtrack|score|ost|music|from|the|film|movie|album|tracklist|track|listing|volume|vol|part)\b/g;
/**
 * Does a catalog album belong to a Wikipedia-named album series ("Baahubali (Original Soundtrack)")?
 * Catalogs rename things ("Baahubali Ost - Volume 3 (Original Motion Picture Soundtrack)"), so: either the whole name is contained,
 * or the distinctive word(s) are present AND it is a numbered volume (which keeps out the first film's albums and other films).
 */
export function matchesWikiAlbum(base: string, albumName: string): boolean {
  const b = looseFold(base); const a = looseFold(albumName);
  if (a.includes(b)) return true;
  const distinct = b.replace(GENERIC_WORDS, ' ').replace(/\d+/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
  return distinct.length > 0 && distinct.every((w) => a.includes(w)) && /\b(volume|vol)\b/.test(a);
}

/**
 * Wikipedia often names the real albums in its section titles ("Background score · Baahubali (Original Soundtrack) - Volume 1").
 * Turn those into catalog search terms, dropping the volume suffix so one search finds every volume. Max 3 distinct names.
 */
export function extraAlbumNames(sectionNames: string[]): string[] {
  const out = new Map<string, string>();
  for (const n of sectionNames) {
    const last = n.split(' · ').pop()!.trim();
    if (!/\b(soundtrack|volume|vol\.?|ost|score|original)\b/i.test(last) || n.indexOf(' · ') < 0) continue;
    const base = last.replace(/\s*[-–:,]?\s*\b(vol(ume|\.)?|part)\s*\d+\b.*$/i, '').trim();
    // A bare label like "Extended Soundtrack" names no album: something title-like must remain once generic words are removed.
    const distinct = looseFold(base).replace(GENERIC_WORDS, '').replace(/\d+/g, '').replace(/\s+/g, '');
    if (looseFold(base).length >= 6 && distinct.length >= 3 && !out.has(looseFold(base))) out.set(looseFold(base), base);
  }
  return [...out.values()].slice(0, 3);
}

/** Playlists are looser: a numbered sequel may drop its subtitle ("Baahubali 2 songs"), but a bare franchise name may not. */
export function isFilmPlaylist(filmTitle: string, name: string): boolean {
  if (isFilmAlbum(filmTitle, name)) return true;
  const head = looseFold(filmTitle.split(':')[0]!);
  return head.length >= 4 && /\d/.test(head) && looseFold(name).includes(head);
}

export function catalogResolver(userAgent: string, fetchImpl: typeof fetch = fetch) {
  const appleWait = createRateLimiter(3000); // the iTunes Search API is reported to allow about 20 calls/min
  const deezerWait = createRateLimiter(300);
  const cache = new Map<string, { at: number; value: unknown }>();
  const remember = async <T>(key: string, make: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 12 * 3600_000) return hit.value as T;
    const value = await make();
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
    return value;
  };
  const json = async (url: string) => {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as any;
  };
  const apple = async (url: string) => { await appleWait(); return json(url); };
  const deezer = async (url: string) => { await deezerWait(); return json(url); };

  async function findAlbums(film: string, year?: number, extraNames: string[] = []): Promise<CatalogAlbum[]> {
    return remember(`albums|${looseFold(film)}|${year ?? ''}|${extraNames.map(looseFold).join('+')}`, async () => {
      const [a, d, p] = await Promise.allSettled([
        apple(`https://itunes.apple.com/search?${new URLSearchParams({ term: `${film} soundtrack`, entity: 'album', limit: '25' })}`),
        deezer(`https://api.deezer.com/search/album?${new URLSearchParams({ q: film, limit: '25' })}`),
        deezer(`https://api.deezer.com/search/playlist?${new URLSearchParams({ q: `${film} soundtrack`, limit: '15' })}`),
      ]);
      // Albums that Wikipedia names (e.g. "... - Volume 1..10"): one search per distinct name, accepted when the album name starts with it.
      const extraApple: any[] = []; const extraDeezer: any[] = [];
      for (const name of extraNames) {
        const [ea, ed] = await Promise.allSettled([
          apple(`https://itunes.apple.com/search?${new URLSearchParams({ term: name, entity: 'album', limit: '25' })}`),
          deezer(`https://api.deezer.com/search/album?${new URLSearchParams({ q: name, limit: '25' })}`),
        ]);
        if (ea.status === 'fulfilled') extraApple.push(...(ea.value.results ?? []).filter((r: any) => matchesWikiAlbum(name, String(r.collectionName ?? ''))));
        if (ed.status === 'fulfilled') extraDeezer.push(...(ed.value.data ?? []).filter((r: any) => matchesWikiAlbum(name, String(r.title ?? ''))));
      }
      if (a.status === 'rejected' && d.status === 'rejected' && p.status === 'rejected') throw new Error('Apple Music and Deezer lookups failed');
      const out: CatalogAlbum[] = [];
      if (a.status === 'fulfilled') {
        for (const r of a.value.results ?? []) {
          if (!r.collectionId || !isFilmAlbum(film, String(r.collectionName ?? '')) || (r.trackCount ?? 0) < 2) continue;
          out.push({ platform: 'apple', id: String(r.collectionId), name: String(r.collectionName), artist: String(r.artistName ?? ''), art: r.artworkUrl100 ? String(r.artworkUrl100).replace('100x100', '300x300') : undefined, url: String(r.collectionViewUrl ?? ''), trackCount: r.trackCount, kind: 'album' });
        }
      }
      const seen = new Set(out.map((x) => looseFold(x.name)));
      if (d.status === 'fulfilled') {
        for (const r of d.value.data ?? []) {
          if (!r.id || !isFilmAlbum(film, String(r.title ?? '')) || (r.nb_tracks ?? 0) < 2 || seen.has(looseFold(String(r.title)))) continue;
          seen.add(looseFold(String(r.title)));
          out.push({ platform: 'deezer', id: String(r.id), name: String(r.title), artist: String(r.artist?.name ?? ''), art: r.cover_medium ? String(r.cover_medium) : undefined, url: String(r.link ?? ''), trackCount: r.nb_tracks, kind: 'album' });
        }
      }
      const viaWiki: CatalogAlbum[] = [];
      for (const r of extraApple) {
        if (!r.collectionId || (r.trackCount ?? 0) < 2 || seen.has(looseFold(String(r.collectionName)))) continue;
        seen.add(looseFold(String(r.collectionName)));
        viaWiki.push({ platform: 'apple', id: String(r.collectionId), name: String(r.collectionName), artist: String(r.artistName ?? ''), art: r.artworkUrl100 ? String(r.artworkUrl100).replace('100x100', '300x300') : undefined, url: String(r.collectionViewUrl ?? ''), trackCount: r.trackCount, kind: 'album', viaWiki: true });
      }
      for (const r of extraDeezer) {
        if (!r.id || (r.nb_tracks ?? 0) < 2 || seen.has(looseFold(String(r.title)))) continue;
        seen.add(looseFold(String(r.title)));
        viaWiki.push({ platform: 'deezer', id: String(r.id), name: String(r.title), artist: String(r.artist?.name ?? ''), art: r.cover_medium ? String(r.cover_medium) : undefined, url: String(r.link ?? ''), trackCount: r.nb_tracks, kind: 'album', viaWiki: true });
      }
      viaWiki.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
      const albums = out.filter((x) => x.url).sort((x, y) => Number(SOUNDTRACKY.test(y.name)) - Number(SOUNDTRACKY.test(x.name)) || (y.trackCount ?? 0) - (x.trackCount ?? 0)).slice(0, 8);
      // Community playlists are made by anyone: shown separately and labeled unverified.
      const playlists: CatalogAlbum[] = [];
      if (p.status === 'fulfilled') {
        for (const r of p.value.data ?? []) {
          if (!r.id || !isFilmPlaylist(film, String(r.title ?? '')) || (r.nb_tracks ?? 0) < 5 || (r.nb_tracks ?? 0) > 120) continue;
          playlists.push({ platform: 'deezer-playlist', id: String(r.id), name: String(r.title), artist: String(r.user?.name ?? 'a Deezer user'), art: r.picture_medium ? String(r.picture_medium) : undefined, url: String(r.link ?? ''), trackCount: r.nb_tracks, kind: 'playlist' });
          if (playlists.length >= 3) break;
        }
      }
      return [...albums, ...viaWiki.filter((x) => x.url), ...playlists];
    });
  }

  async function tracks(platform: CatalogPlatform, id: string): Promise<CatalogTrack[]> {
    if (!/^\d{1,15}$/.test(id)) throw new Error('invalid id');
    return remember(`tracks|${platform}|${id}`, async () => {
      if (platform === 'apple') {
        const d = await apple(`https://itunes.apple.com/lookup?${new URLSearchParams({ id, entity: 'song' })}`);
        return (d.results ?? []).filter((r: any) => r.wrapperType === 'track' && r.trackViewUrl).map((r: any, i: number): CatalogTrack => ({
          no: r.trackNumber ?? i + 1, title: String(r.trackName), artists: String(r.artistName ?? '').split(/\s*(?:,|&)\s*/).filter(Boolean),
          lengthSec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : undefined, url: String(r.trackViewUrl), id: String(r.trackId),
          art: r.artworkUrl100 ? String(r.artworkUrl100).replace('100x100', '300x300') : undefined,
        })).sort((a: CatalogTrack, b: CatalogTrack) => a.no - b.no);
      }
      const path = platform === 'deezer' ? `album/${id}` : `playlist/${id}`;
      const d = await deezer(`https://api.deezer.com/${path}/tracks?limit=120`);
      return (d.data ?? []).filter((r: any) => r.link).map((r: any, i: number): CatalogTrack => ({
        no: i + 1, title: String(r.title), artists: [String(r.artist?.name ?? '')].filter(Boolean), lengthSec: r.duration || undefined, url: String(r.link), id: String(r.id),
        art: (r.album?.cover_medium && String(r.album.cover_medium)) || undefined,
      }));
    });
  }
  return { findAlbums, tracks };
}
