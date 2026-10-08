import { classifyVersion, normalizeArtist, normalizeTitle } from '../matching/normalize.ts';
import type { Soundtrack } from '../providers/wikiSoundtrack.ts';
import type { CatalogAlbum, CatalogTrack } from '../providers/catalogAlbums.ts';
import type { AnimeThemesEntry } from '../providers/animeThemesSearch.ts';
import { languageFromName, type MbRelease } from '../providers/mbReleases.ts';
import { artistMatches, looseFold } from '../providers/catalogAlbums.ts';
import { classifyForSeason, seasonMarkers, type SeasonFit } from './seasonScope.ts';

// Phase A: merge every soundtrack source we have into ONE organized list, and say how much each song can be trusted.
//   green = confirmed by 2+ independent sources     (e.g. on the Wikipedia tracklist AND on an Apple Music album named after the film;
//           or on a catalog album AND credited to the film's composer)
//   amber = one reputable source                    (a Wikipedia tracklist, or one catalog album named after the film)
//   red   = only a community playlist / unverified  (anyone can make those)

export type Confidence = 'green' | 'amber' | 'red';
export type EvidenceSource = 'wikipedia' | 'apple' | 'deezer' | 'musicbrainz' | 'animethemes' | 'credits' | 'community';
export interface Evidence { source: EvidenceSource; label: string; url?: string }
/** The public paper trail of an official release: what the catalogs (not the audio) say about a song. */
export interface ReleaseProof { isrc?: string; label?: string; upc?: string; releaseDate?: string; release?: string; releaseUrl?: string }
export interface MergedTrack {
  key: string;
  /** Official Release Proof, from MusicBrainz (ISRC, label, barcode, date). Absent when no release database lists the song. */
  proof?: ReleaseProof;
  /** The same song in another language release (matched by track number, length and composer, NOT by title): probable, never confirmed. */
  versions?: Array<{ language: string; title: string; section: string }>;
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
export interface MergedSection { name: string; origin: 'wikipedia' | 'catalog' | 'community' | 'animethemes'; tracks: MergedTrack[]; /** Release language (Telugu, Hindi...), when known. */ language?: string; releaseDate?: string; /** The date is exact (a season's start), so it only matches the season that aired that year. */ exactYear?: boolean; /** Only set when a season was requested: does this section belong to it? */ scope?: 'match' | 'unspecified' }
export interface AlbumWithTracks { album: CatalogAlbum; tracks: CatalogTrack[] }
export interface MergedSoundtrack {
  sections: MergedSection[];
  wikipedia?: { title: string; url: string };
  albums: CatalogAlbum[];
  /** Albums/playlists that were found but dropped because neither artist nor songs matched this title. */
  skipped: Array<{ name: string; platform: string; reason: string }>;
  counts: { green: number; amber: number; red: number; total: number };
  /** Languages of the releases found, with song counts. */
  languages: Array<{ language: string; songs: number }>;
  /** How we know the albums belong to this title: the film's composer (TMDB), a Wikipedia tracklist, or 'none' (matched by name only). */
  verified: 'composer' | 'wikipedia' | 'title' | 'none';
  /** Set when the list was scoped to one season. */
  season?: { number: number; airYear?: number; excluded: number };
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
  // (MusicBrainz releases are admitted BY the composer match, so that match cannot also confirm them.)
  const inCatalog = kinds.has('apple') || kinds.has('deezer');
  if (kinds.size === 1 && inCatalog && evidence.some((e) => e.source === 'credits')) return 'green';
  return kinds.size === 1 ? 'amber' : 'red';
}

function unionArtists(a: string[], b: string[]): string[] {
  const seen = new Map<string, string>();
  for (const n of [...a, ...b]) { const k = normalizeArtist(n); if (k && !seen.has(k)) seen.set(k, n); }
  return [...seen.values()];
}

/**
 * A film often has a Telugu, a Hindi and a Tamil album: same composer, same music, different titles/scripts. Titles cannot link them,
 * so songs in releases of DIFFERENT languages are linked as a "probable" version when they share the track number and have almost the
 * same length (dubs keep the music). Never used to raise confidence; the UI says "probably".
 */
export function linkVersions(sections: MergedSection[], toleranceSec = 3): void {
  const withLang = sections.filter((s) => s.language);
  if (new Set(withLang.map((s) => s.language)).size < 2) return;
  for (const a of withLang) for (const t of a.tracks) {
    if (!t.lengthSec || t.lengthSec < 60 || !t.no) continue;
    for (const b of withLang) {
      if (b.language === a.language) continue;
      const hit = b.tracks.find((u) => u.no === t.no && u.lengthSec && Math.abs(u.lengthSec - t.lengthSec!) <= toleranceSec && u.key !== t.key);
      if (hit && !(t.versions ?? []).some((v) => v.language === b.language)) (t.versions ??= []).push({ language: b.language!, title: hit.title, section: b.name });
    }
  }
}

export function mergeSoundtrack(wiki: Soundtrack | null, fetched: AlbumWithTracks[], opts: { partial?: boolean; composers?: string[]; skipped?: MergedSoundtrack['skipped']; titleVerified?: boolean; animeThemes?: AnimeThemesEntry[]; mbReleases?: MbRelease[]; season?: { number: number; airYear?: number; excluded?: number } } = {}): MergedSoundtrack {
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
      if (tracks.length) sections.push({ name: sec.name, origin: 'wikipedia', tracks, language: languageFromName(sec.name) });
    }
  }

  // 1b. AnimeThemes: the anime's real opening/ending songs, one section per season/cour (year and season are on the entry).
  for (const entry of opts.animeThemes ?? []) {
    const tracks: MergedTrack[] = [];
    let n = 0;
    for (const th of entry.themes) {
      n++;
      const key = trackKey(th.title);
      const ev: Evidence = { source: 'animethemes', label: `AnimeThemes: ${entry.name} ${th.slug}`, url: th.url };
      const known = byKey.get(key);
      if (known) { addEvidence(known, ev); continue; }
      const m: MergedTrack = { key, no: th.sequence ?? n, title: th.title, artists: th.artists, confidence: 'amber', evidence: [ev], links: {} };
      byKey.set(key, m); tracks.push(m);
    }
    if (tracks.length) sections.push({ name: `Openings and endings · ${entry.name}${entry.year ? ` (${entry.year}${entry.season ? ' ' + entry.season : ''})` : ''}`, origin: 'animethemes', tracks, releaseDate: entry.year ? `${entry.year}-${({ Winter: '01', Spring: '04', Summer: '07', Fall: '10' } as Record<string, string>)[entry.season ?? ''] ?? '06'}-01` : undefined, exactYear: true });
  }

  // 2. Catalog albums: add evidence and direct links to known songs; unknown songs go in their own album section.
  // Songs of catalog albums by release date: lets a MusicBrainz release of the SAME date match them by position + length when titles differ in script.
  const byDate = new Map<string, Array<{ t: MergedTrack; no: number; len?: number }>>();
  const albums = fetched.filter((f) => f.album.kind === 'album');
  const playlists = fetched.filter((f) => f.album.kind === 'playlist');
  for (const { album, tracks } of albums) {
    const src = album.platform === 'apple' ? 'apple' : 'deezer';
    const ev: Evidence = { source: src, label: `${PLATFORM_LABEL[album.platform]}: ${album.name}`, url: album.url };
    const fresh: MergedTrack[] = [];
    for (const t of tracks) {
      const key = trackKey(t.title);
      const known = byKey.get(key);
      let merged: MergedTrack;
      if (known) {
        addEvidence(known, ev);
        known.links[src] ??= t.url;
        known.art ??= t.art ?? album.art;
        known.artists = unionArtists(known.artists, t.artists);
        known.lengthSec ??= t.lengthSec;
        merged = known;
      } else {
        const m: MergedTrack = { key, no: t.no, title: t.title, artists: t.artists, lengthSec: t.lengthSec, confidence: 'amber', evidence: [ev], links: { [src]: t.url }, art: t.art ?? album.art };
        byKey.set(key, m); fresh.push(m); merged = m;
      }
      const day = album.releaseDate?.slice(0, 10);
      if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) { const list = byDate.get(day) ?? []; list.push({ t: merged, no: t.no, len: t.lengthSec }); byDate.set(day, list); }
    }
    if (fresh.length) sections.push({ name: `${PLATFORM_LABEL[album.platform]}: ${album.name}`, origin: 'catalog', tracks: fresh, releaseDate: album.releaseDate, language: languageFromName(album.name) });
  }

  // 2b. MusicBrainz: the release database. Adds an independent confirmation plus the paper trail (ISRC, label, barcode, date).
  for (const rel of opts.mbReleases ?? []) {
    const ev: Evidence = { source: 'musicbrainz', label: `MusicBrainz: ${rel.title}${rel.label ? ` (${rel.label}${rel.date ? ', ' + rel.date : ''})` : rel.date ? ` (${rel.date})` : ''}`, url: rel.url };
    const proofOf = (isrc: string | undefined): ReleaseProof => ({ isrc, label: rel.label, upc: rel.barcode, releaseDate: rel.date, release: rel.title, releaseUrl: rel.url });
    const fresh: MergedTrack[] = [];
    for (const t of rel.tracks) {
      const key = trackKey(t.title);
      // Same release date + same track number + length within 2 s = the same recording even when the title is in another script.
      const samePos = !byKey.has(key) && rel.date && t.lengthSec ? (byDate.get(rel.date.slice(0, 10)) ?? []).find((x) => x.no === t.no && x.len !== undefined && Math.abs(x.len - t.lengthSec!) <= 2)?.t : undefined;
      const known = byKey.get(key) ?? samePos;
      if (known) {
        addEvidence(known, ev);
        known.proof ??= proofOf(t.isrcs[0]);
        if (!known.proof.isrc && t.isrcs[0]) known.proof.isrc = t.isrcs[0];
        known.lengthSec ??= t.lengthSec;
        known.artists = unionArtists(known.artists, t.artists);
      } else {
        const m: MergedTrack = { key, no: t.no, title: t.title, artists: t.artists, lengthSec: t.lengthSec, confidence: 'amber', evidence: [ev], links: {}, proof: proofOf(t.isrcs[0]) };
        byKey.set(key, m); fresh.push(m);
      }
    }
    if (fresh.length) sections.push({ name: `MusicBrainz: ${rel.title}`, origin: 'catalog', tracks: fresh, releaseDate: rel.date, language: rel.language ?? languageFromName(rel.title) });
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
    if (fresh.length) sections.push({ name: `Community playlist (unverified): ${album.name}`, origin: 'community', tracks: fresh, releaseDate: album.releaseDate });
  }

  // 4. Artist check: a song credited to the film's composer (per TMDB) gets one extra, independent piece of evidence.
  for (const t of byKey.values()) {
    const hit = (opts.composers ?? []).find((c) => t.artists.some((a) => artistMatches(a, c)));
    if (hit) addEvidence(t, { source: 'credits', label: `Credited artist matches the film's composer, ${hit} (TMDB credits)` });
  }

  // Season scoping: keep sections that belong to the requested season (or say nothing), drop those naming other seasons.
  let kept = sections; let excluded = 0;
  if (opts.season) {
    kept = [];
    for (const sec of sections) {
      const fit: SeasonFit = classifyForSeason(sec.name, sec.releaseDate, opts.season.number, opts.season.airYear, sec.exactYear ? 0 : 1);
      if (fit === 'excluded') { excluded++; continue; }
      sec.scope = fit; kept.push(sec);
    }
  }
  // With no composer and no Wikipedia list, an album is matched by its NAME only ("Kingdom" fits many works): never call that trustworthy.
  const verified: MergedSoundtrack['verified'] = (opts.composers ?? []).length ? 'composer' : wiki ? 'wikipedia' : opts.titleVerified || (opts.animeThemes ?? []).length ? 'title' : 'none';
  const counts = { green: 0, amber: 0, red: 0, total: 0 };
  for (const t of byKey.values()) {
    t.confidence = confidenceOf(t.evidence);
    if (verified === 'none' && t.confidence === 'amber') t.confidence = 'red';
  }
  for (const sec of kept) for (const t of sec.tracks) { counts[t.confidence]++; counts.total++; }
  linkVersions(kept);
  const langCount = new Map<string, number>();
  for (const sec of kept) if (sec.language) langCount.set(sec.language, (langCount.get(sec.language) ?? 0) + sec.tracks.length);
  return {
    languages: [...langCount].map(([language, songs]) => ({ language, songs })).sort((a, b) => b.songs - a.songs),
    sections: kept, season: opts.season ? { number: opts.season.number, airYear: opts.season.airYear, excluded: (opts.season.excluded ?? 0) + excluded } : undefined, wikipedia: wiki ? { title: wiki.page.title, url: wiki.page.url } : undefined,
    albums: fetched.map((f) => f.album), skipped: opts.skipped ?? [], verified, counts, partial: !!opts.partial,
  };
}
