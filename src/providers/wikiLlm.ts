import type { Media, PartRef, TrackClaim, TrackRole } from '../domain/types.ts';
import { normalizeTitle } from '../matching/normalize.ts';
import type { DiscoveryProvider } from './types.ts';

// "Wikipedia + LLM" extractor. NOT TESTED LIVE (sandbox egress blocked; needs an LLM key).
// Wikipedia text is CC BY-SA: keep the attribution URL in the evidence.
// Anti-hallucination guard: a claim is kept ONLY if its quote appears verbatim in the page
// text AND the quote contains the claimed title. Everything it yields is a single source,
// so it can never reach "confirmed" by itself.
const ROLES = new Set<TrackRole>(['opening', 'ending', 'insert', 'character', 'ost', 'score', 'promo', 'other']);
const PART_KINDS = new Set(['season', 'movie', 'special', 'ova', 'whole']);

export type Complete = (prompt: string) => Promise<string>;

const PROMPT = (title: string, text: string) => `You extract music facts about the media "${title}" from the page text below.
Return ONLY a JSON array. Each item: {"part":{"kind":"season|movie|special|ova|whole","number":<int|null>},"role":"opening|ending|insert|character|ost|score|promo|other","position":"OP1|ED2|...|null","title":"<song title>","artists":["<artist>"],"quote":"<exact verbatim sentence or fragment from the text that states this>"}
Rules: use ONLY what the text states; never guess; if unsure, omit the item; "quote" must be copied exactly from the text.
TEXT:
${text}`;

export function parseClaims(raw: string, pageText: string, url: string, now: string, provider = 'wikipedia+llm'): TrackClaim[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let items: unknown;
  try { items = JSON.parse(raw.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(items)) return [];
  const haystack = normalizeTitle(pageText.replace(/\s+/g, ' '));
  const out: TrackClaim[] = [];
  for (const it of items as Array<Record<string, unknown>>) {
    const title = typeof it.title === 'string' ? it.title.trim() : '';
    const quote = typeof it.quote === 'string' ? it.quote.trim() : '';
    const role = it.role as TrackRole;
    const part = it.part as { kind?: string; number?: number | null } | undefined;
    if (!title || !quote || !ROLES.has(role) || !part || !PART_KINDS.has(part.kind ?? '')) continue;
    const nq = normalizeTitle(quote.replace(/\s+/g, ' '));
    if (!nq || !haystack.includes(nq)) continue; // quote must really be in the page
    if (!nq.includes(normalizeTitle(title))) continue; // and must mention the song
    const artists = Array.isArray(it.artists) ? (it.artists as unknown[]).filter((a): a is string => typeof a === 'string') : [];
    const ref: PartRef = { kind: part.kind as PartRef['kind'], ...(typeof part.number === 'number' ? { number: part.number } : {}) };
    out.push({ part: ref, role, position: typeof it.position === 'string' ? it.position : undefined, title, artists, evidence: { provider, url, quote, fetchedAt: now } });
  }
  return out;
}

export function wikiLlmProvider(opts: { complete: Complete; userAgent?: string; fetchImpl?: typeof fetch; now?: () => string; maxPages?: number }): DiscoveryProvider {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date().toISOString());
  const api = 'https://en.wikipedia.org/w/api.php';
  const get = async (params: Record<string, string>) => {
    const res = await f(`${api}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`, { headers: opts.userAgent ? { 'User-Agent': opts.userAgent } : {} });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Wikipedia`);
    return (await res.json()) as any;
  };
  return {
    name: 'wikipedia+llm',
    async discover(media: Media): Promise<TrackClaim[]> {
      const found = await get({ action: 'query', list: 'search', srsearch: `${media.title} ${media.type === 'anime' ? 'anime' : ''}`.trim(), srlimit: String(opts.maxPages ?? 3) });
      const titles: string[] = (found.query?.search ?? []).map((r: { title: string }) => r.title);
      const claims: TrackClaim[] = [];
      for (const t of titles) {
        const page = await get({ action: 'query', prop: 'extracts', explaintext: '1', exlimit: '1', titles: t });
        const text: string = (Object.values(page.query?.pages ?? {})[0] as { extract?: string } | undefined)?.extract ?? '';
        if (!text) continue;
        const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`;
        const raw = await opts.complete(PROMPT(media.title, text.slice(0, 30000)));
        claims.push(...parseClaims(raw, text, url, now()));
      }
      return claims;
    },
  };
}

/** Real LLM call via the Anthropic Messages API. Needs ANTHROPIC_API_KEY; untested live. */
export function anthropicComplete(apiKey: string, model = 'claude-haiku-5-5', fetchImpl: typeof fetch = fetch, browser = false): Complete {
  return async (prompt) => {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(browser ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}) },
      body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Anthropic API`);
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  };
}
