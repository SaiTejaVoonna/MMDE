# MMDE Search (Phase 1)

Bare-bones, browser-only: type a title, find it. Anime also show their seasons. No music yet.

- Open `search/index.html` (double-click; no server, no install).
- Sources (each reports its own result count or error under the search box):
  - **AniList** (keyless): anime, alternate names like "Tensura", seasons/movies/OVAs via relation links.
  - **Wikipedia** (keyless): everything else, natural language ("og telugu movie", "bahubali"), follows redirects.
  - **TMDB** (optional, your own free key in Settings): movies/TV/Indian cinema and TV seasons.
- Query hints: language words (telugu, hindi, tamil...) and type words (movie, film, series, anime) are used as filters/ranking, not as part of the title.
- Add a source later: write a function that returns result objects and add it to the plan in `src/search.js`.

Dev: `npm run test:search`, `npm run build:search` (bundles `src/` to `app.js`; the built file is committed so no build is needed to use it), browser test `node search/scripts/ui-test.mjs` (needs Playwright), live check `node search/scripts/check.js` (also runs in CI and writes `latest.md` to the `search-check` branch).
