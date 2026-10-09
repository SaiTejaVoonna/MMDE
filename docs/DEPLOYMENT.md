# MMDE deployment: GitHub Pages frontend + Railway backend

Status: a proposal/runbook written by Claude. Nothing here has been deployed by an AI; see "What is verified" below.
Sai Teja decides what ships.

```
Browser at https://saitejavoonna.github.io/MMDE/   (static files from the gh-pages branch)
        |  fetch(apiBaseUrl + "/api/...")           (public URL from web/config.js; no secrets)
        v
Railway service  (Node server: src/server/main.ts, Dockerfile)
        |  Authorization: Bearer $TMDB_READ_ACCESS_TOKEN   (server-side only)
        v
TMDB / AniList / Wikipedia / AnimeThemes / MusicBrainz ...
```

## Quickest path: run it on your own PC (no hosting)
```
git clone https://github.com/SaiTejaVoonna/MMDE.git   # or git pull if you already have it
cd MMDE
npm run setup      # paste your TMDB "API Read Access Token"; it is tested against TMDB, then saved to .env (git-ignored)
npm run doctor     # ONE command that checks everything: Node, files, token, port, then runs the real server, search and seasons
npm start          # open http://localhost:8787
```
Needs Node 22.13 or newer (tested on a real v22.13.0 and on 22.22; the npm scripts add `--experimental-strip-types` automatically, which Node 22.18+ no longer needs). `npm run doctor` prints PASS / WARN / FAIL lines with what to do for each. The token never leaves your computer and is never printed. Hosting on Railway is only needed so the public GitHub Pages site can use TMDB too.

## Render free (no card) as the first host, with `render.yaml`

