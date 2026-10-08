import type { Media, PlatformLink, RecordingCandidate, Release, TrackClaim, MediaTrack } from '../domain/types.ts';

/** Finds media -> music relationships (themes, inserts, OST...). Replaceable. */
export interface DiscoveryProvider {
  readonly name: string;
  discover(media: Media): Promise<TrackClaim[]>;
  /** Optional: soundtrack/album releases related to the media. */
  releases?(media: Media): Promise<Release[]>;
}

/** Finds real platform items (e.g. via ISRC or catalog search). Optional, best-effort. */
export interface LinkResolver {
  readonly name: string;
  resolve(track: MediaTrack): Promise<PlatformLink[]>;
}

/** Resolves a (title, artists) pair to concrete recordings with stable IDs. */
export interface RecordingResolver {
  readonly name: string;
  resolve(title: string, artists: string[]): Promise<RecordingCandidate[]>;
}

/** Resolves a search string to a canonical media entity. */
export interface MediaResolver {
  readonly name: string;
  /** `deep` asks for a longer list (the "view all results" page). Resolvers may ignore it. */
  search(query: string, opts?: { deep?: boolean }): Promise<Media[]>;
}

/** Minimal polite rate limiter: at most one call per `intervalMs`. */
export function createRateLimiter(intervalMs: number) {
  let next = 0;
  return async function wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + intervalMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
}
