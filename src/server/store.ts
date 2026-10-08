import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DiscoveryResult } from '../domain/types.ts';

export interface Store {
  get(mediaId: string): Promise<DiscoveryResult | undefined>;
  put(result: DiscoveryResult): Promise<void>;
  list(): Promise<Array<Pick<DiscoveryResult, 'media' | 'generatedAt'>>>;
}

/** Simple JSON-file store (prototype). Swap for Postgres later behind the same interface. */
export function jsonStore(path?: string): Store {
  let cache: Record<string, DiscoveryResult> | undefined;
  const load = async () => {
    if (cache) return cache;
    cache = {};
    if (path) {
      try {
        cache = JSON.parse(await readFile(path, 'utf8')) as Record<string, DiscoveryResult>;
      } catch { /* no file yet */ }
    }
    return cache;
  };
  return {
    async get(id) { return (await load())[id]; },
    async put(r) {
      const all = await load();
      all[r.media.id] = r;
      if (path) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(all, null, 2));
      }
    },
    async list() {
      return Object.values(await load()).map((r) => ({ media: r.media, generatedAt: r.generatedAt }));
    },
  };
}
