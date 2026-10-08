# MMDE personal prototype - runbook

Personal, non-commercial prototype on branch `prototype/m1-slime`. Proposal only; nothing here is an approved decision.

## Live site (GitHub Pages)
https://saitejavoonna.github.io/MMDE/ is the browser-only build, published from the `gh-pages` branch (a snapshot of `web/` from `prototype/m1-slime`; republish after app changes). Verified 2026-10-08 that the HTML and `mmde.js` are served. Live-provider behaviour (AniList, MusicBrainz, Wikipedia, Anthropic CORS) is still untested on the real site.

## Copy diagnostics (for sharing results)
Every result page has a **Copy diagnostics** button. It copies plain text with: mode and settings (never the API key), the last search and its errors, each provider's reported errors, every track's status/confidence/MusicBrainz id/ISRC/evidence, link resolution and releases. The same text is shown on the page if automatic copy fails. Paste it into the chat for review.

## Easiest: browser only (no server, no install)
1. Download the ZIP: https://github.com/SaiTejaVoonna/MMDE/archive/refs/heads/prototype/m1-slime.zip and unzip it.
2. Double-click `web/index.html`. That is the whole app (one bundled script, `web/mmde.js`).
3. Search "slime" (works offline). With internet, other titles go through AniList, MusicBrainz and Wikipedia straight from your browser. Open Settings on the landing page to toggle live providers or paste an optional Anthropic API key (enables the Wikipedia+AI extractor; stored only in this browser).

Browser-mode limits: browsers cannot set a custom User-Agent (keep usage light), Deezer cannot be called from a browser (no CORS) so platform links stay as search links, and results are kept in this browser's localStorage. Rebuild the bundle after editing `src/`: `npm run build:web` (dev only; needs `npm install` for esbuild; the built file is committed).

## Optional: run the Node server instead
The server runs wherever you start it. If you open http://localhost:8787 and get "refused to connect", nothing is running on your machine. Start it locally:

```
# Windows / Mac / Linux. Needs Node 22.18+ (check: node -v). Get it from https://nodejs.org (LTS)
git clone -b prototype/m1-slime https://github.com/SaiTejaVoonna/MMDE.git
cd MMDE
npm run start:offline
```
Leave that terminal open, then open http://localhost:8787. No npm install needed.

```
npm start                                  # live providers on
npm start -- --contact=you@example.com     # live, with your contact in the User-Agent
npm run start:offline                      # local seeds only, no network
npm test                  # 27 unit/API tests
```

Flags (work on Windows): `--offline`, `--contact=...`, `--port=...`. Env vars (same effect): `PORT`, `MMDE_OFFLINE=1`, `MMDE_CONTACT` (put a real contact in the User-Agent; MusicBrainz requires one), `ANTHROPIC_API_KEY` (+ optional `MMDE_MODEL`) to enable the Wikipedia+LLM extractor.

## What works / was tested
- Browser-only mode: 17 checks via `scripts/ui-browser-mode.mjs`, opening `web/index.html` over file:// with AniList, MusicBrainz, Wikipedia and Anthropic mocked at the network layer (so real CORS behaviour is NOT covered; it is assumed from provider docs/memory and must be verified live).
- Tested here (offline): domain, matching with version guard, pipeline status rules, organizer, evaluator, JSON store, HTTP API (search, discover job with progress, results, validation, path-traversal), the Wikipedia+LLM extractor's anti-hallucination guard (fake fetch + fake LLM), and the web UI in headless Chromium (17 checks via `scripts/ui-smoke.mjs`: search, typeahead, progress, filters, expand, platform links, reload, mobile).
- **NOT tested live** (sandbox network policy blocked the hosts): AniList, MusicBrainz, Deezer, Wikipedia, Anthropic API adapters. The first live run is the real test.

## How to test it live
1. `npm start -- --contact=you@example.com`
2. Open http://localhost:8787, search "slime" (local seed) and e.g. "jujutsu kaisen" (AniList only; no music seed, so expect little until the Wikipedia+LLM extractor is enabled).
3. Watch the "Provider notes" box on the result page for network errors from each provider.
4. Compare results with `data/ground-truth/slime.s1.json`; `src/app/evaluate.ts` computes precision/recall.

## Status rules
- confirmed: >= 2 distinct sources AND a recording match >= 0.8
- suggested: 1 source with a good recording match, or >= 2 sources without one
- unverified: everything else. Same title + different artist can never confirm; instrumental/live/TV-size never merge with the original.

## Platform links
MMDE only links out. Links marked "(search)" are plain search URLs, not verified matches. Only Deezer can currently produce a "resolved" link (via ISRC/search), and only when live and when a recording match exists.

## Known gaps
- Slime data is from search-result summaries, not primary pages: verify before treating as ground truth.
- No Season 1 OST album found; only the Scarlet Bond movie OST (unverified).
- No AnimeThemes provider: its Terms of Service page could not be read.
- Storage is a JSON file (`data/store.json`, gitignored); Postgres is a later swap behind the `Store` interface.
