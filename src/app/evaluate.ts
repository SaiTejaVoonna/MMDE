import type { MediaTrack, TrackRole } from '../domain/types.ts';
import { normalizeArtist, normalizeTitle } from '../matching/normalize.ts';

export interface GroundTruthTrack {
  role: TrackRole;
  position?: string;
  title: string;
  artists: string[];
}

export interface Evaluation {
  precision: number;
  recall: number;
  matched: number;
  falsePositives: MediaTrack[];
  missed: GroundTruthTrack[];
}

const key = (role: string, title: string, artists: string[]) =>
  [role, normalizeTitle(title), ...artists.map(normalizeArtist).sort()].join('|');

/**
 * Accuracy test: compare discovered tracks to a hand-verified list.
 * precision = how much of what we found is true; recall = how much of the truth we found.
 * Only tracks the pipeline would show as fact (confirmed/suggested) count by default.
 */
export function evaluate(
  found: MediaTrack[],
  truth: GroundTruthTrack[],
  opts: { includeUnverified?: boolean } = {},
): Evaluation {
  const shown = opts.includeUnverified ? found : found.filter((t) => t.status !== 'unverified');
  const truthKeys = new Map(truth.map((t) => [key(t.role, t.title, t.artists), t]));
  const foundKeys = new Set(shown.map((t) => key(t.role, t.title, t.artists)));
  const falsePositives = shown.filter((t) => !truthKeys.has(key(t.role, t.title, t.artists)));
  const missed = truth.filter((t) => !foundKeys.has(key(t.role, t.title, t.artists)));
  const matched = truth.length - missed.length;
  return {
    precision: shown.length ? matched / shown.length : 1,
    recall: truth.length ? matched / truth.length : 1,
    matched,
    falsePositives,
    missed,
  };
}
