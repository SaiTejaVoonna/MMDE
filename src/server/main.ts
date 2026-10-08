import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aniListResolver } from '../providers/anilist.ts';
import { curatedProvider } from '../providers/curated.ts';
import { musicBrainzResolver } from '../providers/musicbrainz.ts';
import { loadSeeds, seedMediaResolver } from '../providers/seeds.ts';
import { anthropicComplete, wikiLlmProvider } from '../providers/wikiLlm.ts';
import { deezerResolver } from '../links/platforms.ts';
import { createApp } from './app.ts';
import { jsonStore } from './store.ts';

// Run:  node src/server/main.ts      (PORT=8787 by default)
// Env:  MMDE_OFFLINE=1      -> local seeds only, no network providers
//       MMDE_CONTACT=...    -> contact string put in the User-Agent (MusicBrainz requires a real one)
//       ANTHROPIC_API_KEY   -> enables the Wikipedia+LLM extractor (optional)
//       MMDE_MODEL          -> model for the extractor
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const offline = process.env.MMDE_OFFLINE === '1';
const userAgent = `MMDE-prototype/0.1 (personal, non-commercial; ${process.env.MMDE_CONTACT ?? 'set MMDE_CONTACT'})`;

const seeds = await loadSeeds(join(root, 'data', 'seeds'));
const providers = seeds.map((s) => curatedProvider(s));
const mediaResolvers = [seedMediaResolver(seeds)];
const linkResolvers = [];
let recordingResolver;

if (!offline) {
  mediaResolvers.push(aniListResolver());
  recordingResolver = musicBrainzResolver(userAgent);
  linkResolvers.push(deezerResolver());
  if (process.env.ANTHROPIC_API_KEY) {
    providers.push(wikiLlmProvider({ complete: anthropicComplete(process.env.ANTHROPIC_API_KEY, process.env.MMDE_MODEL), userAgent }));
  }
}

const port = Number(process.env.PORT ?? 8787);
createApp({ providers, mediaResolvers, recordingResolver, linkResolvers, store: jsonStore(join(root, 'data', 'store.json')), webRoot: join(root, 'web') })
  .listen(port, () => {
    console.log(`MMDE prototype on http://localhost:${port}  (${offline ? 'OFFLINE: local seeds only' : 'live providers enabled'})`);
    console.log(`seeds: ${seeds.map((s) => s.media.title).join(', ') || 'none'}`);
  });
