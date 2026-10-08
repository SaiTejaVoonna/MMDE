import type { RecordingCandidate } from '../domain/types.ts';
import { createRateLimiter, type RecordingResolver } from './types.ts';

// Live-verified once from GitHub Actions (2026-10-08): the API answers and returns ISRCs.
// Rules from MusicBrainz docs: <= 1 request/second per IP, meaningful User-Agent (browsers cannot set it).
// Core data is CC0; do not store the supplementary (CC BY-NC-SA) data.
// Findings from the first live run that shaped this file:
//  - requiring `artist:"<latin name>"` returned 0 hits when the artist is credited in Japanese script,
//    so we retry by title only and match artists client-side (names + sort-name variants);
//  - HTTP 503 happens on shared runner IPs, so we back off and retry.
interface MbArtist { name?: string; 'sort-name'?: string }
interface MbRecording {
  id: string;
  title: string;
  length?: number;
  disambiguation?: string;
  isrcs?: string[];
  'artist-credit'?: Array<{ name: string; artist?: MbArtist }>;
}

/** "Terashima, Takuma" -> "Takuma Terashima" (MusicBrainz sort names are Latin even for Japanese credits). */
export function sortNameToName(sortName: string): string {
  const [last, first] = sortName.split(',').map((s) => s.trim());
  return last && first ? `${first} ${last}` : sortName.trim();
}

function creditNames(r: MbRecording): string[] {
  const names = new Set<string>();
  for (const c of r['artist-credit'] ?? []) {
    if (c.name) names.add(c.name);
    if (c.artist?.name) names.add(c.artist.name);
    if (c.artist?.['sort-name']) names.add(sortNameToName(c.artist['sort-name']));
  }
  return [...names];
}

export interface MbOptions { intervalMs?: number; backoffMs?: number; retries?: number }

export function musicBrainzResolver(userAgent: string | null, fetchImpl: typeof fetch = fetch, opts: MbOptions = {}): RecordingResolver {
  const wait = createRateLimiter(opts.intervalMs ?? 1100);
  const backoff = opts.backoffMs ?? 2000;
  const retries = opts.retries ?? 2;
  const clean = (s: string) => s.replace(/"/g, '');

  async function search(query: string): Promise<MbRecording[]> {
    const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=25&inc=isrcs+artist-credits`;
    for (let attempt = 0; ; attempt++) {
      await wait();
      const res = await fetchImpl(url, { headers: { ...(userAgent ? { 'User-Agent': userAgent } : {}), Accept: 'application/json' } });
      if (res.status === 503 && attempt < retries) {
        await new Promise((r) => setTimeout(r, backoff * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} from MusicBrainz`);
      return ((await res.json()) as { recordings?: MbRecording[] }).recordings ?? [];
    }
  }

  return {
    name: 'musicbrainz',
    async resolve(title: string, artists: string[]): Promise<RecordingCandidate[]> {
      const byTitle = `recording:"${clean(title)}"`;
      let found = artists[0] ? await search(`${byTitle} AND artist:"${clean(artists[0])}"`) : [];
      if (found.length === 0) found = await search(byTitle); // artist may be credited in another script
      return found.map((r) => ({
        title: r.title,
        artists: creditNames(r),
        durationSec: r.length ? Math.round(r.length / 1000) : undefined,
        mbid: r.id,
        isrcs: r.isrcs ?? [],
        disambiguation: r.disambiguation,
        source: 'musicbrainz',
      }));
    },
  };
}
