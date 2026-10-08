# MMDE

## Media Music Discovery Engine

MMDE is a **media-first music discovery engine**.

> **Know the media. Discover its music universe.**

Search for a movie, anime, TV show, game, or other media title. MMDE resolves the media, discovers music from multiple permitted sources, matches the results, and shows where each recording can be found.

MMDE is not a streaming service. It does not host or download music.

## The idea

Most music discovery is music-first:

> Find this song.

MMDE is media-first:

> I know this media title. Show me its music universe.

The target is **maximum useful recall** with strong protection against false matches.

## How it works

MMDE is designed as an internet-scale **discovery/orchestration layer**, not a single database that must already contain everything.

```
User
  ↓
Media Resolver
  ↓
Canonical Media
  ↓
Discovery Orchestrator
  ├─ themes / relationships
  ├─ releases / music catalogs
  ├─ community discovery
  └─ controlled web/search adapters
  ↓
Normalize + Match
  ↓
Evidence + Confidence
  ↓
Independent Platform Resolution
  ├─ Spotify
  ├─ Apple Music
  ├─ Deezer
  ├─ YouTube / YouTube Music
  └─ future platforms
  ↓
Music Universe
```

A provider can be replaced without changing the core product.

AniList, MusicBrainz, AnimeThemes, Spotify, Apple Music, Deezer and YouTube are examples of possible providers/capabilities, not architectural dependencies.

## What it can discover

Depending on the media:

- Opening themes
- Ending themes
- Insert songs
- Character songs
- Theme songs
- Vocal songs
- OST releases
- Original score / background score
- Promotional or special tracks
- Albums and singles
- Music-video relationships
- Community playlists and other discovery sources

Results can be organized by season, movie, special, episode, release, or other real media context.

## Platform availability

Platforms are independent.

A recording can be:

```
Spotify      ✓
Apple Music  —
Deezer       ✓
YouTube      ✓
```

Apple Music being unavailable does not make the recording disappear.

## Chintune / AniPlaylist inspiration

AniPlaylist is an important **reference for the quality bar**, especially its granular anime music roles, per-platform availability, accumulated relationship index, and missing-link submission/review model.

MMDE takes those lessons as inspiration.

MMDE does **not** copy AniPlaylist's data, scrape it as a dependency, or assume access to its current production ingestion pipeline.

## Current development

The first serious domain is **anime**.

The first stress-test title is **That Time I Got Reincarnated as a Slime**.

The current prototype already has live diagnostics and basic provider/matching work. The next step is to evolve it into the multi-source discovery graph described in:

- docs/ARCHITECTURE.md
- docs/DISCOVERY_GRAPH.md
- docs/DATA_MODEL.md
- docs/ROADMAP.md

## Project principles

- Media-first
- Multi-source
- Provider-independent
- Maximum useful recall
- Stable identifiers before title-only matching
- Version-aware matching
- Evidence and provenance on relationships
- Platform availability per recording
- Community discovery separated from canonical evidence
- External links only
- Respect provider terms, rate limits and licensing

## Status

**Early development — anime M1 → discovery-graph expansion.**

The goal is to prove the core discovery graph before expanding to movies, TV, Indian/Telugu cinema, games and other media.
