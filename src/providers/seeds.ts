import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSeed, type SeedFile } from './curated.ts';

export async function loadSeeds(dir: string): Promise<SeedFile[]> {
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return Promise.all(names.map((n) => loadSeed(join(dir, n))));
}

export { seedMediaResolver } from './seedResolver.ts';
