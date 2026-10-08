import { readFile } from 'node:fs/promises';
import type { Media, TrackClaim, PartRef, TrackRole } from '../domain/types.ts';
import type { DiscoveryProvider } from './types.ts';

interface SeedClaim {
  part: PartRef;
  role: TrackRole;
  position?: string;
  title: string;
  artists: string[];
  durationSec?: number;
  source?: string; // where the curator got it (URL or note)
}

export interface SeedFile {
  _status?: string;
  media: Media;
  claims: SeedClaim[];
}

export async function loadSeed(path: string): Promise<SeedFile> {
  return JSON.parse(await readFile(path, 'utf8')) as SeedFile;
}

/** Hand-curated relationships. Counts as ONE source, so it can never reach "confirmed" alone. */
export function curatedProvider(seed: SeedFile): DiscoveryProvider {
  return {
    name: 'curated-seed',
    async discover(media: Media): Promise<TrackClaim[]> {
      if (media.id !== seed.media.id) return [];
      return seed.claims.map((c) => ({
        part: c.part,
        role: c.role,
        position: c.position,
        title: c.title,
        artists: c.artists,
        durationSec: c.durationSec,
        evidence: { provider: 'curated-seed', url: c.source, fetchedAt: new Date(0).toISOString() },
      }));
    },
  };
}
