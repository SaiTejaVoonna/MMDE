import type { Media, TrackClaim, PartRef, TrackRole, Release } from '../domain/types.ts';
import { normalizeTitle } from '../matching/normalize.ts';
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

interface SeedRelease {
  title: string;
  artists: string[];
  kind: Release['kind'];
  label?: string;
  date?: string;
  trackCount?: number;
  part?: PartRef;
  source?: string;
}

export interface SeedFile {
  _status?: string;
  media: Media;
  claims: SeedClaim[];
  releases?: SeedRelease[];
}

export function seedMatchesMedia(seed: SeedFile, media: Media): boolean {
  if (media.id === seed.media.id) return true;
  const names = (m: Media) => [m.title, ...m.altTitles].map(normalizeTitle).filter(Boolean);
  const mine = new Set(names(seed.media));
  return names(media).some((n) => mine.has(n));
}

/** Node only (lazy import so the browser bundle never pulls in fs). */
export async function loadSeed(path: string): Promise<SeedFile> {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(path, 'utf8')) as SeedFile;
}

/** Hand-curated relationships. Counts as ONE source, so it can never reach "confirmed" alone. */
export function curatedProvider(seed: SeedFile): DiscoveryProvider {
  return {
    name: 'curated-seed',
    async releases(media: Media): Promise<Release[]> {
      if (!seedMatchesMedia(seed, media)) return [];
      return (seed.releases ?? []).map((r) => ({
        title: r.title, artists: r.artists, kind: r.kind, label: r.label, date: r.date,
        trackCount: r.trackCount, part: r.part,
        evidence: { provider: 'curated-seed', url: r.source, fetchedAt: new Date(0).toISOString() },
      }));
    },
    async discover(media: Media): Promise<TrackClaim[]> {
      if (!seedMatchesMedia(seed, media)) return [];
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
