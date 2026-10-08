import type { Media } from '../domain/types.ts';
import { buildDiagnostics } from '../browser/diagnostics.ts';
import type { MediaResolver } from '../providers/types.ts';
import { runDiscovery, type Deps } from '../server/runner.ts';
import { mergeMediaResults } from './media.ts';

export interface DiagnoseDeps {
  mediaResolvers: MediaResolver[];
  run: Deps;
  modeLabel: string;
  live?: boolean;
  now?: () => string;
}

export interface TitleDiagnosis {
  query: string;
  text: string;
  summary: { title: string; tracks: number; confirmed: number; suggested: number; unverified: number; errors: number };
}

/**
 * Headless version of "search -> pick first result -> discover -> Copy diagnostics".
 * Same pipeline the UI runs; used by the CI workflow so results can be read from the repo.
 */
export async function diagnoseTitle(query: string, deps: DiagnoseDeps): Promise<TitleDiagnosis> {
  const now = deps.now ?? (() => new Date().toISOString());
  const errors: string[] = [];
  const results: Media[] = [];
  for (const r of deps.mediaResolvers) {
    try { results.push(...(await r.search(query))); }
    catch (e) { errors.push(`${r.name}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  const mergedResults = mergeMediaResults(results);
  let enrichedResults = mergedResults;
  const lastSearch = { query, sources: deps.mediaResolvers.map((r) => r.name), errors, count: enrichedResults.length };
  const canonical = enrichedResults[0];
  const anilist = deps.mediaResolvers.find((r) => r.name === 'anilist');
  if (canonical && anilist) {
    try { enrichedResults = mergeMediaResults([...enrichedResults, ...(await anilist.search(canonical.title))]); }
    catch (e) { errors.push(`anilist enrichment: ${e instanceof Error ? e.message : String(e)}`); }
  }
  const media = enrichedResults[0];
  if (!media) {
    return {
      query,
      text: `MMDE DIAGNOSTICS\ngenerated: ${now()}\nmode: ${deps.modeLabel}\nLAST SEARCH: "${query}" -> 0 results from [${lastSearch.sources.join(', ')}]; errors: ${errors.join(' | ') || 'none'}\nNo media found, nothing to discover.`,
      summary: { title: '(no results)', tracks: 0, confirmed: 0, suggested: 0, unverified: 0, errors: errors.length },
    };
  }
  const result = await runDiscovery(media, deps.run, () => {});
  const c = { confirmed: 0, suggested: 0, unverified: 0 };
  for (const t of result.tracks) c[t.status]++;
  return {
    query,
    text: buildDiagnostics(result, { modeLabel: deps.modeLabel, live: deps.live ?? true, hasApiKey: deps.run.providers.some((p) => p.name === 'wikipedia+llm'), now: now(), lastSearch }),
    summary: { title: media.title, tracks: result.tracks.length, ...c, errors: result.errors.length + errors.length },
  };
}
