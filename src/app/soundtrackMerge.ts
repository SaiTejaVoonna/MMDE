import { classifyVersion, normalizeArtist, normalizeTitle } from '../matching/normalize.ts';
import type { Soundtrack } from '../providers/wikiSoundtrack.ts';
import type { CatalogAlbum, CatalogTrack } from '../providers/catalogAlbums.ts';
import { artistMatches, looseFold } from '../providers/catalogAlbums.ts';

// Phase A: merge every soundtrack source we have into ONE organized list, and say how much each song can be trusted.
//   green = confirmed by 2+ independent sources     (e.g. on the Wikipedia tracklist AND on an Apple Music album named after the film;
//           or on a catalog album AND credited to the film's composer)
//   amber = one reputable source                    (a Wikipedia tracklist, or one catalog album named after the film)
//   red   = only a community playlist / unverified  (anyone can make those)

export type Confidence = 'green' | 'amber' | 'red';
export type EvidenceSource = 'wikipedia' | 'apple' | 'deezer' | 'credits' | 'community';
export interface Evidence { source: EvidenceSource; label: string; url?: string }
export interface MergedTrack {
  key: string;
  no?: number;
  title: string;
  artists: string[];
  lengthSec?: number;
  confidence: Confidence;
  evidence: Evidence[];
  /** Direct (verified-in-catalog) links, only where a catalog listed the song. */
  links: { apple?: string; deezer?: string };
  art?: string;
}
export interface MergedSection { name: string; origin: 'wikipedia' | 'catalog' | 'community'; tracks: MergedTrack[] }
export interface AlbumWithTracks { album: CatalogAlbum; tracks: CatalogTrack[] }
export interface MergedSoundtrack {
  sections: MergedSection[];
  wikipedia?: { title: string; url: string };
  albums: CatalogAlbum[];
  /** Albums/playlists that were found but dropped because neither artist nor songs matched this title. */
  skipped: Array<{ name: string; platform: string; reason: string }>;
  counts: { green: number; amber: number; red: number; total: number };
  /** How we know the albums belong to this title: the film's composer (TMDB), a Wikipedia tracklist, or 'none' (matched by name only). */
  verified: 'composer' | 'wikipedia' | 'none';
  /** True when some album's tracks could not be fetched in time, so the list may be incomplete. */
  partial: boolean;
}

const PLATFORM_LABEL = { apple: 'Apple Music', deezer: 'Deezer', 'deezer-playlist': 'Deezer playlist' } as const;

/** Same song = same normalized title (accents, spelling doubles, "(From ...)" tails ignored) and same version kind. */
export const trackKey = (title: string) => `${looseFold(normalizeTitle(title))}|${classifyVersion(title)}`;

export function confidenceOf(evidence: Evidence[]): Confidence {
  const kinds = new Set(evidence.filter((e) => e.source !== 'community' && e.source !== 'credits').map((e) => e.source));
  if (kinds.size >= 2) return 'green';
  // "The credited artist is the film's composer" supports a song, but only counts as confirmation next to a catalog listing.
  const inCatalog = kinds.has('apple') || kinds.has('deezer');
  if (kinds.size === 1 && inCatalog && evidence.some((e) => e.source === 'credits')) return 'green';
  return kinds.size === 1 ? 'amber' : 'red';
}

function unionArtists(a: string[], b: string[]): string[] {
  const seen = new Map<string, string>();
  for (const n of [...a, ...b]) { const k = normalizeArtist(n); if (k && !seen.has(k)) seen.set(k, n); }
  return [...seen.values()];
}

