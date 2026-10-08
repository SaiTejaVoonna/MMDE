import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Media } from '../domain/types.ts';
import { normalizeTitle } from '../matching/normalize.ts';
import { loadSeed, type SeedFile } from './curated.ts';
import type { MediaResolver } from './types.ts';

export async function loadSeeds(dir: string): Promise<SeedFile[]> {
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return Promise.all(names.map((n) => loadSeed(join(dir, n))));
}

/** Offline media search over the local seed files, so the app works with no network. */
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
