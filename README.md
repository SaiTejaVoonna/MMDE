# MMDE

## Media Music Discovery Engine

MMDE is a media-first music discovery engine.

Search for a **movie, anime, TV show, game, or other media title**, and MMDE discovers the music associated with it — including songs, opening/ending themes, insert songs, character songs, OSTs, original scores, promotional tracks, and related releases.

> **Know the media. Discover its music.**

## What it does

- Search for a media title.
- Resolve the correct media entry.
- Discover as much relevant music as possible from multiple sources.
- Organize music by season, movie, special, release, or context where possible.
- Match the same recording across music services.
- Provide external links to Spotify, Apple Music, YouTube, Deezer, and other platforms when available.

MMDE is a **discovery and indexing layer**. It does not host, download, or stream music.

## Example

For an anime, the result can be organized like:

```
Season 1
  Opening
  Ending
  Insert Songs
  Character Songs
  OST / Original Score

Season 2
  Opening
  Ending
  Insert Songs
  OST / Original Score

Movies
  Theme Songs
  Songs
  OST / Score

Specials / OVAs
  Related Music
```

Each track can contain:

- Title
- Artist / composer
- Album
- Track type
- Media / season / movie context
- Release information
- Artwork
- External platform links

A platform can simply be unavailable for a particular track:

```
Spotify      ✓
Apple Music  ✓
YouTube      ✓
Deezer       —
```

## The idea

Most music discovery is **music-first**:

> Find this song.

MMDE is **media-first**:

> I know this media title. Show me its music universe.

The goal is maximum useful recall, not dependence on one database or one platform.

## Core principles

### Multi-source discovery

No single provider is expected to contain every music relationship or release. MMDE combines sources and normalizes their data.

### Stable music identity

Where possible, tracks should be matched using stable identifiers such as ISRCs and database IDs instead of title strings alone.

### Clear categories

Songs, themes, inserts, character songs, OST releases, and original score should remain distinguishable.

### External links

MMDE discovers music and sends the user to the service where it is available. It is not a music streaming service.

## Architecture

```
User
  ↓
Media Search
  ↓
Media Entity Resolver
  ↓
Canonical Media
  ↓
Music Discovery
  ├─ Themes
  ├─ Songs
  ├─ Insert / Character Songs
  ├─ OST / Original Score
  └─ Related Releases
  ↓
Normalize & Merge
  ↓
Music Identity / Matching
  ├─ Spotify
  ├─ Apple Music
  ├─ YouTube
  ├─ Deezer
  └─ Other providers
  ↓
External Music Links
```

Providers are intended to be modular so sources can be added or replaced without changing the core discovery logic.

## Initial scope

MMDE will begin with **anime and media with strong structured music metadata**, then expand to:

- Movies
- TV shows
- Indian / Telugu cinema
- Western media
- Games
- Specials and OVAs
- Other media types

## Roadmap

- [ ] Media title search and canonical entity resolution
- [ ] Anime music discovery
- [ ] Opening / ending / insert themes
- [ ] OST and original-score discovery
- [ ] Multi-source normalization
- [ ] Music identity matching
- [ ] Spotify links
- [ ] Apple Music links
- [ ] YouTube links
- [ ] Additional music platforms
- [ ] Season / movie / special organization
- [ ] Duplicate and confidence handling
- [ ] Movie and TV support
- [ ] Indian / Telugu media support
- [ ] Game music support

## Status

**Early development / architecture phase.**

The project is intentionally starting small. The first priority is getting the media-to-music data model, provider architecture, matching, and discovery flow right before adding many integrations.

## License

License to be added.
