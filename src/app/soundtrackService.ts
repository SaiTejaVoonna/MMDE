import type { Soundtrack } from '../providers/wikiSoundtrack.ts';
import type { AnimeThemesEntry } from '../providers/animeThemesSearch.ts';
import type { MbRelease } from '../providers/mbReleases.ts';
import type { CatalogAlbum, CatalogPlatform, CatalogTrack } from '../providers/catalogAlbums.ts';
import { artistMatches, extraAlbumNames, nameMatchesDistinctiveTitle } from '../providers/catalogAlbums.ts';
import { trackKey } from './soundtrackMerge.ts';
import { classifyForSeason } from './seasonScope.ts';
import { mergeSoundtrack, type AlbumWithTracks, type MergedSoundtrack, type SourceStatus } from './soundtrackMerge.ts';

export interface SoundtrackSources {
  wiki: (title: string, year?: number, alts?: string[]) => Promise<Soundtrack | null>;
  albums: (title: string, year?: number, extraNames?: string[], alts?: string[]) => Promise<CatalogAlbum[]>;
  albumTracks: (platform: CatalogPlatform, id: string) => Promise<CatalogTrack[]>;
  /** Optional: the anime's opening/ending songs per season (AnimeThemes). Only called when the title is anime. */
  animeThemes?: (title: string, alts: string[], firstYear?: number) => Promise<AnimeThemesEntry[]>;
  /** Optional: official releases from MusicBrainz (label, barcode, date, language, ISRCs). */
  musicBrainz?: (title: string, alts: string[], composers: string[]) => Promise<MbRelease[]>;
  /** Optional: the title in other languages (Wikidata). Widens catalog searches only. */
  wikidata?: (title: string, year?: number, alts?: string[]) => Promise<string[]>;
  /** Optional: the composer(s) Wikidata lists for the film. Used only when TMDB lists none. */
  wikidataComposers?: (title: string, year?: number, alts?: string[]) => Promise<string[]>;
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
export function belongsToTitle(album: CatalogAlbum, tracks: CatalogTrack[], composers: string[], wiki: Soundtrack | null, titles: string[] = []): { ok: boolean; reason: string; byTitle?: boolean } {
  // A distinctive title ("炎炎ノ消防隊", "That Time I Got Reincarnated as a Slime") in the album name is strong evidence on its own:
  // composer names often differ in script between TMDB and the catalog. Short, common titles ("Kingdom") still need the composer.
  if (nameMatchesDistinctiveTitle(album.name, titles)) return { ok: true, reason: 'distinctive title match', byTitle: true };
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

export async function buildMergedSoundtrack(src: SoundtrackSources, title: string, year?: number, ctx: { composers?: string[]; alts?: string[]; anime?: boolean; fast?: boolean; /** Wikipedia only: the quickest first answer. Implies fast. */ wikiOnly?: boolean; season?: { number: number; airYear?: number } } = {}): Promise<MergedSoundtrack> {
  if (ctx.wikiOnly) ctx = { ...ctx, fast: true };
  let composers = ctx.composers ?? [];
  let composerSource: 'tmdb' | 'wikidata' | undefined = composers.length ? 'tmdb' : undefined;
  // Other-language names from Wikidata join the TMDB ones (one extra slot: catalogs are searched with the first 3, and each search costs a rate-limited call).
  // When TMDB lists no composer, Wikidata's composer for the same film and year fills the gap.
  let wd: string[] = [];
  if (!ctx.fast && (src.wikidata || (!composers.length && src.wikidataComposers))) {
    const [t, c] = await Promise.allSettled([src.wikidata ? withTimeout(src.wikidata(title, year, ctx.alts ?? []), 8000) : Promise.resolve([] as string[]), !composers.length && src.wikidataComposers ? withTimeout(src.wikidataComposers(title, year, ctx.alts ?? []), 8000) : Promise.resolve([] as string[])]);
    if (t.status === 'fulfilled') wd = t.value;
    if (c.status === 'fulfilled' && c.value.length) { composers = c.value; composerSource = 'wikidata'; }
  }
  const base = ctx.alts ?? [];
  const alts = [...new Set([...base.slice(0, 2), ...wd.filter((x) => !base.includes(x)).slice(0, 1), ...base.slice(2), ...wd.slice(1)])].slice(0, 8);
  const [w, a, at, mb] = await Promise.allSettled([src.wiki(title, year, alts), ctx.wikiOnly ? Promise.resolve([] as CatalogAlbum[]) : src.albums(title, year, undefined, alts), ctx.anime && !ctx.fast && src.animeThemes ? src.animeThemes(title, alts, year) : Promise.resolve([] as AnimeThemesEntry[]), src.musicBrainz && !ctx.fast ? src.musicBrainz(title, alts, composers) : Promise.resolve([] as MbRelease[])]);
  if (w.status === 'rejected' && a.status === 'rejected' && !(at.status === 'fulfilled' && at.value.length) && !(mb.status === 'fulfilled' && mb.value.length)) throw w.reason;
  let partial = w.status === 'rejected' || a.status === 'rejected';
  const wiki = w.status === 'fulfilled' ? w.value : null;
  let all = a.status === 'fulfilled' ? a.value : [];
  // Wikipedia names albums the film-title search misses (e.g. "Baahubali (Original Soundtrack) - Volume 1"): search those too.
  const extras = wiki ? extraAlbumNames(wiki.sections.map((x) => x.name)) : [];
  if (extras.length && !ctx.wikiOnly) {
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
  let titleVerified = false;
  for (const r of results) {
    if (r.status !== 'fulfilled') { partial = true; continue; }
    const v = belongsToTitle(r.value.album, r.value.tracks, composers, wiki, [title, ...alts]);
    if (v.ok && v.byTitle) titleVerified = true;
    if (v.ok) fetched.push(r.value); else skipped.push({ name: r.value.album.name, platform: r.value.album.platform, reason: v.reason });
  }
  const animeThemes = at.status === 'fulfilled' ? at.value : [];
  if (at.status === 'rejected') partial = true;
  const mbReleases = mb.status === 'fulfilled' ? mb.value : [];
  if (mb.status === 'rejected') partial = true;
  if (mbReleases.some((r) => nameMatchesDistinctiveTitle(r.title, [title, ...alts]))) titleVerified = true;
  const merged = mergeSoundtrack(wiki, fetched, { partial, composers, skipped, titleVerified, animeThemes, mbReleases, titles: [title, ...alts], season: ctx.season ? { ...ctx.season, excluded: preExcluded } : undefined });
  const state = (r: PromiseSettledResult<unknown>, n: number, skippedFast = false): SourceStatus['state'] => (skippedFast ? 'pending' : r.status === 'rejected' ? 'failed' : n > 0 ? 'ok' : 'empty');
  const sources: SourceStatus[] = [
    { key: 'wikipedia', label: 'Wikipedia', state: state(w, wiki ? 1 : 0), detail: wiki ? wiki.page.title : w.status === 'rejected' ? 'could not be reached' : 'no tracklist page found' },
    { key: 'catalog', label: 'Apple Music + Deezer', state: state(a, all.length, !!ctx.wikiOnly), detail: ctx.wikiOnly ? 'checking…' : a.status === 'rejected' ? 'could not be reached' : `${all.length} album${all.length === 1 ? '' : 's'}/playlist${skipped.length ? `, ${skipped.length} skipped (not this title)` : ''}` },
    { key: 'musicbrainz', label: 'MusicBrainz', state: state(mb, mbReleases.length, !!ctx.fast), detail: ctx.fast ? 'checking…' : mb.status === 'rejected' ? 'could not be reached' : mbReleases.length ? `${mbReleases.length} release${mbReleases.length === 1 ? '' : 's'} (label, date, ISRC)` : 'no release for this title' },
    ...(ctx.anime ? [{ key: 'animethemes' as const, label: 'AnimeThemes', state: state(at, animeThemes.length, !!ctx.fast), detail: ctx.fast ? 'checking…' : at.status === 'rejected' ? 'could not be reached' : animeThemes.length ? `${animeThemes.length} season entr${animeThemes.length === 1 ? 'y' : 'ies'}` : 'nothing found' }] : []),
    ...(src.wikidata ? [{ key: 'wikidata' as const, label: 'Wikidata names', state: ctx.fast ? 'pending' as const : wd.length ? 'ok' as const : 'empty' as const, detail: ctx.fast ? 'checking…' : wd.length ? `${wd.length} other-language title${wd.length === 1 ? '' : 's'}` : 'none found' }] : []),
  ];
  return { ...merged, sources, composers, composerSource };
}
