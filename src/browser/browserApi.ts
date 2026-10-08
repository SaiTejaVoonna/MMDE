import type { DiscoveryResult, Media } from '../domain/types.ts';
import { organize } from '../app/organize.ts';
import { mergeMediaResults } from '../app/media.ts';
import { aniListResolver } from '../providers/anilist.ts';
import { jikanResolver } from '../providers/jikan.ts';
import { wikipediaResolver } from '../providers/wikipedia.ts';
import { tmdbResolver, tmdbSeasons } from '../providers/tmdb.ts';
import { animeThemesProvider } from '../providers/animethemes.ts';
import { curatedProvider, type SeedFile } from '../providers/curated.ts';
import { musicBrainzResolver } from '../providers/musicbrainz.ts';
import { seedMediaResolver } from '../providers/seedResolver.ts';
import type { DiscoveryProvider, MediaResolver } from '../providers/types.ts';
import { anthropicComplete, wikiLlmProvider } from '../providers/wikiLlm.ts';
import { normalizeTitle } from '../matching/normalize.ts';
import { newSteps, runDiscovery, type Step } from '../server/runner.ts';
import type { Api, ResultView, Settings } from './api.ts';

const SETTINGS_KEY = 'mmde.settings.v1';
const RESULTS_KEY = 'mmde.results.v1';

function safeStorage(storage?: Storage): Storage | undefined {
  try { const s = storage ?? globalThis.localStorage; s.getItem('x'); return s; } catch { return undefined; }
}

export function createBrowserApi(opts: { seeds: SeedFile[]; fetchImpl?: typeof fetch; storage?: Storage }): Api {
  const store = safeStorage(opts.storage);
  const memory = new Map<string, DiscoveryResult>();
  const f: typeof fetch = opts.fetchImpl ?? ((...a) => fetch(...a));
  const readSettings = (): Settings => {
    try { return { live: true, anthropicKey: '', tmdbToken: '', ...JSON.parse(store?.getItem(SETTINGS_KEY) ?? '{}') }; }
    catch { return { live: true, anthropicKey: '', tmdbToken: '' }; }
  };
  const readResults = (): Record<string, DiscoveryResult> => {
    try { return JSON.parse(store?.getItem(RESULTS_KEY) ?? '{}'); } catch { return {}; }
  };
  const view = (r: DiscoveryResult): ResultView => ({ ...r, groups: organize(r.tracks) });

  return {
    modeLabel: 'direct in browser (no server)',
    settings: { get: readSettings, set: (s) => { try { store?.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} } },
    async search(q) {
      const st = readSettings();
      const errors: string[] = [];
      if (st.tmdbToken) {
        try {
          const results = await tmdbResolver(st.tmdbToken, f).search(q);
          return { results, errors, sources: ['tmdb'] };
        } catch (e) {
          errors.push(`tmdb: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const results = await seedMediaResolver(opts.seeds).search(q);
      return { results, errors, sources: ['local'] };
    },
    async getResult(id) {
      const r = memory.get(id) ?? readResults()[id];
      return r ? view(r) : null;
    },
    async getSeasons(media) {
      const st = readSettings();
      if (!st.tmdbToken) return [];
      return tmdbSeasons(media, st.tmdbToken, f);
    },
    async discover(media, onJob) {
      const st = readSettings();
      const providers: DiscoveryProvider[] = opts.seeds.map((s) => curatedProvider(s));
      if (st.live) providers.push(animeThemesProvider(f));
      if (st.live && st.anthropicKey) providers.push(wikiLlmProvider({ complete: anthropicComplete(st.anthropicKey, undefined, f, true), fetchImpl: f }));
      const steps: Step[] = newSteps();
      const emit = () => onJob({ steps: steps.map((s) => ({ ...s })) });
      emit();
      const result = await runDiscovery(media, {
        providers,
        recordingResolver: st.live ? musicBrainzResolver(null, f) : undefined,
        linkResolvers: [],
      }, (key, state, detail) => {
        const s = steps.find((x) => x.key === key)!; s.state = state; s.detail = detail; emit();
      });
      memory.set(media.id, result);
      try { const all = readResults(); all[media.id] = result; store?.setItem(RESULTS_KEY, JSON.stringify(all)); } catch {}
      return view(result);
    },
  };
}
