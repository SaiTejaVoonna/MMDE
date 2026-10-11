# Next plan (PROPOSED, not decisions)

*Written 2026-10-11 by Claude after a long discussion with Sai. Everything here is a proposal. Per AGENTS.md, nothing becomes a decision in `docs/DECISIONS.md` until Sai approves it. Other AI collaborators (GPT etc.): read this, challenge it, and do not treat it as settled.*

## Product direction Sai asked for
- Calm, fast, mobile-first. Fewer words, bigger visuals, sources tucked into a "How we found this" sheet; credits kept on a "Data from" page.
- **No questions, no pop-ups, no sign-in, no cookie banner.** Do not ask the visitor which language they watch. Interface stays English by default; another language only if the visitor picks it (never auto-switched from browser language or location). Titles/songs show English or romanized names first, original script small or hidden.
- Personalization only on the device (history, favourites, "my music app" in browser storage). No third-party tracking; no reading Google or other sites' data.
- No torrent, piracy, downloader or scraping-based sources (Nyaa, Sonarr/Radarr data, SpotiFLAC, etc.). MMDE links out only; never hosts/downloads/streams. Short audio previews are an open question for Sai.

## Order of work (proposed)
1. **Speed and pictures.** Small poster sizes (w185 cards / w342 detail), lazy load with blur-up placeholder and skeletons, poster requests queued behind song data, cache posters, text first. Larger album art on open (Apple artwork URL size swap; test it).
2. **Exact links on every app button (lit = exact, dim = search).** Four states: exact (lit logo + solid green ring + check dot), probable (thin amber ring), search-only (dim, dashed), checking (three pulsing dots). Animate once when a button lights up, respect reduced motion, exact buttons first, user's app first, tooltip "Exact match (ISRC)" / "Opens a search". Exact links via Odesli (song.link) per opened song, cached; **read Odesli terms first**. Build search queries from structured data (song + film + composer + "official audio"), never from raw filter text; fuzzy in-app song search across transliterations.
3. **Sources.** Poster fallback chain: TMDB -> AniList/Kitsu/Jikan (anime) -> TVmaze -> Fanart.tv -> OMDb (check terms) -> Wikimedia -> soundtrack album art (label it "album cover") -> placeholder. Match by ID first; reject title-only matches with wrong year; show the picture's source in details. Add Fribb/anime-lists ID mapping (trim to needed columns via a GitHub Action; check CORS and file size), Jikan/MAL, other-language Wikipedias, per-country Apple storefronts (`in`, `jp`, `kr`, ...), Japanese->English titles (Wikipedia/MusicBrainz first, kana->romaji client-side, machine translation only labelled "auto-translated"). Group large soundtracks (Reincarnated as a Slime style): openings/endings (AnimeThemes), insert songs, score, character songs, by season/album. Show releases per film as cards (cover, date, track count); example to test: "They Call Him OG" (40-track score album plus singles like Firestorm, Hungry Cheetah).
4. **Landing page.** Blurred title backdrop while loading, "62 songs found so far" streaming feel, local-only rows (Continue, Because you viewed X, Trending), favourites/watchlist/recents in the browser with export/import file, original small animations (no copyrighted clips/GIFs), accent colour from the poster.
5. **YouTube (when Sai provides a key).** Prefer reading official label channel uploads / playlists (about 1 unit) and matching locally over `search` (100 units; ~100/day). Cache for days; resolve lazily per opened song; restrict the key to YouTube Data API; never rotate keys to dodge quota (request an extension instead). Link-out search URLs cost nothing.
6. **Move to Cloudflare** (free `*.pages.dev` / `*.workers.dev`, no domain needed; confirm limits and availability from India first). Pages for the app, Functions/Worker for backend with secrets (TMDB token, YouTube key) never in the browser, edge cache, GitHub Actions nightly pre-build of popular titles. **Read TMDB's terms on caching/storing data before pre-building.** Keep the GitHub Pages `/beta/` as a backup address.
7. **Security and credits.** CSP and standard headers; never insert source text as HTML; CORS limited to our domain; per-visitor rate limit on the Worker; input validation; secret scanning and Dependabot; guard test that fails if a key appears in built files; "Data from" page with licences and attributions.

## Engine improvements (proposed)
- Nightly pre-built index for popular titles; Wikidata ID as the title spine and ISRC as the song spine; streaming results (per song); shared edge cache with stale-while-revalidate, request coalescing, priority queue (visible songs first), circuit breakers for slow sources, no caching of failures for long; smaller/split JS bundle.
- **Golden test set** (~50 titles/songs across Telugu, Hindi, Tamil, Japanese, Korean) scored on every change so accuracy is a measured number; nightly self-check job that re-tests it and lists weak titles/sources; optional anonymous "wrong match" counter on the Worker (song id + result type only). Learned confidence weights only from our own labelled outcomes and open sources (never Spotify data). Rule/code changes stay human-approved: automation may open a PR or a note, never change the live engine unattended.

## Questions waiting for Sai
- Public name (MDE vs other; change visible text only, not repo/folder names).
- Are 30-second audio previews allowed (bends "never stream")?
- Open the PR `claude/deploy-readiness` -> `main` (Sai merges)?
- Create a free Cloudflare account; later paste TMDB token (and optional YouTube key) into Cloudflare secrets, never in chat or the repo.
- Delete throwaway branch `live-mb-check`; enable GitHub secret scanning and Dependabot.

## Facts and cautions recorded
- Live-verified earlier: browser-only beta works at `https://saitejavoonna.github.io/MMDE/beta/`; Wikipedia full-text search fixes keyless title search (Baahubali 2, Pushpa 2, Kingdom, Jawan, Kalki 2898 AD found; Wikidata label search alone missed them).
- Not verified: Odesli terms and limits, Cloudflare free limits from India, TMDB caching rules, whether Apple artwork URLs return 1500 px+, Chrome built-in translator support, covers.musichoarders.xyz (blocked in the sandbox; screenshots show it searching ~28 services incl. Apple/Deezer/Spotify per country and showing 1500x1500 covers; its data source/terms unknown).
- Spotify: link-out only; no stored Spotify data; optional per-visitor "Connect Spotify" later. Do not copy or build on SpotiFLAC (downloader) even though it is MIT licensed; the licence covers code, not the services' terms.