Chosen for a quick friend-test link; Railway (below) stays a good paid, always-on alternative. Render free sleeps after about 15 minutes idle and
needs roughly 30-50 s to wake (third-party comparison pages; check Render's own pricing page). The optional `keep-warm` workflow pings
`/api/health` every ~10 minutes once `MMDE_API_BASE_URL` is set; read Render's terms on keep-alive pings before relying on it.

1. render.com > **New > Blueprint** > connect the GitHub repo `SaiTejaVoonna/MMDE` (branch `main`, or `claude/deploy-readiness` for a first test: edit `branch:` in `render.yaml`).
2. Render reads `render.yaml`, asks for `TMDB_READ_ACCESS_TOKEN` and `MMDE_CONTACT`. Paste the token only there.
3. When it is live, copy the `https://<name>.onrender.com` address, set it as the GitHub repo **Variable** `MMDE_API_BASE_URL`, then run **Actions > publish-pages**.
4. Share `https://saitejavoonna.github.io/MMDE/`.

How first loads are kept short: the page asks for a Wikipedia-only answer first (about a second), then Apple Music/Deezer, then everything; the server compresses
answers (gzip), lets browsers reuse soundtrack answers for 2 minutes (`stale-while-revalidate` 30 minutes), and fetches Apple albums in one batched lookup because Apple allows only about 20 calls a minute.

## Rules this setup enforces
- **No secret ever reaches the browser or git.** `TMDB_READ_ACCESS_TOKEN` exists only as a server environment variable. Tests assert the frontend files contain no token-like strings and that no API response or header contains the token.
- **`web/config.js` is public.** It holds one setting, `apiBaseUrl` (a URL, not a secret).
- **CORS is an allowlist** (`MMDE_WEB_ORIGIN`). Unlisted websites get HTTP 403 before any provider is called.
- **Rate limits** protect shared quotas (TMDB, MusicBrainz): 120 API calls/min and 12 discovery jobs/min per client by default (`/api/health` is exempt).

## Environment variables (set on the server only)
| Variable | Required | Purpose |
|---|---|---|
| `TMDB_READ_ACCESS_TOKEN` | for TMDB search + seasons | TMDB "API Read Access Token" (v4) from themoviedb.org/settings/api. Missing = `/api/seasons` returns 503 and TMDB search is skipped; the server still starts. |
| `MMDE_WEB_ORIGIN` | for a separate frontend | Exact origin(s), comma separated: `https://saitejavoonna.github.io` (no path, no trailing slash needed). Empty = same-origin only. |
| `MMDE_CONTACT` | recommended | Put in the User-Agent sent to MusicBrainz/AnimeThemes (an email or repo URL). |
| `PORT` | provided by Railway | Do not set it yourself. Defaults to 8787 locally. |
| `MMDE_TRUST_PROXY` | set `1` on Railway | Rate limits then use the client address the Railway proxy appends in `X-Forwarded-For` (last entry; earlier entries can be forged). Without it every visitor shares the proxy's address and therefore one rate-limit bucket. Also auto-enabled if Railway's own environment variables are detected. |
| `ANTHROPIC_API_KEY` | **leave unset on a public server** | Enables the Wikipedia+AI extractor; every public `/api/discover` could spend it. |

Frontend (public, GitHub **Variable**, not Secret): `MMDE_API_BASE_URL`, for example `https://mmde-production.up.railway.app`.

## Exact manual steps

### 1. Railway (backend)
1. railway.com > **New Project** > **Deploy from GitHub repo** > choose `SaiTejaVoonna/MMDE`.
2. Open the service > **Settings > Source**: choose the branch to deploy. Use `claude/deploy-readiness` for the first test, or `main` once this work is merged. (`main` has been red at times while GPT was mid-change, so confirm CI is green on the branch you pick.)
3. The repo has a `Dockerfile`, so Railway should build with it (it pins Node 22; the server runs TypeScript directly and needs Node >= 22.18). There are no runtime dependencies and no build step. If Railway shows a different builder, remove nothing; the Dockerfile takes precedence.
4. Service > **Variables**: add `TMDB_READ_ACCESS_TOKEN` (paste the real value here, only here), `MMDE_WEB_ORIGIN=https://saitejavoonna.github.io`, `MMDE_CONTACT=<your email>`, `MMDE_TRUST_PROXY=1`. Do not add `PORT`. Do not add `ANTHROPIC_API_KEY`.
5. Service > **Settings > Networking** > **Generate Domain**. Copy the `https://...up.railway.app` URL.
6. Healthcheck: `railway.json` sets `/api/health`. If the deploy is marked unhealthy, look at the deploy logs.
7. Deploy logs should show: `TMDB configured: yes`, `CORS allowed origins: https://saitejavoonna.github.io`, `trust proxy: yes`.

### 2. Smoke test the backend (replace `$API`)
```bash
API=https://<your-service>.up.railway.app
curl -s $API/api/health                       # expect "ok":true,"tmdb":true,"cors":true
curl -s "$API/api/search?q=slime"             # expect a TMDB "That Time I Got Reincarnated as a Slime" result (id tmdb-tv-...)
curl -s $API/api/seasons/tmdb-tv-<id-from-search>   # expect {"seasons":[{"seasonNumber":1,...}]}
# CORS: the Pages origin is allowed, a stranger is not
curl -s -D - -o /dev/null -H "Origin: https://saitejavoonna.github.io" $API/api/health | grep -i access-control-allow-origin
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.example" "$API/api/search?q=x"   # expect 403
```

### 3. GitHub Pages (frontend)
1. Repo > **Settings > Secrets and variables > Actions > Variables > New repository variable**: name `MMDE_API_BASE_URL`, value your Railway URL (https, no trailing path). This is public, so a Variable is correct.
2. Repo > **Actions > publish-pages > Run workflow** (or push to `main`). The workflow writes the URL into the *published* `config.js` only; the repo keeps `apiBaseUrl: ""`.
3. Open https://saitejavoonna.github.io/MMDE/ and hard refresh (`Ctrl+Shift+R`). The line under the search box should read **"Backend: online (your-service.up.railway.app)"**.
4. Search `slime`, pick the TV result, and the seasons should appear.

### Troubleshooting
| What you see | Cause / fix |
|---|---|
| "no backend URL is configured" | `MMDE_API_BASE_URL` variable missing, or publish-pages has not run since you set it. |
| "Cannot reach the MMDE backend ... CORS" | Backend offline, wrong URL, or `MMDE_WEB_ORIGIN` does not exactly equal `https://saitejavoonna.github.io`. |
| "TMDB is not configured on the server" | `TMDB_READ_ACCESS_TOKEN` not set on Railway (or the service was not redeployed after adding it). |
| Seasons fail with "season lookup failed: HTTP 401 from TMDB" | The token is wrong or is a v3 API key instead of the v4 Read Access Token. |
| "Too many requests" | The per-client rate limit; wait a few seconds. |

## What is verified, and what is not
Verified (automated, in this repo):
- 57 unit/API tests, including CORS allow/deny/preflight, rate limits, seasons validation and 503/502 behavior, and "the credential never appears in any response or frontend file".
- `scripts/ui-split-origin.mjs`: a real Chromium run with the frontend and backend on two different origins and real network connections (no interception), proving the browser accepts the allowed origin, blocks a backend that does not list it, and the UI explains both.
- Clean-copy run of `npm ci`, `npm test`, `npm run build:web`, and the server process with and without a TMDB token (graceful 503/502, no crash, secret never logged).
- The `docker` job in `.github/workflows/test-and-build.yml` builds the image and smoke-tests the running container on GitHub's runners.

NOT verified by Claude (no access): the actual Railway project, a real TMDB token against the real TMDB API, Railway's builder behavior and `railway.json` schema acceptance, and the live Pages site after configuring the variable. Treat the smoke tests above as the real acceptance test.

## Other findings from the deployment review
- **Search results were never displayed** by `web/mmde-phase1.js` on `main` (the results list was built but not attached to the page). Fixed here and covered by the split-origin browser test.
- **Legacy browser-only code** (`src/browser/browserApi.ts`, the Settings panel in `ui.js`, bundled as `web/mmde.js`) still asked users to paste a TMDB token into the browser and stored it in `localStorage`. It was not loaded by the current page but was still built and published. That handling is removed; a test now fails if browser code ever accepts or sends a TMDB credential.
- **`/api/search` ran every provider one after another**, including AniList franchise expansion that makes ~12 rate-limited requests, so the "fast TMDB" page waited on slow sources. It now runs them in parallel and the phase 1 page asks only for `sources=tmdb,local-seeds` (falls back to all sources if the server has no TMDB credential). Default behavior of `/api/search` without `sources` is unchanged apart from running in parallel.
- `scripts/ui-browser-mode.mjs` and `scripts/ui-smoke.mjs` are stale (they target the legacy bundle) and already fail on `main`; CI does not run them.

## Known limits (deliberately not solved yet)
- Results are stored in `data/store.json` inside the container, which is ephemeral on Railway (lost on redeploy). Fine for a prototype; use a volume or a database later.
- Rate limits are per process and in memory (one instance).
- No authentication: anyone with the URL can call the API within the limits.
- Provider licensing/terms (AniList no-storage rule, AnimeThemes terms, Jikan scraping) are still open decisions for Sai; this change does not alter which providers run.
