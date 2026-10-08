import type { Media, MediaTrack, TrackClaim, Evidence, RecordingCandidate } from '../domain/types.ts';
import type { DiscoveryProvider, RecordingResolver } from '../providers/types.ts';
import { bestMatch, scoreMatch } from '../matching/match.ts';
import { classifyVersion, normalizeArtist, normalizeTitle } from '../matching/normalize.ts';

const CONFIRM_SCORE = 0.8;

function groupKey(c: TrackClaim): string {
  const part = `${c.part.kind}:${c.part.number ?? '-'}`;
  return [part, c.role, normalizeTitle(c.title), classifyVersion(c.title)].join('|');
}

export function discoveryTargets(media: Media): Media[] {
  const seen = new Set<string>();
  const out: Media[] = [];
  const add = (m: Media) => { if (!seen.has(m.id)) { seen.add(m.id); out.push(m); } };
  add(media);
  for (const related of media.relatedMedia ?? []) add(related);
  return out;
}

export async function collectClaims(media: Media, providers: DiscoveryProvider[]): Promise<{ claims: TrackClaim[]; errors: string[] }> {
  const errors: string[] = [];
  const claims: TrackClaim[] = [];
  for (const p of providers) {
    for (const target of discoveryTargets(media)) {
      try { claims.push(...(await p.discover(target))); }
      catch (e) { errors.push(`${p.name} [${target.title}]: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }
  return { claims, errors };
}

export async function discover(media: Media, providers: DiscoveryProvider[], resolver?: RecordingResolver): Promise<{ tracks: MediaTrack[]; errors: string[] }> {
  const collected = await collectClaims(media, providers);
  const built = await buildTracks(media, collected.claims, resolver);
  return { tracks: built.tracks, errors: [...collected.errors, ...built.errors] };
}

export async function buildTracks(media: Media, claims: TrackClaim[], resolver?: RecordingResolver): Promise<{ tracks: MediaTrack[]; errors: string[] }> {
  const errors: string[] = [];
  const groups = new Map<string, TrackClaim[]>();
  for (const c of claims) groups.set(groupKey(c), [...(groups.get(groupKey(c)) ?? []), c]);

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
    let matchNote: string | undefined;
    if (resolver) {
      try {
        const candidates = await resolver.resolve(first.title, artists);
        const m = bestMatch(merged, candidates);
        matchNote = describeMatch(merged, candidates);
        if (m) { recording = m.candidate; matchScore = m.result.score; }
      } catch (e) { errors.push(`${resolver.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    const matched = (matchScore ?? 0) >= CONFIRM_SCORE;
    const status = matched && sources >= 2 ? 'confirmed' : matched || sources >= 2 ? 'suggested' : 'unverified';
    const confidence = Math.min(1, 0.3 + 0.2 * Math.min(sources - 1, 2) + 0.3 * (matchScore ?? 0));
    tracks.push({
      id: `${media.id}-t${++n}`, part: first.part, role: first.role, position: first.position,
      title: first.title, artists, version: classifyVersion(first.title), recording: matched ? recording : undefined,
      matchScore, matchNote, confidence: Math.round(confidence * 100) / 100, status, evidence,
    });
  }
  return { tracks, errors };
}

function describeMatch(claim: TrackClaim, candidates: RecordingCandidate[]): string {
  if (candidates.length === 0) return 'resolver returned 0 candidates';
  let top = candidates[0]!;
  let topResult = scoreMatch(claim, top);
  for (const c of candidates.slice(1)) {
    const r = scoreMatch(claim, c);
    if (r.score > topResult.score) { top = c; topResult = r; }
  }
  return `${candidates.length} candidates; top "${top.title}" - ${top.artists.join(', ') || 'unknown'} score ${topResult.score.toFixed(2)} (${topResult.reasons.join(', ')})`;
}