export function mergeSoundtrack(wiki: Soundtrack | null, fetched: AlbumWithTracks[], opts: { partial?: boolean; composers?: string[]; skipped?: MergedSoundtrack['skipped'] } = {}): MergedSoundtrack {
  const sections: MergedSection[] = [];
  const byKey = new Map<string, MergedTrack>(); // every song seen so far, wherever it was first listed
  const addEvidence = (t: MergedTrack, e: Evidence) => { if (!t.evidence.some((x) => x.source === e.source && x.label === e.label)) t.evidence.push(e); };

  // 1. Wikipedia keeps its own sections and order: it is the editorial list.
  if (wiki) {
    const wikiEvidence: Evidence = { source: 'wikipedia', label: `Wikipedia: ${wiki.page.title}`, url: wiki.page.url };
    for (const sec of wiki.sections) {
      const tracks: MergedTrack[] = [];
      for (const t of sec.tracks) {
        const key = trackKey(t.title);
        const existing = byKey.get(key);
        if (existing) { addEvidence(existing, wikiEvidence); continue; } // same song listed in two Wikipedia sections: keep the first
        const m: MergedTrack = { key, no: t.no, title: t.title, artists: t.artists, lengthSec: t.lengthSec, confidence: 'amber', evidence: [wikiEvidence], links: {} };
        byKey.set(key, m); tracks.push(m);
      }
      if (tracks.length) sections.push({ name: sec.name, origin: 'wikipedia', tracks });
    }
  }

  // 2. Catalog albums: add evidence and direct links to known songs; unknown songs go in their own album section.
  const albums = fetched.filter((f) => f.album.kind === 'album');
  const playlists = fetched.filter((f) => f.album.kind === 'playlist');
  for (const { album, tracks } of albums) {
    const src = album.platform === 'apple' ? 'apple' : 'deezer';
    const ev: Evidence = { source: src, label: `${PLATFORM_LABEL[album.platform]}: ${album.name}`, url: album.url };
    const fresh: MergedTrack[] = [];
    for (const t of tracks) {
      const key = trackKey(t.title);
      const known = byKey.get(key);
      if (known) {
        addEvidence(known, ev);
        known.links[src] ??= t.url;
        known.art ??= t.art ?? album.art;
        known.artists = unionArtists(known.artists, t.artists);
        known.lengthSec ??= t.lengthSec;
      } else {
        const m: MergedTrack = { key, no: t.no, title: t.title, artists: t.artists, lengthSec: t.lengthSec, confidence: 'amber', evidence: [ev], links: { [src]: t.url }, art: t.art ?? album.art };
        byKey.set(key, m); fresh.push(m);
      }
    }
    if (fresh.length) sections.push({ name: `${PLATFORM_LABEL[album.platform]}: ${album.name}`, origin: 'catalog', tracks: fresh });
  }

  // 3. Community playlists never create "confirmed" songs: they only add a (weak) note to known ones, or sit in a red section.
  for (const { album, tracks } of playlists) {
    const ev: Evidence = { source: 'community', label: `Community playlist: ${album.name} (by ${album.artist})`, url: album.url };
    const fresh: MergedTrack[] = [];
    for (const t of tracks) {
      const key = trackKey(t.title);
      const known = byKey.get(key);
      if (known) { addEvidence(known, ev); known.links.deezer ??= t.url; continue; }
      const m: MergedTrack = { key, no: t.no, title: t.title, artists: t.artists, lengthSec: t.lengthSec, confidence: 'red', evidence: [ev], links: { deezer: t.url }, art: t.art ?? album.art };
      byKey.set(key, m); fresh.push(m);
    }
    if (fresh.length) sections.push({ name: `Community playlist (unverified): ${album.name}`, origin: 'community', tracks: fresh });
  }

  // 4. Artist check: a song credited to the film's composer (per TMDB) gets one extra, independent piece of evidence.
  for (const t of byKey.values()) {
    const hit = (opts.composers ?? []).find((c) => t.artists.some((a) => artistMatches(a, c)));
    if (hit) addEvidence(t, { source: 'credits', label: `Credited artist matches the film's composer, ${hit} (TMDB credits)` });
  }

  // With no composer and no Wikipedia list, an album is matched by its NAME only ("Kingdom" fits many works): never call that trustworthy.
  const verified: MergedSoundtrack['verified'] = (opts.composers ?? []).length ? 'composer' : wiki ? 'wikipedia' : 'none';
  const counts = { green: 0, amber: 0, red: 0, total: 0 };
  for (const t of byKey.values()) {
    t.confidence = confidenceOf(t.evidence);
    if (verified === 'none' && t.confidence === 'amber') t.confidence = 'red';
    counts[t.confidence]++; counts.total++;
  }
  return {
    sections, wikipedia: wiki ? { title: wiki.page.title, url: wiki.page.url } : undefined,
    albums: fetched.map((f) => f.album), skipped: opts.skipped ?? [], verified, counts, partial: !!opts.partial,
  };
}
