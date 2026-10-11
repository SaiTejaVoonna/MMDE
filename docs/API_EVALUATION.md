# Public data sources: evaluation (2026-10-11)

Scope: independent, public sources for media metadata, artwork and music discovery. "Verified" = I called it from a real browser origin or GitHub's servers during this project; "from memory" = not re-checked, confirm before relying on it.
Excluded by Sai for this phase: MusicHoarder and SpotiFLAC (not inspected, not integrated, nothing built for them).

| Source | Used for | Key | Browser CORS | Status in MMDE | Notes |
|---|---|---|---|---|---|
| TMDB | titles, posters, composers, seasons, trending | token | yes (verified) | integrated (Worker secret) | Best ranking and posters. Free key is non-commercial; **caching/storage terms not read yet**. |
| AniList (GraphQL) | anime titles, covers, seasons | none | yes (verified) | integrated; **covers now feed the artwork chain** | Cover URLs are used as links, not copied. |
| Wikipedia | tracklists, title search, lead images | none | `origin=*` (verified) | integrated; full-text search now merged into keyless title search; lead image in artwork chain | Text CC BY-SA: credit required. Film posters are mostly non-free, so often no image. |
| Wikidata | composers, other-language titles, title IDs | none | `origin=*` (verified) | integrated | Label search misses sequels; Wikipedia search covers that (live probe 2026-10-09). |
| MusicBrainz | official releases, ISRC, label, barcode | none (User-Agent asked) | yes (verified); UA cannot be set from a browser | integrated | 1 request/s; Indian releases often lack ISRC. |
| Apple iTunes Search/Lookup | albums, tracks, links, album art | none | yes (verified) | integrated; **album cover is the last artwork fallback** | About 20 calls/min per IP (shared-IP risk on Workers). |
| Deezer | tracks, ISRC | none | **no CORS** | integrated server/Worker side only | Not usable from a browser. |
| AnimeThemes | anime openings/endings | none | echoes origin (verified) | integrated | |
| **TVmaze** | TV series posters, premiere year | none | yes (documented as open; browser use not re-verified) | **new: artwork chain, year-checked** | Rate limit about 20 calls/10 s per IP (from memory). |
| Jikan (MyAnimeList) | anime lists | none | test failed earlier | server-side resolver only | Rate-limited. |
| Cover Art Archive | release cover art by MusicBrainz id | none | from memory: yes | **not integrated** (candidate) | Would give exact release covers when a MusicBrainz release is known; needs the release id plumbed through. |
| Fanart.tv | posters/logos by TMDB/TVDB id | free key | from memory: yes | not integrated (candidate) | Needs a key; add to Worker secrets if wanted. |
| Odesli (song.link) | exact links for other music apps | optional key | from memory: unknown | **not integrated: terms and limits unread** | The planned way to light up every app button. |
| OMDb | posters by IMDb id | key | from memory: yes | not integrated | Check terms before use. |
| Last.fm / ListenBrainz | similar tracks, popularity | key / none | from memory | not integrated (candidate for recommendations) | |
| YouTube Data API | exact YouTube matches | key | yes | not integrated (needs Sai's key) | Quota 10,000 units/day; search costs 100, channel-uploads reads about 1. |
| Spotify | link-out only | n/a | n/a | never ingested | Terms forbid building databases / ML from its data. |

Decisions this phase (proposals, Sai to approve): artwork fallback = AniList -> TVmaze -> Wikipedia -> Apple soundtrack album cover (labelled "album cover"); Cover Art Archive, Fanart.tv, Odesli and YouTube stay candidates.
