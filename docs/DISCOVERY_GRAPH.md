# MMDE — Discovery Graph

## Purpose

MMDE should behave like an internet-scale **discovery/orchestration layer**, not a giant database that must already contain every media title and every song.

The user gives MMDE a media title. MMDE resolves the media, asks multiple discovery providers what music relationships they know, normalizes the candidates, resolves music identity, and then checks where each recording can be found.

```
User
  ↓
Media Resolver
  ↓
Canonical Media
  ↓
Discovery Orchestrator
  ├─ relationship providers
  ├─ release/catalog providers
  ├─ community/public discovery
  └─ web/search adapters (where permitted)
  ↓
Candidate Music
  ↓
Identity + Version Matching
  ↓
Evidence / Confidence
  ↓
Platform Resolvers
  ├─ Spotify
  ├─ Apple Music
  ├─ Deezer
  ├─ YouTube / YouTube Music
  └─ future platforms
  ↓
Unified Music Universe
```

## Provider roles

A provider is selected by **capability**, not by brand.

### Media resolver

Answers:

> What media did the user mean?

Examples: anime, movie, TV, game and future media identity providers.

A provider such as AniList can be used here, but MMDE must not depend on AniList as its core architecture.

### Discovery provider

Answers:

> What music is related to this media?

A discovery provider may return themes, songs, releases, OSTs, character songs, albums, playlists, videos, or other candidate relationships.

### Music identity provider

Answers:

> What real recording/release is this candidate?

Stable identifiers such as MBIDs and ISRCs are preferred. Title-only matching is a fallback.

### Platform resolver

Answers:

> Where can this recording be found?

Each platform is independent. Missing Spotify must not hide a track that exists on YouTube or Deezer.

### Community discovery provider

Answers:

> What useful public/community collections can help discover music that structured catalogs missed?

Examples include public YouTube or Spotify playlists, where access and use are permitted.

Community sources are **evidence/discovery**, not automatic proof of an official recording relationship.

## The Chintune / AniPlaylist lesson

AniPlaylist is a useful product reference for one important reason: it demonstrates the value of a large, media-to-music relationship index with granular roles and **per-platform availability**, rather than assuming one platform contains the whole catalog.

Current AniPlaylist materials describe a database of more than 28,000 songs/albums and 180,000 individual music links, support for Spotify, Apple Music and Deezer, and a submission/review workflow for missing official links.

MMDE should learn from that model:

- build a useful relationship graph over time;
- keep track roles/context;
- treat platform links independently;
- allow missing records/links to be discovered and reviewed;
- make provenance visible;
- prioritize coverage and correctness together.

MMDE should **not** copy AniPlaylist's database, scrape it as a dependency, or assume its private/current ingestion pipeline. Chintune/AniPlaylist is inspiration and a benchmark, not an upstream provider.

## Discovery strategy

MMDE should use a layered strategy:

1. **Structured sources first** for high-confidence relationships.
2. **Catalog/release sources** to expand and identify recordings.
3. **Platform lookups** to resolve availability.
4. **Community/public discovery** to find additional candidates and playlists.
5. **Search/web adapters** as a controlled fallback where permitted.
6. **Human review/curation** for persistent low-confidence or missing relationships.

Every discovered candidate should retain provenance.

## Search/web discovery

A future web/search adapter may:

1. generate title/alternate-title/locale query variants;
2. search permitted public sources;
3. fetch permitted result pages;
4. extract candidate song/artist/release/playlist data;
5. pass candidates through the same identity matcher;
6. store source URL + extraction method + confidence.

A search result alone is never proof of an official media relationship.

MMDE must respect provider terms, rate limits, robots/access restrictions, authentication requirements and copyright/licensing constraints. The goal is controlled discovery, not an unrestricted crawler.

## Community playlists

Community playlists are a first-class **discovery source**, not a replacement for canonical tracks.

For a media such as Slime, MMDE may discover:

- official platform tracks;
- community YouTube playlists;
- community Spotify playlists;
- soundtrack/OST collections;
- opening/ending collections.

The UI can show these under a separate "Discovery sources" area so users get more recall without confusing a playlist with canonical media metadata.

## Evidence model

Every relationship should be explainable:

```
media
  → recording
  → role/context
  → source(s)
  → match method
  → confidence
  → platform availability
```

Example:

```
Meguru Mono
  Media: Tensura S1
  Role: Opening
  Recording: MusicBrainz recording
  Evidence: anime-music source + music catalog
  Match: title + artist + catalog identity
  Confidence: high
  Spotify: found
  Apple Music: not found
  Deezer: found
  YouTube: found
```

"Apple Music not found" means only that Apple Music was not resolved. It does **not** mean the music does not exist.

## Why this architecture scales

The core graph does not care whether the media is:

- anime;
- Telugu cinema;
- Hollywood film;
- TV series;
- game;
- documentary;
- future media type.

Only the resolver/discovery providers change.

That is the key architectural difference between MMDE and a single-source anime database.
