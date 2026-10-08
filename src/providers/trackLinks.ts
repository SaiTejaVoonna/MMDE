import type { PlatformLink } from '../domain/types.ts';
import { buildLinks } from '../links/platforms.ts';
import { normalizeArtist, normalizeTitle, sameArtist, similarity } from '../matching/normalize.ts';
import { createRateLimiter } from './types.ts';

export interface TrackQuery { title: string; artists: string[]; film: string; /** Song length and the film's year, when known: they tell the song from a same-named one by the same singer on another film. */ lengthSec?: number; year?: number }
export interface TrackLinksResult {
  /** One link per platform. kind 'resolved' = a verified catalog match; 'search' = only a search URL. */
  links: PlatformLink[];
  art?: string;
  /** Which catalog matched, for transparency in the UI. */
  matchedOn: string[];
}

interface Candidate { platform: 'apple' | 'deezer'; url: string; id: string; title: string; artists: string[]; album: string; art?: string; lengthSec?: number; year?: number }

/** Accept a catalog hit only when the title matches closely AND (an artist matches OR the album is the film). */
export function acceptCandidate(q: TrackQuery, c: Candidate): boolean {
  const titleSim = similarity(normalizeTitle(q.title), normalizeTitle(c.title));
  if (titleSim < 0.9) return false;
  const wantArtists = q.artists.map(normalizeArtist).filter(Boolean);
  const gotArtists = c.artists.map(normalizeArtist).filter(Boolean);
  const artistOk = wantArtists.length > 0 && wantArtists.some((a) => gotArtists.some((g) => sameArtist(a, g)));
  const film = normalizeTitle(q.film);
  const albumOk = film.length > 2 && normalizeTitle(c.album).includes(film);
  if (albumOk) return true;
  if (!artistOk) return false;
  // Singers record many songs, and titles repeat across films ("Naatu Naatu" on an unrelated 2018 album by the same singer):
  // an artist match alone is not enough when the length or the year says it is a different release.
  if (q.lengthSec && c.lengthSec) return Math.abs(q.lengthSec - c.lengthSec) <= 3;
  if (q.year && c.year) return c.year >= q.year - 1 && c.year <= q.year + 2;
  // Nothing left to tell this release from another one by the same singer: not a verified match, so the song keeps its search link.
  return false;
}

/**
 * Per-track platform links. Apple Music via the public iTunes Search API and Deezer via its public search API
 * (no keys). YouTube and Spotify stay as search links: exact links need API keys. Results are cached for 24h.
 * MMDE only links out; it never hosts, downloads or streams anything.
 */
export function trackLinkResolver(userAgent: string, fetchImpl: typeof fetch = fetch) {
  const appleWait = createRateLimiter(3000); // the iTunes Search API is reported to allow about 20 calls/min
  const deezerWait = createRateLimiter(300);
  const cache = new Map<string, { at: number; value: TrackLinksResult }>();
  const json = async (url: string) => {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as any;
  };
  async function apple(q: TrackQuery): Promise<Candidate | undefined> {
    for (const term of [`${q.title} ${q.artists[0] ?? ''}`.trim(), `${q.title} ${q.film}`]) {
      await appleWait();
      const d = await json(`https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'song', limit: '8' })}`);
      for (const r of d.results ?? []) {
        const c: Candidate = { platform: 'apple', url: String(r.trackViewUrl ?? ''), id: String(r.trackId ?? ''), title: String(r.trackName ?? ''), artists: [String(r.artistName ?? '')], album: String(r.collectionName ?? ''), art: r.artworkUrl100 ? String(r.artworkUrl100).replace('100x100', '300x300') : undefined, lengthSec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : undefined, year: r.releaseDate ? Number(String(r.releaseDate).slice(0, 4)) || undefined : undefined };
        if (c.url && acceptCandidate(q, c)) return c;
      }
    }
    return undefined;
  }
  async function deezer(q: TrackQuery): Promise<Candidate | undefined> {
    for (const term of [`track:"${q.title}" artist:"${q.artists[0] ?? ''}"`, `${q.title} ${q.film}`]) {
      await deezerWait();
      const d = await json(`https://api.deezer.com/search?${new URLSearchParams({ q: term, limit: '8' })}`);
      for (const r of d.data ?? []) {
        const c: Candidate = { platform: 'deezer', url: String(r.link ?? ''), id: String(r.id ?? ''), title: String(r.title ?? ''), artists: [String(r.artist?.name ?? '')], album: String(r.album?.title ?? ''), art: r.album?.cover_medium ? String(r.album.cover_medium) : undefined, lengthSec: r.duration || undefined };
        if (c.url && acceptCandidate(q, c)) return c;
      }
    }
    return undefined;
  }
  return {
    async resolve(q: TrackQuery): Promise<TrackLinksResult> {
      const key = `${normalizeTitle(q.title)}|${normalizeArtist(q.artists[0] ?? '')}|${normalizeTitle(q.film)}|${q.lengthSec ?? ''}|${q.year ?? ''}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < 86_400_000) return hit.value;
      const [a, d] = await Promise.allSettled([apple(q), deezer(q)]);
      const found = [a, d].flatMap((s) => (s.status === 'fulfilled' && s.value ? [s.value] : []));
      // If both services failed outright, do not cache: the caller may retry.
      const bothFailed = a.status === 'rejected' && d.status === 'rejected';
      // Search links should find the right song: put the film name in the YouTube/Spotify query.
      const base = buildLinks({ title: `${q.title} ${q.film}`, artists: [] });
      const exact: PlatformLink[] = found.map((c) => ({ platform: c.platform, url: c.url, kind: 'resolved', id: c.id }));
      const links = base.map((l) => exact.find((e) => e.platform === l.platform) ?? l);
      const value: TrackLinksResult = { links, art: found.find((c) => c.art)?.art, matchedOn: found.map((c) => c.platform) };
      if (!bothFailed) cache.set(key, { at: Date.now(), value });
      if (cache.size > 3000) cache.delete(cache.keys().next().value as string);
      if (bothFailed) throw new Error('Apple Music and Deezer lookups failed');
      return value;
    },
  };
}
