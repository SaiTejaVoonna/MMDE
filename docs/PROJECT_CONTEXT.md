# MMDE — Project Context

## What is MMDE?

**MMDE (Media Music Discovery Engine)** is a media-first music discovery engine.

The user starts with a media title — anime, movie, TV show, game, or other media — and MMDE discovers the associated music universe.

> Know the media. Discover its music.

MMDE should feel like a **browser/orchestrator for media-to-music discovery**: it can ask many permitted sources instead of requiring one database to already contain the complete answer.

## Core Flow

```
Media title
  ↓
Media resolver
  ↓
Canonical media
  ↓
Discovery orchestrator
  ↓
Candidates
  ↓
Normalize / deduplicate
  ↓
Music identity + version matching
  ↓
Evidence / confidence
  ↓
Platform availability
  ↓
External links + discovery sources
```

## Discovery philosophy

### Maximum useful recall

MMDE should discover as much relevant music as possible while protecting against false matches.

### No universal provider

No provider is the source of truth for the entire product.

AniList may resolve anime identity. AnimeThemes may provide theme relationships. MusicBrainz may identify recordings/releases. Platform services may resolve links. Community playlists and controlled web discovery can reveal additional candidates.

All are replaceable capabilities.

### Chintune / AniPlaylist inspiration

AniPlaylist is an important reference for the **quality bar**, not a dependency.

Useful lessons from the current product include:

- granular music roles/context;
- independent platform availability;
- a large accumulated relationship index;
- a way for users to submit missing official links;
- review/curation as part of maintaining quality.

MMDE should learn from this pattern without copying its database or depending on its internal ingestion system.

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
- Community playlists
- Related public discovery sources

Music categories should remain distinguishable. "OST" should not automatically mean every song associated with the media.

## External-link principle

MMDE is a discovery/indexing layer.

It does **not**:

- host music;
- download music;
- stream music;
- become a music player.

It provides external links to services where music is available.

A platform can be unavailable for a particular recording. Missing Apple Music does not remove a recording that exists on YouTube, Deezer, Spotify or another source.

## Evidence principle

Every relationship should be explainable:

```
media part
  → recording
  → role/context
  → source(s)
  → match method
  → confidence
  → platform availability
```

Community/web discovery is evidence, not automatic canonical truth.

## Initial development scope

Start with **anime**, especially **That Time I Got Reincarnated as a Slime** as the first serious stress test.

Then expand toward:

1. Movies
2. TV shows
3. Indian / Telugu cinema
4. Western media
5. Games
6. Specials / OVAs
7. Other media types

## Current status

The repository now has:

- the M1 Slime prototype on prototype/m1-slime;
- live diagnostics automation;
- a discovery-graph architecture proposal;
- a recording/release/relationship data-model direction;
- a roadmap for platform and community discovery.

The next engineering goal is to evolve the prototype from a small provider pipeline into a **multi-source discovery orchestrator with provenance, confidence and independent platform availability**.
