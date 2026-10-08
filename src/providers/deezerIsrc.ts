import { createRateLimiter } from './types.ts';

// Per-song ISRC from Deezer's public track endpoint (no key). Used to add the recording's "barcode" to songs MusicBrainz
// does not list (Indian film releases usually have no ISRC there). One request per song, throttled well under Deezer's reported ~50 per 5 s.
// MMDE only reads the code to show it; it never hosts or plays anything. Cached 24 h like the other catalog lookups.
export function deezerIsrcResolver(userAgent: string, fetchImpl: typeof fetch = fetch, opts: { intervalMs?: number } = {}) {
  const wait = createRateLimiter(opts.intervalMs ?? 300);
  const cache = new Map<string, { at: number; value: string | null }>();
  return async function isrcOf(id: string): Promise<string | null> {
    if (!/^\d{1,15}$/.test(id)) throw new Error('invalid id');
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < 86_400_000) return hit.value;
    await wait();
    const res = await fetchImpl(`https://api.deezer.com/track/${id}`, { headers: { Accept: 'application/json', 'User-Agent': userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Deezer`);
    const d = (await res.json()) as { isrc?: unknown; error?: unknown };
    if (d.error) throw new Error('Deezer reported an error for this track');
    const isrc = typeof d.isrc === 'string' && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(d.isrc.trim()) ? d.isrc.trim().toUpperCase() : null;
    cache.set(id, { at: Date.now(), value: isrc });
    if (cache.size > 5000) cache.delete(cache.keys().next().value as string);
    return isrc;
  };
}
