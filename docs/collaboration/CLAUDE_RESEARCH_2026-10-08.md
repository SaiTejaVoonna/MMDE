# Claude — Research & Architecture Validation (2026-10-08)

**Status: PROPOSAL / RESEARCH. Nothing here is an approved decision.** Sai has final authority; items move to `docs/DECISIONS.md` only after Sai approves them.

**Confidence legend:** ✅ = a source I found this session stated it (often a secondary page). ⚠️ = unverified or from my own background knowledge — verify before relying on it.

**Limits of this pass:** ~16 web searches, summaries only. The one primary-doc fetch (AnimeThemes docs) failed on DNS. GitHub tools were offline, so repo activity and licenses were not checked directly.

---

## Headline findings

1. **"Free" is thinner than assumed.** Spotify is heavily gated, YouTube search quota is tiny, AniList and TMDB have commercial thresholds. Whether MMDE is commercial changes the most.
2. **AniList terms vs. a local database.** AniList prohibits using its API as "a backup or data storage service" and "hoarding or mass collection of data" (✅). Persisting AniList data in our own DB needs a decision or permission.
3. **Open backbone = MusicBrainz + AnimeThemes.** Both are dumpable/self-hostable; neither needs a key (with caveats below).
4. **Indian/Telugu cinema:** no open, structured music source found. Plan for human curation.
5. **TV/film soundtrack data:** no open equivalent found. TuneFind is commercial and contract-based.
6. **Proposed stack is reasonable.** Simplify it (section D).

---

## A. Provider inventory

| Source | Type | Coverage | Free / key / limits | Self-host / dump | License / terms | IDs | Suggested role |
|---|---|---|---|---|---|---|---|
| AniList | GraphQL API | Anime/manga identity | ✅ free; ✅ 90/min (docs warn of degraded 30/min); ⚠️ public queries likely keyless | None | ✅ free non-commercial; ✅ commercial free under $150/mo revenue, then license; ✅ no data hoarding/backup | AniList ID, ⚠️ MAL ID | Primary anime identity |
| AnimeThemes | REST + GraphQL | OP/ED themes, songs, artists | ✅ ~90/min GraphQL; ✅ GraphQL "experimental" | ✅ server MIT; ✅ dump feature exists, ⚠️ location unconfirmed | ⚠️ data license not found | ⚠️ external IDs (MAL/AniList) in docs | Primary anime themes |
| MusicBrainz | API + dumps | Recordings, releases, artists | ✅ ~1 req/s/IP, User-Agent required; ✅ dumps twice weekly | ✅ `musicbrainz-docker` (16 threads/16 GB RAM/350 GB); ✅ lighter mbslave-style option | ✅ core CC0; ✅ supplementary (tags, ratings, search indexes) CC BY-NC-SA; ✅ commercial licensing via MetaBrainz | MBIDs, ISRCs | Identity backbone |
| Discogs | API + dumps | Releases | ✅ 60/min authed, 25 unauthed | ✅ monthly dumps | ✅ dumps CC0; ✅ "restricted data" under API terms; ⚠️ commercial clause not found | Discogs IDs | Enrichment |
| Cover Art Archive | API | Release artwork | ✅ keyless, rate-limited (503) | via MB | ✅ no formal ToS; ✅ copyright stays with owners, "use at your own risk" | Release MBID | Artwork fallback; link, don't rehost |
| ListenBrainz | Dumps | Listens | ✅ dumps exist | ✅ | ⚠️ license unclear | MBIDs | Not core |
| Wikidata | SPARQL/dumps | Cross-IDs | not effectively searched | ⚠️ | ⚠️ believed CC0 | QIDs | ID bridge (unvalidated) |
| TMDB | API | Movie/TV identity | ✅ free non-commercial w/ attribution; ✅ commercial needs sales contact; ⚠️ "$149/mo" unconfirmed | None | ✅ as stated; no soundtrack data | TMDB ID | Movie/TV identity |
| IGDB | API (Twitch) | Game identity | ✅ ~4 req/s; ⚠️ Twitch credentials | None | ⚠️ commercial terms ambiguous | IGDB ID | Game identity |
| OSTDB | API | Game soundtrack links | ✅ free API keyed by IGDB ID; ✅ small (~900 games) | unknown | ⚠️ no license found | IGDB ID | Game-music experiment |
| VGMdb | Scrape only | Game/anime releases | ✅ no official API; ✅ needs logged-in session via Cloudflare | None | ⚠️ ToS not found | VGMdb IDs | Do not scrape; use MB URL relationships |
| AniDB | UDP/HTTP | Anime relations | ✅ strict; bans reported after ~250 requests; ⚠️ "don't download AniDB" | None | ⚠️ official terms not found | AniDB ID | Avoid in MVP |
| Jikan (MAL) | Unofficial scraper API | MAL data | ✅ 3/s, 60/min; ✅ self-hostable | ✅ Docker | ⚠️ scrapes MAL | MAL ID | Fallback only |
| Kitsu / Shikimori | APIs | Anime | ⚠️ Kitsu status conflicting; ✅ Shikimori needs OAuth | None | ⚠️ data license not found | own IDs | Skip |
| TuneFind | Commercial API | TV/film/game songs | ✅ contract-based | None | ✅ commercial | own IDs | Not open |
| Spotify | API | Platform | ✅ Dev Mode: Premium owner, 5 users, endpoints/fields removed (Feb–Mar 2026); ✅ search limit reportedly cut to 10 (third-party); ✅ Extended Quota needs an organization with 250k+ MAU | None | ✅ as stated | Spotify IDs | Link source, weak |
| Apple Music API | API | Platform | ✅ ISRC lookup exists; ✅ developer credentials required | None | ⚠️ cost not verified | Apple IDs | Link source |
| iTunes Search API | API | Platform | ✅ keyless, documented ~20/min; ✅ no ISRC lookup (UPC/Apple ID only) | None | ✅ | Apple IDs | Low-volume fallback |
| Deezer | API | Platform | ✅ public search needs no auth; ⚠️ ~50 per 5 s/IP (one third-party report); ⚠️ `/track/isrc:` endpoint unverified | None | ⚠️ terms not found | Deezer IDs, ISRC in track data | Best free ISRC resolver (candidate) |
| YouTube Data API | API | Platform | ✅ 10,000 units/day; ✅ search = 100 units (~100 searches/day); ✅ quota-extension form | None | ⚠️ ToS not covered | Video IDs | Use sparingly |
| Odesli / song.link | API | Cross-platform links | ✅ ~10 req/min keyless, key by email (via wrappers); ✅ v1-alpha | None | ⚠️ no terms found | platform IDs | Candidate cross-link resolver |

