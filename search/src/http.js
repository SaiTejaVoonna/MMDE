// Polite fetch: retry on rate limiting / transient errors, honouring Retry-After. Works in browser and Node.
const RETRY = new Set([429, 502, 503, 504]);

export async function fetchRetry(fetchImpl, url, init, { retries = 3, baseMs = 1500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, init);
    if (!RETRY.has(res.status) || attempt >= retries) return res;
    const ra = Number(res.headers?.get?.('retry-after'));
    await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : baseMs * 2 ** attempt);
  }
}
