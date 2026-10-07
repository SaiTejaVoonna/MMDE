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
