import type { RecordingCandidate } from '../domain/types.ts';
import { createRateLimiter, type RecordingResolver } from './types.ts';

// NOT TESTED LIVE (sandbox egress was blocked when written). Verify against the real API.
// Rules from MusicBrainz docs: <= 1 request/second per IP, meaningful User-Agent.
// Core data is CC0; do not store the supplementary (CC BY-NC-SA) data.
interface MbRecording {
  id: string;
  title: string;
  length?: number;
  disambiguation?: string;
  isrcs?: string[];
  'artist-credit'?: Array<{ name: string }>;
}

export function musicBrainzResolver(userAgent: string, fetchImpl: typeof fetch = fetch): RecordingResolver {
  const wait = createRateLimiter(1100);
  return {
    name: 'musicbrainz',
    async resolve(title: string, artists: string[]): Promise<RecordingCandidate[]> {
      await wait();
      const q = `recording:"${title.replace(/"/g, '')}"` + (artists[0] ? ` AND artist:"${artists[0].replace(/"/g, '')}"` : '');
      const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=10&inc=isrcs`;
      const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} from MusicBrainz`);
      const data = (await res.json()) as { recordings?: MbRecording[] };
      return (data.recordings ?? []).map((r) => ({
        title: r.title,
        artists: (r['artist-credit'] ?? []).map((a) => a.name),
        durationSec: r.length ? Math.round(r.length / 1000) : undefined,
        mbid: r.id,
        isrcs: r.isrcs ?? [],
        disambiguation: r.disambiguation,
        source: 'musicbrainz',
      }));
    },
  };
}
