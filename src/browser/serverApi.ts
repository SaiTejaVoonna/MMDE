import type { Api, ResultView } from './api.ts';

/** Client for the optional Node server (src/server). Used when the page is served over http(s) by it. */
export function createServerApi(baseUrl = ''): Api {
  const base = baseUrl.replace(/\/+$/, '');
  const call = async (path: string, init?: RequestInit) => {
    const r = await fetch(base + path, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error((j as { error?: string }).error || `HTTP ${r.status}`), { status: r.status });
    return j;
  };
  return {
    modeLabel: base ? `server (${base})` : 'server (same origin)',
    async search(q) { return call(`/api/search?q=${encodeURIComponent(q)}`) as never; },
    async getSeasons(media) {
      const id = encodeURIComponent(media.id);
      const result = (await call(`/api/seasons/${id}`)) as { seasons: Array<{ seasonNumber: number; name: string; airDate?: string; episodeCount: number; posterPath?: string }> };
      return result.seasons;
    },
    async getResult(id) {
      try { return (await call(`/api/media/${encodeURIComponent(id)}`)) as ResultView; }
      catch (e) { if ((e as { status?: number }).status === 404) return null; throw e; }
    },
    async discover(media, onJob) {
      const { jobId } = (await call('/api/discover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ media }) })) as { jobId: string };
      for (;;) {
        const job = (await call(`/api/jobs/${jobId}`)) as { state: string; steps: never[]; error?: string };
        onJob({ steps: job.steps });
        if (job.state === 'error') throw new Error(job.error || 'discovery failed');
        if (job.state === 'done') break;
        await new Promise((r) => setTimeout(r, 500));
      }
      return (await call(`/api/media/${encodeURIComponent(media.id)}`)) as ResultView;
    },
  };
}
