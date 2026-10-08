import type { MediaTrack, Platform, PlatformLink } from '../domain/types.ts';
import { createRateLimiter, type LinkResolver } from '../providers/types.ts';

const PLATFORMS: Platform[] = ['spotify', 'apple', 'youtube', 'youtubeMusic', 'deezer'];

function searchUrl(platform: Platform, q: string): string {
  const e = encodeURIComponent(q);
  switch (platform) {
    case 'spotify': return `https://open.spotify.com/search/${e}`;
    case 'apple': return `https://music.apple.com/search?term=${e}`;
    case 'youtube': return `https://www.youtube.com/results?search_query=${e}`;
    case 'youtubeMusic': return `https://music.youtube.com/search?q=${e}`;
    case 'deezer': return `https://www.deezer.com/search/${e}`;
  }
}

/**
 * Build one link per platform. Real resolved links win; the rest fall back to a plain
 * search URL. Search URLs are NOT verified matches and the UI must label them that way.
 * MMDE only links out; it never hosts, downloads or streams anything.
 */
export function buildLinks(track: Pick<MediaTrack, 'title' | 'artists'>, resolved: PlatformLink[] = []): PlatformLink[] {
  const q = `${track.title} ${track.artists[0] ?? ''}`.trim();
  return PLATFORMS.map((platform) => resolved.find((r) => r.platform === platform) ?? { platform, url: searchUrl(platform, q), kind: 'search' as const });
}

/**
 * Deezer public API resolver. NOT TESTED LIVE (sandbox egress blocked). Deezer's rate limit
 * was reported as ~50 requests / 5 s per IP by a third party; we stay far below that.
 * The /track/isrc: lookup is from memory and unverified; search is the fallback.
 */
export function deezerResolver(fetchImpl: typeof fetch = fetch): LinkResolver {
  const wait = createRateLimiter(300);
  const get = async (url: string) => {
    await wait();
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Deezer`);
    return (await res.json()) as { id?: number; link?: string; data?: Array<{ id: number; link: string }>; error?: unknown };
  };
  return {
    name: 'deezer',
    async resolve(track: MediaTrack): Promise<PlatformLink[]> {
      const isrc = track.recording?.isrcs?.[0];
      if (isrc) {
        try {
          const t = await get(`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`);
          if (t.id && t.link) return [{ platform: 'deezer', url: t.link, kind: 'resolved', id: String(t.id) }];
        } catch { /* fall through to search */ }
      }
      // Only accept a search hit when we already trust the recording match; otherwise leave as a search link.
      if (!track.recording) return [];
      const q = `artist:"${track.artists[0] ?? ''}" track:"${track.title}"`;
      const r = await get(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=1`);
      const hit = r.data?.[0];
      return hit ? [{ platform: 'deezer', url: hit.link, kind: 'resolved', id: String(hit.id) }] : [];
    },
  };
}
