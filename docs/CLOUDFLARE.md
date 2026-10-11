# MMDE on Cloudflare: setup and runbook

Status: **prepared, not deployed.** Written 2026-10-11 on branch `claude/cloudflare-foundation`. Nothing here has been deployed to Cloudflare or merged to `main`;
the deploy workflow only runs when a person starts it by hand. Sai decides when anything goes live.

```
Browser  ->  https://<name>.pages.dev            Cloudflare Pages: static files (web/), strict security headers (_headers)
   |
   |  fetch("https://mmde-api.<you>.workers.dev/api/...")      public address, set as MMDE_API_BASE_URL
   v
Cloudflare Worker "mmde-api" (src/worker/index.ts)      CORS allowlist, rate limits, optional KV cache, security headers
   |   Authorization: Bearer <TMDB token>               ONLY inside the Worker (a Cloudflare secret)
   v
TMDB / AniList / Wikipedia / Wikidata / MusicBrainz / Apple / Deezer / AnimeThemes / TVmaze
```

The existing discovery engine is unchanged. `src/worker/router.ts` is the same set of endpoints as `src/server/app.ts` (minus the PC-only job store and static
files), built from the same providers. The PC server (`npm start`) and the GitHub-Pages browser-only beta keep working.

## What you need (all free to start)
1. A Cloudflare account (cloudflare.com, free plan).
2. Your TMDB "API Read Access Token" (you already have one). **Paste it only into Cloudflare's secret screen or the `wrangler secret put` prompt. Never in chat, never in a file in the repo.**
3. Node 22 on the PC you run the commands from (you already have it).

## Step by step (PowerShell, in the MMDE folder)
```
git fetch origin
git checkout claude/cloudflare-foundation
npm ci
npx wrangler login                     # opens the browser; approve access to your Cloudflare account
npx wrangler secret put TMDB_READ_ACCESS_TOKEN     # paste the token when asked (it is hidden); it is stored encrypted at Cloudflare
```
Then edit **`wrangler.toml`** (it holds no secrets): set `MMDE_CONTACT` to your email (it goes into the User-Agent for MusicBrainz etc.). Leave `MMDE_WEB_ORIGIN` for later.
```
npx wrangler deploy                    # publishes the Worker; prints https://mmde-api.<your-subdomain>.workers.dev
```
Check it (use your printed address):
```
curl https://mmde-api.<your-subdomain>.workers.dev/api/health          # {"ok":true,"mode":"edge","tmdb":true,...}   tmdb:true means the secret is set
```
Now the website:
1. Cloudflare dashboard > **Workers & Pages > Create > Pages > Connect to Git** > pick `SaiTejaVoonna/MMDE`.
2. Project name `mmde` (any name works; it becomes `mmde.pages.dev`).
3. Production branch: whatever Sai decides (`main` once merged; for a trial pick `claude/cloudflare-foundation`).
4. Build command: `npm ci && npm run build:web && node scripts/pages-build.mjs`     Build output directory: `dist/pages`
5. Environment variables (plain, not secret): `MMDE_API_BASE_URL` = your Worker address (https, no trailing path), `NODE_VERSION` = `22`.
6. Save and deploy. Open `https://mmde.pages.dev` on your phone.
7. Last step, so the Worker accepts the site: edit `wrangler.toml` `MMDE_WEB_ORIGIN = "https://mmde.pages.dev"` and run `npx wrangler deploy` again. Until then the browser gets "origin not allowed".

Optional shared cache (recommended once real people use it):
```
npx wrangler kv namespace create CACHE      # prints an id
```
Uncomment the `[[kv_namespaces]]` block in `wrangler.toml`, paste the id, `npx wrangler deploy`. Without it everything still works; each Worker instance just keeps a small memory cache.

