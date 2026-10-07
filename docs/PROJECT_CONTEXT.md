# MMDE — Project Context

## What is MMDE?

**MMDE (Media Music Discovery Engine)** is a media-first music discovery engine.

The user starts with a media title — anime, movie, TV show, game, or other media — and MMDE discovers the music associated with it.

> Know the media. Discover its music.

## Core Flow

```
Media title
  ↓
Media entity resolution
  ↓
Music discovery
  ↓
Normalize & merge
  ↓
Music identity / matching
  ↓
Platform links
```

## What MMDE should discover

Depending on the media, MMDE may find:

- Songs
- Opening themes
- Ending themes
- Insert songs
- Character songs
- Vocal themes
- OST releases
- Original score / background score
- Promotional or special tracks
- Albums and singles
- Music associated with movies, seasons, specials, OVAs, etc.

Music categories should remain distinguishable. "OST" should not automatically mean every song associated with the media.

## External-link principle

MMDE is a discovery/indexing layer.

It does **not**:

- Host music
- Download music
- Stream music
- Become a music player

It provides external links to services where the music is available.

Possible platforms include:

- Spotify
- Apple Music
- YouTube / YouTube Music
- Deezer
- Other services as support is added

A platform can be unavailable for a particular track. Missing one platform should not prevent the track from being shown.

## Discovery philosophy

### Maximum useful recall

MMDE should try to discover as much relevant music as possible rather than assuming one database is complete.

### Multi-source architecture

No single provider should be treated as the universal source of truth.

Different providers can contribute:

- Media identity
- Theme relationships
- Release information
- Music metadata
- Recording identifiers
- Platform availability

### Stable identity

Where possible, matching should use stable identifiers such as ISRCs and database IDs instead of title strings alone.

## Initial development scope

Start with **anime**, especially media with strong structured music metadata.

Then expand toward:

1. Movies
2. TV shows
3. Indian / Telugu cinema
4. Western media
5. Games
6. Specials / OVAs
7. Other media types

## Current development philosophy

Keep the first implementation small and modular.

Do not start by integrating dozens of APIs. Build the core media → music relationship model first, then add providers incrementally.

The provider layer should be replaceable. MMDE should not be tightly coupled to one external project or API.

## AI collaboration

This repository is intended to be worked on with multiple AI coding assistants.

Before making significant architectural changes:

1. Read this file.
2. Read `docs/ARCHITECTURE.md`.
3. Read `docs/DECISIONS.md`.
4. Check `docs/ROADMAP.md`.
5. Inspect the existing code before proposing replacements.

Important project decisions should be recorded in `DECISIONS.md` so future AI sessions do not repeatedly reconsider settled choices.

## Current status

**Early development / architecture phase.**

The repository is currently focused on defining the correct architecture and data model before building the complete discovery pipeline.
