import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aniListResolver } from '../providers/anilist.ts';
import { jikanResolver } from '../providers/jikan.ts';
import { wikipediaResolver } from '../providers/wikipedia.ts';
import { animeThemesProvider } from '../providers/animethemes.ts';
import { curatedProvider } from '../providers/curated.ts';
import { tmdbResolver, tmdbSeasons, tmdbDetails, tmdbTrending } from '../providers/tmdb.ts';
import { wikiSoundtrack } from '../providers/wikiSoundtrack.ts';
import { trackLinkResolver } from '../providers/trackLinks.ts';
import { catalogResolver } from '../providers/catalogAlbums.ts';
import { animeThemesSource } from '../providers/animeThemesSearch.ts';
import { mbReleaseSource } from '../providers/mbReleases.ts';
import { deezerIsrcResolver } from '../providers/deezerIsrc.ts';
import { wikidataTitleSource } from '../providers/wikidataTitles.ts';
import { musicBrainzResolver } from '../providers/musicbrainz.ts';
import { loadSeeds, seedMediaResolver } from '../providers/seeds.ts';
import { anthropicComplete, wikiLlmProvider } from '../providers/wikiLlm.ts';
import { deezerResolver } from '../links/platforms.ts';
import { createApp } from './app.ts';
import { parseOrigins } from './cors.ts';
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
const tmdbToken = process.env.TMDB_READ_ACCESS_TOKEN;
// Test hook only (unset in real use): point TMDB calls at a fake server so scripts/doctor.mjs can be tested offline.
const tmdbTestBase = process.env.MMDE_TMDB_TEST_BASE;
const tmdbFetch: typeof fetch = tmdbTestBase ? ((u, i) => fetch(String(u).replace('https://api.themoviedb.org/3', tmdbTestBase), i)) : fetch;
if (tmdbToken && !offline) mediaResolvers.unshift(tmdbResolver(tmdbToken, tmdbFetch));
// Test hook only (unset in real use): point Wikipedia / iTunes / Deezer at fake servers (origin only, e.g. http://127.0.0.1:9912) for browser tests.
const hostMap: Array<[string, string | undefined]> = [
  ['https://en.wikipedia.org', process.env.MMDE_WIKI_TEST_BASE],
  ['https://itunes.apple.com', process.env.MMDE_ITUNES_TEST_BASE],
  ['https://api.deezer.com', process.env.MMDE_DEEZER_TEST_BASE],
  ['https://api.animethemes.moe', process.env.MMDE_ANIMETHEMES_TEST_BASE],
  ['https://musicbrainz.org', process.env.MMDE_MUSICBRAINZ_TEST_BASE],
  ['https://www.wikidata.org', process.env.MMDE_WIKIDATA_TEST_BASE],
];
const musicFetch: typeof fetch = hostMap.some(([, b]) => b)
  ? ((u, i) => { let url = String(u); for (const [from, to] of hostMap) if (to) url = url.replace(from, to); return fetch(url, i); })
  : fetch;
const linkResolvers = [];
let recordingResolver;

if (!offline) {
  mediaResolvers.push(aniListResolver(), jikanResolver(), wikipediaResolver());
  providers.push(animeThemesProvider());
  recordingResolver = musicBrainzResolver(userAgent);
  linkResolvers.push(deezerResolver());
  if (process.env.ANTHROPIC_API_KEY) {
    providers.push(wikiLlmProvider({ complete: anthropicComplete(process.env.ANTHROPIC_API_KEY, process.env.MMDE_MODEL), userAgent }));
  }
}

const port = Number(flag('port') ?? process.env.PORT ?? 8787);
// Frontend hosted on another site (GitHub Pages): list its exact origin(s). Unset = same-origin only.
const allowedOrigins = parseOrigins(process.env.MMDE_WEB_ORIGIN);
// Behind a reverse proxy (Railway) the socket peer is the proxy, so only then trust X-Forwarded-For.
const trustProxy = process.env.MMDE_TRUST_PROXY === '1' || !!(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT);
createApp({
  providers, mediaResolvers, recordingResolver, linkResolvers,
  tmdbToken, allowedOrigins, trustProxy,
  seasons: (media, token) => tmdbSeasons(media, token, tmdbFetch),
  details: (id, token) => tmdbDetails(id, token, tmdbFetch),
  trending: (kind, token) => tmdbTrending(token, kind, tmdbFetch),
  soundtrack: offline ? undefined : (title, year, alts) => wikiSoundtrack(userAgent, musicFetch).find(title, year, alts),
  trackLinks: offline ? undefined : ((r) => (q) => r.resolve(q))(trackLinkResolver(userAgent, musicFetch)),
  ...(offline ? {} : ((c, at, mb, wd) => ({ albums: c.findAlbums, albumTracks: c.tracks, animeThemes: at.find, musicBrainz: mb.find, wikidata: wd.find }))(catalogResolver(userAgent, musicFetch), animeThemesSource(userAgent, musicFetch), mbReleaseSource(userAgent, musicFetch), wikidataTitleSource(userAgent, musicFetch))),
  ...(offline ? {} : { deezerIsrc: deezerIsrcResolver(userAgent, musicFetch) }),
  store: jsonStore(join(root, 'data', 'store.json')), webRoot: join(root, 'web'),
}).listen(port, () => {
  console.log(`MMDE prototype on http://localhost:${port}  (${offline ? 'OFFLINE: local seeds only' : 'live providers enabled'})`);
  console.log(`seeds: ${seeds.map((s) => s.media.title).join(', ') || 'none'}`);
  // Booleans only: never print secret values.
  console.log(`TMDB configured: ${tmdbToken ? 'yes' : 'NO (set TMDB_READ_ACCESS_TOKEN; /api/seasons will return 503)'}`);
  console.log(`CORS allowed origins: ${allowedOrigins.length ? allowedOrigins.join(', ') : 'none (same-origin only; set MMDE_WEB_ORIGIN for a separate frontend)'}`);
  console.log(`trust proxy: ${trustProxy ? 'yes' : 'no'}`);
  if (process.env.ANTHROPIC_API_KEY && !offline) console.warn('WARNING: ANTHROPIC_API_KEY is set; every public /api/discover call can spend it. Rate limits apply, but consider leaving it unset on a public server.');
});
