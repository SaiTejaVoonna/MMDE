import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aniListResolver } from '../providers/anilist.ts';
import { animeThemesProvider } from '../providers/animethemes.ts';
import { curatedProvider } from '../providers/curated.ts';
import { musicBrainzResolver } from '../providers/musicbrainz.ts';
import { loadSeeds, seedMediaResolver } from '../providers/seeds.ts';
import { anthropicComplete, wikiLlmProvider } from '../providers/wikiLlm.ts';
import { deezerResolver } from '../links/platforms.ts';
import { createApp } from './app.ts';
import { jsonStore } from './store.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const offline = process.env.MMDE_OFFLINE === '1' || args.includes('--offline');
const contact = flag('contact') ?? process.env.MMDE_CONTACT ?? 'set MMDE_CONTACT';
const userAgent = `MMDE-prototype/0.2 (personal, non-commercial; ${contact})`;

const seeds = await loadSeeds(join(root, 'data', 'seeds'));
const providers = seeds.map((s) => curatedProvider(s));
const mediaResolvers = [seedMediaResolver(seeds)];
const linkResolvers = [];
let recordingResolver;

if (!offline) {
  mediaResolvers.push(aniListResolver());
  providers.push(animeThemesProvider());
  recordingResolver = musicBrainzResolver(userAgent);
  linkResolvers.push(deezerResolver());
  if (process.env.ANTHROPIC_API_KEY) {
    providers.push(wikiLlmProvider({ complete: anthropicComplete(process.env.ANTHROPIC_API_KEY, process.env.MMDE_MODEL), userAgent }));
  }
}

const port = Number(flag('port') ?? process.env.PORT ?? 8787);
createApp({
  providers, mediaResolvers, recordingResolver, linkResolvers,
  store: jsonStore(join(root, 'data', 'store.json')), webRoot: join(root, 'web'),
}).listen(port, () => {
  console.log(`MMDE prototype on http://localhost:${port}  (${offline ? 'OFFLINE: local seeds only' : 'live providers enabled'})`);
  console.log(`seeds: ${seeds.map((s) => s.media.title).join(', ') || 'none'}`);
});
