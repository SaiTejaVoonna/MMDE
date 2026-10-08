import type { Media, MediaTrack, TrackClaim, Evidence, RecordingCandidate } from '../domain/types.ts';
import type { DiscoveryProvider, RecordingResolver } from '../providers/types.ts';
import { bestMatch } from '../matching/match.ts';
import { classifyVersion, normalizeArtist, normalizeTitle } from '../matching/normalize.ts';

const CONFIRM_SCORE = 0.8;

function groupKey(c: TrackClaim): string {
  const part = `${c.part.kind}:${c.part.number ?? '-'}`;
  return [part, c.role, normalizeTitle(c.title), classifyVersion(c.title)].join('|');
}

/**
 * Run all discovery providers, merge agreeing claims, resolve recordings, assign status.
 *  - confirmed : >= 2 distinct sources AND a recording match >= 0.8
 *  - suggested : 1 source with a good recording match, or >= 2 sources with none
 *  - unverified: everything else (never shown as fact)
 * A provider failing never aborts discovery; its error is returned in `errors`.
 */
export async function collectClaims(
  media: Media,
  providers: DiscoveryProvider[],
): Promise<{ claims: TrackClaim[]; errors: string[] }> {
  const errors: string[] = [];
  const claims: TrackClaim[] = [];
  for (const p of providers) {
    try {
      claims.push(...(await p.discover(media)));
    } catch (e) {
      errors.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { claims, errors };
}

export async function discover(
  media: Media,
  providers: DiscoveryProvider[],
  resolver?: RecordingResolver,
): Promise<{ tracks: MediaTrack[]; errors: string[] }> {
  const collected = await collectClaims(media, providers);
  const built = await buildTracks(media, collected.claims, resolver);
  return { tracks: built.tracks, errors: [...collected.errors, ...built.errors] };
}

/** Merge claims, resolve recordings, assign status. */
export async function buildTracks(
  media: Media,
  claims: TrackClaim[],
  resolver?: RecordingResolver,
): Promise<{ tracks: MediaTrack[]; errors: string[] }> {
  const errors: string[] = [];

  const groups = new Map<string, TrackClaim[]>();
  for (const c of claims) {
    const k = groupKey(c);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }

  const tracks: MediaTrack[] = [];
  let n = 0;
  for (const group of groups.values()) {
    const first = group[0]!;
    const evidence: Evidence[] = group.map((g) => g.evidence);
    const sources = new Set(evidence.map((e) => e.provider)).size;
    const artists = [...new Map(group.flatMap((g) => g.artists).map((a) => [normalizeArtist(a), a])).values()];
    const merged: TrackClaim = { ...first, artists };

    let recording: RecordingCandidate | undefined;
    let matchScore: number | undefined;
    if (resolver) {
      try {
        const m = bestMatch(merged, await resolver.resolve(first.title, artists));
        if (m) {
          recording = m.candidate;
          matchScore = m.result.score;
        }
      } catch (e) {
        errors.push(`${resolver.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const matched = (matchScore ?? 0) >= CONFIRM_SCORE;
    const status = matched && sources >= 2 ? 'confirmed' : matched || sources >= 2 ? 'suggested' : 'unverified';
    const confidence = Math.min(1, 0.3 + 0.2 * Math.min(sources - 1, 2) + 0.3 * (matchScore ?? 0));

    tracks.push({
      id: `${media.id}-t${++n}`,
      part: first.part,
      role: first.role,
      position: first.position,
      title: first.title,
      artists,
      version: classifyVersion(first.title),
      recording: matched ? recording : undefined,
      matchScore,
      confidence: Math.round(confidence * 100) / 100,
      status,
      evidence,
    });
  }
  return { tracks, errors };
}
