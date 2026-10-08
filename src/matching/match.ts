import type { RecordingCandidate, TrackClaim, VersionKind } from '../domain/types.ts';
import { classifyVersion, normalizeArtist, normalizeTitle, similarity } from './normalize.ts';

export interface MatchResult {
  score: number; // 0..1
  versionCompatible: boolean;
  reasons: string[];
}

// Pairs of versions that must NOT be merged. 'original' vs 'full' is allowed
// (a full-length song is usually the original recording); everything else must agree.
function versionsCompatible(a: VersionKind, b: VersionKind): boolean {
  if (a === b) return true;
  const loose = new Set<VersionKind>(['original', 'full', 'unknown']);
  return loose.has(a) && loose.has(b);
}

/**
 * Score how well a recording candidate matches a claimed track.
 * Conservative on purpose: "same title" alone never reaches the confirm threshold,
 * and a version-type mismatch (e.g. instrumental vs original) is a hard reject.
 */
export function scoreMatch(claim: TrackClaim, cand: RecordingCandidate): MatchResult {
  const reasons: string[] = [];
  const claimVersion = classifyVersion(claim.title);
  const candVersion = classifyVersion(cand.title, cand.disambiguation);

  if (!versionsCompatible(claimVersion, candVersion)) {
    return { score: 0, versionCompatible: false, reasons: [`version mismatch: ${claimVersion} vs ${candVersion}`] };
  }

  const titleSim = similarity(normalizeTitle(claim.title), normalizeTitle(cand.title));
  const claimArtists = claim.artists.map(normalizeArtist).filter(Boolean);
  const candArtists = cand.artists.map(normalizeArtist).filter(Boolean);
  const artistHit =
    claimArtists.length === 0
      ? 0
      : claimArtists.filter((a) => candArtists.some((c) => similarity(a, c) >= 0.85)).length / claimArtists.length;

  let score = titleSim * 0.55 + artistHit * 0.4;
  reasons.push(`title ${titleSim.toFixed(2)}`, `artist ${artistHit.toFixed(2)}`);

  // Duration is a weak sanity check, only applied when both sides state a duration
  // and the claim is not a short TV-size cut (those legitimately differ from the full song).
  if (claim.durationSec && cand.durationSec && claimVersion !== 'tv_size') {
    const diff = Math.abs(claim.durationSec - cand.durationSec);
    if (diff <= 5) {
      score += 0.05;
      reasons.push('duration agrees');
    } else if (diff > 30) {
      score -= 0.15;
      reasons.push(`duration differs by ${diff}s`);
    }
  }
  if (artistHit === 0) score = Math.min(score, 0.5); // title-only match can never confirm
  return { score: Math.max(0, Math.min(1, score)), versionCompatible: true, reasons };
}

export function bestMatch(
  claim: TrackClaim,
  candidates: RecordingCandidate[],
): { candidate: RecordingCandidate; result: MatchResult } | undefined {
  let best: { candidate: RecordingCandidate; result: MatchResult } | undefined;
  for (const candidate of candidates) {
    const result = scoreMatch(claim, candidate);
    if (result.versionCompatible && (!best || result.score > best.result.score)) best = { candidate, result };
  }
  return best;
}
