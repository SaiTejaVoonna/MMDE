import type { Media } from '../domain/types.ts';
import { normalizeTitle } from '../matching/normalize.ts';
import type { SeedFile } from './curated.ts';
import type { MediaResolver } from './types.ts';

/** Offline media search over seed data. Pure (no Node APIs), so it also runs in the browser. */
export function seedMediaResolver(seeds: SeedFile[]): MediaResolver {
  return {
    name: 'local-seeds',
    async search(query: string): Promise<Media[]> {
      const q = normalizeTitle(query);
      if (!q) return [];
      return seeds
        .map((s) => s.media)
        .filter((m) => [m.title, ...m.altTitles].some((t) => normalizeTitle(t).includes(q)));
    },
  };
}
