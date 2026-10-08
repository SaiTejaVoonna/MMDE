# MMDE personal prototype - runbook

Personal, non-commercial prototype on branch `prototype/m1-slime`. Proposal only; nothing here is an approved decision.

## Run it
Needs Node 22.18+ (no npm install, no dependencies).

```
npm start                 # live providers on, http://localhost:8787
npm run start:offline     # local seeds only, no network (works anywhere)
npm test                  # 27 unit/API tests
```

Env vars: `PORT`, `MMDE_OFFLINE=1`, `MMDE_CONTACT` (put a real contact in the User-Agent; MusicBrainz requires one), `ANTHROPIC_API_KEY` (+ optional `MMDE_MODEL`) to enable the Wikipedia+LLM extractor.

## What works / was tested
- Tested here (offline): domain, matching with version guard, pipeline status rules, organizer, evaluator, JSON store, HTTP API (search, discover job with progress, results, validation, path-traversal), the Wikipedia+LLM extractor's anti-hallucination guard (fake fetch + fake LLM), and the web UI in headless Chromium (17 checks via `scripts/ui-smoke.mjs`: search, typeahead, progress, filters, expand, platform links, reload, mobile).
- **NOT tested live** (sandbox network policy blocked the hosts): AniList, MusicBrainz, Deezer, Wikipedia, Anthropic API adapters. The first live run is the real test.

## How to test it live
1. `MMDE_CONTACT=you@example.com npm start`
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