Without a Worker (browser-only mode): leave `MMDE_API_BASE_URL` unset. The page then calls the public services itself, exactly like the GitHub beta (no Deezer, posters need the visitor's own TMDB token).

## Deploying from GitHub instead of your PC (optional)
`.github/workflows/deploy-cloudflare.yml` is **manual only**: Actions > deploy-cloudflare > Run workflow > type `deploy`. It needs two repository secrets that Sai creates
(Settings > Secrets and variables > Actions): `CLOUDFLARE_API_TOKEN` (create at dash.cloudflare.com/profile/api-tokens with *Workers Scripts: Edit* and *Cloudflare Pages: Edit*) and
`CLOUDFLARE_ACCOUNT_ID`. It runs the test suite first. `pages_branch` = the Pages project's production branch means a production deploy; anything else is a preview URL.

## Environment and secrets
| Name | Where | Secret? | Purpose |
|---|---|---|---|
| `TMDB_READ_ACCESS_TOKEN` | Worker (`wrangler secret put`) | **yes** | TMDB search, details, seasons, trending, posters. Absent = keyless sources only. |
| `MMDE_WEB_ORIGIN` | `wrangler.toml` [vars] | no | Exact Pages origin(s) allowed to call the API. Empty = no website can. |
| `MMDE_CONTACT` | `wrangler.toml` [vars] | no | Contact in the User-Agent sent to MusicBrainz, AnimeThemes, Wikipedia. |
| `CACHE` | KV binding (optional) | no | Shared answer cache across Worker instances. |
| `MMDE_API_BASE_URL` | Pages build variable | no | The Worker address baked into `config.js` and the page's security policy. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secrets (optional) | **yes** | Only for the manual deploy workflow. |

Guards (tests): the token never appears in any response, header or error (`tests/worker.test.ts`); `wrangler.toml` is checked for secrets and the deploy workflow for push triggers (`tests/pages-build.test.ts`).

## Protection and limits built in
- **CORS allowlist:** a website not listed in `MMDE_WEB_ORIGIN` gets 403 before any upstream call. Only GET/HEAD/OPTIONS are served.
- **Rate limits per visitor** (Cloudflare's `CF-Connecting-IP`): 180 requests/min overall, 30/min for the heavy lookups (soundtrack, albums, album tracks); `/api/health` exempt; 429 with `Retry-After`.
  These counters live in each Worker instance's memory, so they are a good brake, not an exact quota. For a hard limit add a Cloudflare rate-limiting rule (dashboard > Security > WAF > Rate limiting rules; the free plan includes one) on `/api/*`.
- **Input validation** on every parameter; upstream failures become a 502 with a short message (credential redacted), never a stack trace.
- **Caching:** answers carry `Cache-Control` (search 1 min, albums/soundtrack 2 min + stale-while-revalidate, details/trending/track links 1 h); with KV, complete answers are also stored (6-24 h). Errors, partial answers and "nothing found" are never stored for long.
- **Page headers** (`_headers`, generated): strict Content-Security-Policy (no inline script; the page may call only itself and the Worker), no framing, no sniffing, no camera/mic/location.

## Known risks (read before relying on it)
- **Shared egress addresses.** Apple (about 20 calls/min) and MusicBrainz (1/s) limit by IP address. A Worker's outgoing address is shared with other Cloudflare customers, so these services may throttle it harder than your PC. KV caching and the per-title cache reduce calls, but this is **not measured on Cloudflare yet**: run `scripts/golden.mjs` against the deployed Worker (below) and look at the failed-source counts. Fallback: the browser-only mode, where each visitor uses their own address.
- **Free-plan limits** (checked against my memory, confirm on Cloudflare's pricing page): Workers free has a daily request cap and a short CPU time per request; a big soundtrack lookup spends mostly time waiting on other services, not CPU. KV writes are limited per day, so only medium/long-lived answers are stored.
- **The Worker's rate limiter is per instance** (see above). Add the WAF rule.
- The TMDB path (search/details/seasons/trending with a token) is covered by fake-service tests only; it has not run against real TMDB from the Worker because no token is available to AI tooling. Verify after setting the secret (below).

## Verify a deployment
```
$env:BASE_URL="https://mmde-api.<your-subdomain>.workers.dev"; node scripts/golden.mjs --json=golden.json
```
It searches 10 real titles (Telugu, Hindi, anime, Japanese film, K-drama), then prints per title: search results, composers, songs found (green/amber/red), exact Apple/Deezer links, ISRC proof,
sources that failed, artwork source and timings. It measures only; it never decides what is "good". With the TMDB secret set, `/api/health` shows `"tmdb":true` and search results carry posters.

## Roll back
Worker: `npx wrangler rollback` (or dashboard > Workers > mmde-api > Deployments). Pages: dashboard > the project > Deployments > choose an earlier one > Rollback. Delete the secret: `npx wrangler secret delete TMDB_READ_ACCESS_TOKEN`.
If a token is ever exposed: regenerate it at themoviedb.org/settings/api, then `wrangler secret put` again.

## Measured results (2026-10-11)
Run on GitHub's servers: the real Worker code under the real Workers runtime (`wrangler dev --local`, workerd) with a simulated KV cache, **no TMDB token**, real public services, 10 real titles (`scripts/golden.mjs`, list in `data/golden/titles.json`). This is NOT a Cloudflare deployment: the outgoing addresses are GitHub's, not Cloudflare's.

| Title | Songs | Green | Exact Apple link | Notes |
|---|---|---|---|---|
| Baahubali 2: The Conclusion | 76 | 71 | 89% | MusicBrainz ok; 14 albums; 4 languages |
| Slime (S1) | 176 | 119 | 43% | Deezer links 95% |
| Kalki 2898 AD | 34 | 34 | 100% | |
| They Call Him OG | 52 | 49 | 94% | was **0 songs** before the title fix (below) |
| Crash Landing on You (K-drama) | 32 | 28 | 91% | |
| Your Name. | 39 | 29 | 72% | |
| Pushpa 2: The Rule | 71 | 18 | 66% | |
| Jawan | 20 | 9 | 50% | |
| Fire Force | 98 | 0 | 53% | green 0 only because MusicBrainz failed in that run (122 songs / 29 green when it answered) |
| RRR | 103 | 1 | 39% | was 63 songs / 0 albums before the repeated-letter fix; Apple songs still do not merge with the Wikipedia list (transliteration), so almost all stay amber |

All 10 titles found by keyless search and all met their (low) song floors. Totals (run with every fix except the RRR one): 661 songs, 54% green, 59% with an exact Apple link. First-stage (Wikipedia) answers: 0.3-1.8 s. Full stage: 12-31 s (Apple's 3 s spacing). Artwork: found for 10/10 (AniList 3, TVmaze 1, soundtrack album cover 6, so most Indian films get an album cover, not a poster, without a TMDB token). Worker cache: `miss` then `hit` confirmed inside workerd; refused origin 403.

What the live runs found and fixed:
1. **Wikimedia returned 403 to the Worker** (the Workers runtime sends no User-Agent). Fix: every outgoing call gets our User-Agent.
2. **My rate limit was too tight** (search and artwork counted as heavy). Now only soundtrack, albums and album tracks are heavy.
3. **They Call Him OG: 0 songs.** Wikidata's label is "OG"; albums are matched by title and a 2-letter title matches nothing. Fix: use the English Wikipedia article name ("They Call Him OG") when it contains the label. Apple's default store already has all OG albums (probed), so the extra India/Japan store fallback (added first, kept) was not the cause; it is only a safety net.
4. **RRR found no albums**: the fold that tolerates "Bāhubali ~ Baahubali" collapses repeated letters, so "RRR" became "r". Fix: repeated-letter titles compare as whole words.
5. **MusicBrainz "could not be reached" on 8 of 10 titles** in the second and third runs. Probe: it answers 200 for our User-Agent, returns 503 `x-ratelimit-who: search-shed` (its search endpoint is shedding load) and 403 `ua-missing` with no User-Agent. Retries on 503 now go up to 3 with growing waits. A MusicBrainz failure marks the answer `partial` and drops the ISRC proof (0% in these runs). Not solved: it depends on MusicBrainz load; check again from Cloudflare.

Still open: TMDB path untested from the Worker (no token); Cloudflare egress throttling by Apple/MusicBrainz unmeasured; RRR-style language versions do not merge with Wikipedia's list; Deezer links are 0% for several Indian titles (Deezer's catalog or our match); "green 54%" is the engine's own rule, not an independent accuracy number.
