import type { DiscoveryResult, Media } from '../domain/types.ts';
import type { Step } from '../server/runner.ts';
import type { organize } from '../app/organize.ts';

export type ResultView = DiscoveryResult & { groups: ReturnType<typeof organize> };

export interface Settings { live: boolean; anthropicKey: string; tmdbToken: string }

/** What the UI needs. Implemented by the server client and by the direct-in-browser engine. */
export interface Api {
  modeLabel: string;
  settings?: { get(): Settings; set(s: Settings): void };
  search(q: string): Promise<{ results: Media[]; errors: string[]; sources: string[] }>;
  getResult(id: string): Promise<ResultView | null>;
  discover(media: Media, onJob: (job: { steps: Step[] }) => void): Promise<ResultView>;
  getSeasons(media: Media): Promise<Array<{ seasonNumber: number; name: string; airDate?: string; episodeCount: number; posterPath?: string }>>;
}
