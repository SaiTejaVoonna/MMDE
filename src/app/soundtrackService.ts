import type { Soundtrack } from '../providers/wikiSoundtrack.ts';
import type { CatalogAlbum, CatalogPlatform, CatalogTrack } from '../providers/catalogAlbums.ts';
import { artistMatches, extraAlbumNames } from '../providers/catalogAlbums.ts';
import { trackKey } from './soundtrackMerge.ts';
import { classifyForSeason } from './seasonScope.ts';
import { mergeSoundtrack, type AlbumWithTracks, type MergedSoundtrack } from './soundtrackMerge.ts';

export interface SoundtrackSources {
  wiki: (title: string, year?: number, alts?: string[]) => Promise<Soundtrack | null>;
  albums: (title: string, year?: number, extraNames?: string[], alts?: string[]) => Promise<CatalogAlbum[]>;
  albumTracks: (platform: CatalogPlatform, id: string) => Promise<CatalogTrack[]>;
  /** Max time to wait for any one album's track list. Slower ones are skipped and the result is flagged partial. */
  timeoutMs?: number;
}

const MAX_ALBUMS = 4;
const MAX_WIKI_ALBUMS = 12; // albums named by Wikipedia itself (volumes of a score, language versions)
const MAX_PLAYLISTS = 2;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Collect from every source, then merge. A source that fails never sinks the others; only "all failed" is an error. */
/**
 * Does an album/playlist really belong to this title? Titles are ambiguous ("Kingdom"), so when TMDB tells us who composed the
 * music we require the artist to match (on the album or on any of its songs), or the songs to match the Wikipedia tracklist.
 */
export function belongsToTitle(album: CatalogAlbum, tracks: CatalogTrack[], composers: string[], wiki: Soundtrack | null): { ok: boolean; reason: string } {
  if (!composers.length) return { ok: true, reason: 'no composer known, matched by title only' };
  const artists = [album.artist, ...tracks.flatMap((t) => t.artists)];
  if (composers.some((c) => artists.some((a) => artistMatches(a, c)))) return { ok: true, reason: 'composer matches' };
  if (wiki && tracks.length) {
    const known = new Set(wiki.sections.flatMap((x) => x.tracks.map((t) => trackKey(t.title))));
    const hits = tracks.filter((t) => known.has(trackKey(t.title))).length;
    if (hits >= 2 || hits / tracks.length >= 0.25) return { ok: true, reason: 'songs match the Wikipedia tracklist' };
  }
  return { ok: false, reason: `artist "${album.artist || 'unknown'}" is not the film's composer (${composers.join(', ')}) and no songs match` };
}

export async function buildMergedSoundtrack(src: SoundtrackSources, title: string, year?: number, ctx: { composers?: string[]; alts?: string[]; season?: { number: number; airYear?: number } } = {}): Promise<MergedSoundtrack> {
  const composers = ctx.composers ?? []; const alts = ctx.alts ?? [];
  const [w, a] = await Promise.allSettled([src.wiki(title, year, alts), src.albums(title, year, undefined, alts)]);
  if (w.status === 'rejected' && a.status === 'rejected') throw w.reason;
  let partial = w.status === 'rejected' || a.status === 'rejected';
  const wiki = w.status === 'fulfilled' ? w.value : null;
  let all = a.status === 'fulfilled' ? a.value : [];
  // Wikipedia names albums the film-title search misses (e.g. "Baahubali (Original Soundtrack) - Volume 1"): search those too.
  const extras = wiki ? extraAlbumNames(wiki.sections.map((x) => x.name)) : [];
  if (extras.length) {
    try { const more = await src.albums(title, year, extras, alts); const have = new Set(all.map((x) => `${x.platform}:${x.id}`)); all = [...all, ...more.filter((x) => !have.has(`${x.platform}:${x.id}`))]; }
    catch { partial = true; }
  }
  // Season requested: albums that name only OTHER seasons are never fetched (saves time and keeps the list clean).
  let preExcluded = 0;
  if (ctx.season) { const before = all.length; all = all.filter((x) => classifyForSeason(x.name, x.releaseDate, ctx.season!.number, ctx.season!.airYear) !== 'excluded'); preExcluded = before - all.length; }
  const pick = [...all.filter((x) => x.kind === 'album' && !x.viaWiki).slice(0, MAX_ALBUMS), ...all.filter((x) => x.kind === 'album' && x.viaWiki).slice(0, MAX_WIKI_ALBUMS), ...all.filter((x) => x.kind === 'playlist').slice(0, MAX_PLAYLISTS)];
  const results = await Promise.allSettled(pick.map((album) => withTimeout(src.albumTracks(album.platform, album.id), src.timeoutMs ?? 60_000).then((tracks): AlbumWithTracks => ({ album, tracks }))));
  const fetched: AlbumWithTracks[] = [];
  const skipped: MergedSoundtrack['skipped'] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') { partial = true; continue; }
    const v = belongsToTitle(r.value.album, r.value.tracks, composers, wiki);
    if (v.ok) fetched.push(r.value); else skipped.push({ name: r.value.album.name, platform: r.value.album.platform, reason: v.reason });
  }
  return mergeSoundtrack(wiki, fetched, { partial, composers, skipped, season: ctx.season ? { ...ctx.season, excluded: preExcluded } : undefined });
}
