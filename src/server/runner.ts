import type { DiscoveryResult, Media, Release, TrackView } from '../domain/types.ts';
import { buildTracks, collectClaims, discoveryTargets } from '../app/discover.ts';
import { buildLinks } from '../links/platforms.ts';
import type { DiscoveryProvider, LinkResolver, RecordingResolver } from '../providers/types.ts';

export interface Deps { providers: DiscoveryProvider[]; recordingResolver?: RecordingResolver; linkResolvers: LinkResolver[] }
export type StepKey = 'media' | 'themes' | 'releases' | 'matching' | 'links';
export type StepState = 'pending' | 'running' | 'done' | 'error';
export interface Step { key: StepKey; label: string; state: StepState; detail?: string }
export const STEP_LABELS: Record<StepKey, string> = {
  media: 'Resolving media information', themes: 'Finding theme songs and inserts',
  releases: 'Discovering soundtrack releases', matching: 'Matching tracks and artists', links: 'Fetching platform links',
};
export function newSteps(): Step[] {
  return (Object.keys(STEP_LABELS) as StepKey[]).map((key) => ({ key, label: STEP_LABELS[key], state: 'pending' as const }));
}
const msg = (e: unknown) => e instanceof Error ? e.message : String(e);

export async function runDiscovery(media: Media, deps: Deps, onStep: (key: StepKey, state: StepState, detail?: string) => void): Promise<DiscoveryResult> {
  const errors: string[] = [];
  const targets = discoveryTargets(media);
  onStep('media', 'done', `${media.title} · ${targets.length} related productions`);

  onStep('themes', 'running');
  const collected = await collectClaims(media, deps.providers);
  errors.push(...collected.errors);
  onStep('themes', 'done', `${collected.claims.length} claims from ${deps.providers.length} sources across ${targets.length} productions`);

  onStep('releases', 'running');
  const releases: Release[] = [];
  for (const p of deps.providers) {
    if (!p.releases) continue;
    for (const target of targets) {
      try { releases.push(...(await p.releases(target))); }
      catch (e) { errors.push(`${p.name} (releases) [${target.title}]: ${msg(e)}`); }
    }
  }
  onStep('releases', 'done', `${releases.length} releases`);

  onStep('matching', 'running');
  const built = await buildTracks(media, collected.claims, deps.recordingResolver);
  errors.push(...built.errors);
  onStep('matching', 'done', `${built.tracks.length} tracks`);

  onStep('links', 'running');
  const tracks: TrackView[] = [];
  for (const t of built.tracks) {
    const resolved: ReturnType<LinkResolver['resolve']> extends Promise<infer X> ? X : never[] = [];
    for (const lr of deps.linkResolvers) {
      try { resolved.push(...await lr.resolve(t)); } catch (e) { errors.push(`${lr.name}: ${msg(e)}`); }
    }
    tracks.push({ ...t, links: buildLinks(t, resolved) });
  }
  onStep('links', 'done', `${tracks.length} tracks linked`);
  return {
    media, tracks, releases, errors: [...new Set(errors)],
    sources: [...new Set([...deps.providers.map((p) => p.name), ...(deps.recordingResolver ? [deps.recordingResolver.name] : [])])],
    generatedAt: new Date().toISOString(),
  };
}
