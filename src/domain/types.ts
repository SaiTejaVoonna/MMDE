// MMDE domain model (prototype). Proposal only: see docs/DATA_MODEL.md.
// Media -> MediaPart -> MediaTrack -> Recording. A MediaTrack is a *claim* that a
// recording plays in a part of a media, with evidence and a confidence status.

export type MediaType = 'anime' | 'movie' | 'tv' | 'game' | 'other';
export type PartKind = 'season' | 'movie' | 'special' | 'ova' | 'whole';
export type TrackRole =
  | 'opening'
  | 'ending'
  | 'insert'
  | 'character'
  | 'ost'
  | 'score'
  | 'promo'
  | 'other';
export type VersionKind =
  | 'original'
  | 'tv_size'
  | 'full'
  | 'live'
  | 'remix'
  | 'cover'
  | 'instrumental'
  | 'rerecording'
  | 'unknown';
export type MatchStatus = 'confirmed' | 'suggested' | 'unverified';

export interface Media {
  id: string;
  type: MediaType;
  title: string;
  altTitles: string[];
  year?: number;
  externalIds: Record<string, string>;
}

export interface PartRef {
  kind: PartKind;
  number?: number;
}

export interface MediaPart extends PartRef {
  id: string;
  mediaId: string;
  title: string;
}

export interface Evidence {
  provider: string;
  url?: string;
  quote?: string;
  fetchedAt: string;
}

/** What a discovery provider says: "this song plays in this part, in this role". */
export interface TrackClaim {
  part: PartRef;
  role: TrackRole;
  position?: string; // e.g. "OP1", "ED2"
  title: string;
  artists: string[];
  durationSec?: number;
  evidence: Evidence;
}

/** A concrete recording found by an identity resolver (e.g. MusicBrainz). */
export interface RecordingCandidate {
  title: string;
  artists: string[];
  durationSec?: number;
  mbid?: string;
  isrcs: string[];
  disambiguation?: string;
  source: string;
}

export interface MediaTrack {
  id: string;
  part: PartRef;
  role: TrackRole;
  position?: string;
  title: string;
  artists: string[];
  version: VersionKind;
  recording?: RecordingCandidate;
  matchScore?: number;
  /** Display-only: why a recording was / was not matched (top candidate and score). */
  matchNote?: string;
  confidence: number;
  status: MatchStatus;
  evidence: Evidence[];
}

export interface Release {
  title: string;
  artists: string[];
  kind: 'ost' | 'single' | 'album' | 'other';
  label?: string;
  date?: string;
  trackCount?: number;
  part?: PartRef;
  evidence: Evidence;
}

export type Platform = 'spotify' | 'apple' | 'youtube' | 'youtubeMusic' | 'deezer';

/** "resolved" = we found the actual item; "search" = a search URL, NOT a verified match. */
export interface PlatformLink {
  platform: Platform;
  url: string;
  kind: 'resolved' | 'search';
  id?: string;
}

export interface TrackView extends MediaTrack {
  links: PlatformLink[];
}

export interface DiscoveryResult {
  media: Media;
  tracks: TrackView[];
  releases: Release[];
  errors: string[];
  sources: string[];
  generatedAt: string;
}
