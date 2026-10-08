# MMDE — Architecture Decisions

This file records important decisions so future development sessions and AI assistants share the same assumptions.

## 001 — Media-first discovery

**Decision:** MMDE starts from a media title and discovers its music.

**Reason:** The central problem is not "identify this song." It is "show me the music associated with this media."

## 002 — External links only

**Decision:** MMDE does not host, download, or stream music.

**Reason:** MMDE is a discovery and indexing layer. Playback remains on the external music service.

## 003 — Multi-source discovery

**Decision:** MMDE will combine multiple providers.

**Reason:** No single music or media database is expected to contain every relevant relationship, release, and platform link.

## 004 — Maximum useful recall

**Decision:** Prefer discovering more relevant music while using matching safeguards to reduce false positives.

**Reason:** Missing a legitimate theme, insert song, OST track, or release is a major part of the problem MMDE is intended to solve.

## 005 — Stable identity before title-only matching

**Decision:** Prefer stable identifiers such as ISRCs and database IDs when available.

**Reason:** Titles can differ between releases, languages, transliterations, remasters, compilations, and platform catalogs.

## 006 — Anime first

**Decision:** Start implementation with anime.

**Reason:** Anime has strong structured theme and media metadata, making it a practical first domain before expanding to movies, TV, Indian cinema, and games.

## 007 — Modular providers

**Decision:** Providers should be replaceable and isolated behind normalized interfaces.

**Reason:** External APIs and databases change. MMDE should not have its core logic tied to one source.

## 008 — Do not treat OST as everything

**Decision:** Keep songs, themes, inserts, character songs, OST releases, and original score distinguishable.

**Reason:** "Soundtrack" can refer to several different kinds of music and should not collapse useful context.

## 009 — Keep project context in docs

**Decision:** Important project knowledge belongs in version-controlled documentation rather than raw chat transcripts.

**Reason:** The documentation can be read by ChatGPT, Claude, contributors, and future development sessions.

## 010 — Discovery orchestrator

**Decision:** MMDE should fan out from a canonical media entity to multiple discovery capabilities, then normalize, match and rank the results.

**Reason:** MMDE is intended to behave like an internet-scale discovery layer rather than depend on a preloaded universal database.

## 011 — Provider independence

**Decision:** AniList, MusicBrainz, AnimeThemes, Spotify, Apple Music, Deezer, YouTube and similar services are providers/capabilities, not architectural foundations.

**Reason:** Coverage, availability, terms and APIs change. The MMDE graph must survive provider replacement.

## 012 — Chintune/AniPlaylist as inspiration, not dependency

**Decision:** Use AniPlaylist as a product/data-quality benchmark: granular roles, accumulated media-to-music relationships, independent platform availability, and a correction/submission model.

**Reason:** The project demonstrates the value of a curated relationship index. MMDE should learn from the pattern without copying its data or making it an upstream dependency.

## 013 — Platform absence is not music absence

**Decision:** Platform availability is tracked independently for each recording.

**Reason:** A song should remain visible if Spotify, Apple Music or another individual platform does not contain it.

## 014 — Community discovery is separate evidence

**Decision:** Public/community playlists and web discovery may increase recall, but they are not automatically canonical music relationships.

**Reason:** Community sources are valuable discovery surfaces but can contain covers, duplicates, mislabeled uploads or incomplete metadata.

## 015 — First serious benchmark

**Decision:** Use That Time I Got Reincarnated as a Slime as the first serious anime stress test.

**Reason:** It has multiple seasons, movies, themes, inserts, releases and a large amount of community music content, making it useful for testing recall and false-match protection.

## 016 — No giant crawler for M1

**Decision:** Do not make unrestricted crawling, Redis, Elasticsearch or a permanent provider mirror prerequisites for the first implementation.

**Reason:** The core discovery graph and matching logic should be proven before adding infrastructure complexity.

## 017 — Evidence on every discovery edge

**Decision:** Every media-to-music relationship and platform match should retain source/provenance, match method and confidence.

**Reason:** Maximum recall is only useful if the system can explain why a result was included and distinguish strong evidence from suggestions.