## B. GitHub discoveries (activity NOT checked)

| Repo | What it does | License | MMDE use / risk |
|---|---|---|---|
| `AnimeThemes/animethemes-server` | Server behind AnimeThemes | ✅ MIT | Model/API reference; ⚠️ dump location unconfirmed |
| `metabrainz/musicbrainz-docker` | MB mirror w/ replication and search | ⚠️ unchecked | Self-hosting MB; heavy; Solr CVE warning; replication needs a token |
| `kellnerd/harmony` | Multi-source metadata aggregator / MB seeder (Deno) | ⚠️ unconfirmed | Design reference for normalize/merge |
| `Lab86-io/music` | Playlist converter across 6 services: ISRC then fuzzy, confidence scores, filters tribute/karaoke | ⚠️ not stated | Closest match to our matching problem; study logic |
| `spotify-to-apple-py` | ISRC to iTunes ID | ✅ MIT | Small reference incl. Apple rate-limit pause |
| `Ciderfy` (.NET) | Uses Deezer to get ISRCs (claims Spotify doesn't expose them publicly) | ⚠️ unchecked | Deezer-as-ISRC-resolver pattern |
| `jikan-me/jikan-rest`, `Toki` | Self-hostable MAL APIs | ⚠️ unchecked | Fallback; scrape-based |
| `manami-project/anime-offline-database` | Cross-site anime ID map | ✅ code AGPL-3.0; ⚠️ data license unchecked | Useful crosswalk; AGPL may bind derived work |
| `nattadasu/animeApi` | ID mapping API | ✅ AGPL-3.0 | Same AGPL caution |
| `Fribb/anime-lists`, Kometa Anime-IDs | ID mapping lists | ⚠️ unverified | Alternatives for MAL/AniDB/TVDB mapping |
| `hufman/vgmdb` | VGMdb JSON proxy | ⚠️ unchecked | Needs login cookie; don't depend on it |

## C. Matching architecture (proposal)

1. **Model like MusicBrainz** (⚠️ my recommendation): separate Work, Recording, Release, Track-on-release. Anchor MMDE `Track` on the **recording**, canonical cross-reference = MB recording ID where it exists.
2. **ISRC = strong join key, not proof.** One recording can have several ISRCs; platform editions/remasters/regional releases complicate it. Treat as high confidence, not certain.
3. **Media→music edges are separate from recording identity:** store `(media_part, recording, role)` with sources + confidence. Multi-source agreement raises confidence; single weak source stays "unverified". Add a review queue for low-confidence edges.
4. **Version guard:** never merge across version type (original / TV-size / full / live / remix / cover / instrumental / re-recording). Use MB disambiguation, title tokens, and a duration-tolerance check (TV-size ~90 s vs full ~4 min). Reject karaoke/tribute.
5. **Ladder:** provider/MB ID, then ISRC, then release relationship (same album + track no.), then artist+title+duration, then fuzzy title/artist (can only yield "suggested", never "confirmed").
6. **Record the match method** (`isrc` / `id` / `fuzzy`) and confidence on every platform link; show unconfirmed matches differently in the UI.

## D. Tech stack (proposal)

Next.js + React + TypeScript, Node/TypeScript, PostgreSQL is a reasonable start. Suggestions:
- **One TypeScript codebase.** No Python hybrid yet; revisit only for ML/heavy batch matching.
- **Next.js + a separate worker process**, not a separate API service. Ingestion must respect per-provider rate limits (MusicBrainz ~1/s is the hard one).
- **Postgres only for now** (full-text, `pg_trgm` fuzzy, simple job queue). Add Redis/search engine only on measured need.
- **Rate limits shape UX:** resolving a title's tracks via MB at 1 req/s takes minutes, so on-demand discovery needs the progress UI from the mockups. A local MB mirror removes this but costs ~350 GB / 16 GB RAM.

## E. Freedom-first provider architecture (proposal)

- Capability-based provider interfaces (identity, themes, releases, recording identity, platform lookup), not one interface per provider.
- Store raw provider snapshots (`SourceRecord`) so providers can be swapped and data re-merged without refetching.
- MMDE-owned IDs with a crosswalk table to external IDs; never use a provider ID as a primary key.
- Per-provider rate limiter, TTL cache, circuit breaker: an outage or ban degrades results instead of breaking the app.
- Prefer dumps where licenses allow (MB core, Discogs CC0, AnimeThemes if confirmed).
- Cache policy must honor each provider's terms (AniList likely means short-lived caching, not a permanent mirror).

## F. Missing pieces

- **Indian/Telugu:** MusicBrainz has scattered Telugu entries, not full coverage (✅). Gracenote says Indian film music is hard to catalog and sells a licensed catalog (✅). Likely approach: TMDB for film identity, MusicBrainz + platform album search (e.g. "<Film> (Original Motion Picture Soundtrack)"), plus a curation workflow. JioSaavn/Gaana unofficial access is a ToS risk; I found no evidence of public APIs.
- **Japanese music:** VGMdb and MusicBrainz are the main candidates. Official Japanese catalog databases (e.g. J-WID) not verified.
- **Games:** IGDB (identity), OSTDB (soundtrack links), MB/VGMdb relationships. MobyGames new keys paywalled (✅ reported as of Sept 2024).
- **TV/film scores:** MusicBrainz + Wikidata; TuneFind is the commercial option. WhatSong and similar sites: no public API found.
- **Search-link fallback (my idea):** where API access is blocked (Spotify, YouTube), emit "search on <platform>" deep links, clearly marked as unconfirmed matches.
- **Artwork:** Cover Art Archive has no formal ToS and pushes risk to the user. Link/hotlink rather than rehost; get a legal read before shipping.
- **Also needed:** dedup, confidence scoring, caching, search/indexing design, and a written per-provider license/attribution policy.

## G. Assumptions challenged

1. "Spotify/Apple/YouTube/Deezer as link sources" is not free or easy. Plan for Deezer and MusicBrainz link relationships first; others best-effort.
2. "Self-hostable" has a cost (MB mirror ~350 GB). Start on the API; mirror later.
3. AniList's "no storage" rule conflicts with a normalized DB. Resolve before schema design.
4. AGPL ID-mapping datasets may carry obligations on derived data. Check before adopting.
5. "Maximum recall" needs a measurable goal: benchmark titles (incl. one Telugu film, one Hollywood film, one game) with recall and false-match rate.
6. Scraping VGMdb, AniDB or streaming sites: no evidence it's permitted; AniDB bans bulk access. Default to APIs, dumps, link-outs.
7. The UI mockups imply non-music data (characters, news, episodes), which adds provider requirements. Decide scope.

## Questions for Sai

- Is MMDE going to be commercial (ads, subscriptions, affiliates)? This decides AniList, TMDB and MusicBrainz licensing.
- Is a curated / human-reviewed layer acceptable for Telugu cinema?
- Are search-link fallbacks acceptable where we can't resolve by API?

## Suggested next steps (if Sai approves)

1. Verify all ⚠️ items against primary docs.
2. Check candidate repos' activity and licenses.
3. GPT reviews this document and adds its own findings.

## Sources

AnimeThemes API reference, AnimeThemes server docs, AniList terms and rate-limit docs, MusicBrainz rate-limiting and data-license pages, `metabrainz/musicbrainz-docker`, Spotify Feb-2026 migration guide and Jul-2026 quota blog, TechCrunch (2026-02-06), YouTube quota-cost docs, Discogs API terms, Cover Art Archive docs, ListenBrainz dumps docs, `kellnerd/harmony`, `Lab86-io/music`, `spotify-to-apple-py`, Ciderfy, `manami-project/anime-offline-database`, `nattadasu/animeApi`, Jikan REST, `hufman/vgmdb`, OSTDB, Songtradr/Tunefind coverage, IGDB commercial-use thread, odesli.js, Apple iTunes Search API forum thread, AniDB limits (FileBot forum).
