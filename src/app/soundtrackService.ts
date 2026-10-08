import type { Soundtrack } from '../providers/wikiSoundtrack.ts';
import type { CatalogAlbum, CatalogPlatform, CatalogTrack } from '../providers/catalogAlbums.ts';
import { extraAlbumNames } from '../providers/catalogAlbums.ts';
import { mergeSoundtrack, type AlbumWithTracks, type MergedSoundtrack } from './soundtrackMerge.ts';

export interface SoundtrackSources {
  wiki: (title: string, year?: number) => Promise<Soundtrack | null>;
  albums: (title: string, year?: number, extraNames?: string[]) => Promise<CatalogAlbum[]>;
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
export async function buildMergedSoundtrack(src: SoundtrackSources, title: string, year?: number): Promise<MergedSoundtrack> {
  const [w, a] = await Promise.allSettled([src.wiki(title, year), src.albums(title, year)]);
  if (w.status === 'rejected' && a.status === 'rejected') throw w.reason;
  let partial = w.status === 'rejected' || a.status === 'rejected';
  const wiki = w.status === 'fulfilled' ? w.value : null;
  let all = a.status === 'fulfilled' ? a.value : [];
  // Wikipedia names albums the film-title search misses (e.g. "Baahubali (Original Soundtrack) - Volume 1"): search those too.
  const extras = wiki ? extraAlbumNames(wiki.sections.map((x) => x.name)) : [];
  if (extras.length) {
    try { const more = await src.albums(title, year, extras); const have = new Set(all.map((x) => `${x.platform}:${x.id}`)); all = [...all, ...more.filter((x) => !have.has(`${x.platform}:${x.id}`))]; }
    catch { partial = true; }
  }
  const pick = [...all.filter((x) => x.kind === 'album' && !x.viaWiki).slice(0, MAX_ALBUMS), ...all.filter((x) => x.kind === 'album' && x.viaWiki).slice(0, MAX_WIKI_ALBUMS), ...all.filter((x) => x.kind === 'playlist').slice(0, MAX_PLAYLISTS)];
  const results = await Promise.allSettled(pick.map((album) => withTimeout(src.albumTracks(album.platform, album.id), src.timeoutMs ?? 60_000).then((tracks): AlbumWithTracks => ({ album, tracks }))));
  const fetched: AlbumWithTracks[] = [];
  for (const r of results) { if (r.status === 'fulfilled') fetched.push(r.value); else partial = true; }
  return mergeSoundtrack(wiki, fetched, { partial });
}
