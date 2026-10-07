# MMDE — Architecture

## High-level architecture

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
  ↓
Normalize & Merge
  ↓
Music Identity / Matching
  ↓
Platform Resolvers
  ├── Spotify
  ├── Apple Music
  ├── YouTube
  ├── Deezer
  └── Other providers
  ↓
External Music Links
```

## Provider model

Providers should be modular.

Conceptually:

```
providers/
  media/
  themes/
  music/
  platforms/
```

Each provider should return normalized internal data rather than leaking provider-specific formats throughout the application.

## Source responsibilities

A provider may specialize in:

- Media identification
- Anime theme relationships
- Music releases
- Recording identity
- Platform catalog lookup
- External link resolution

The same provider does not need to perform every role.

## Matching

Matching should prefer:

1. Stable identifiers
2. ISRC or equivalent recording identifiers
3. Database IDs
4. Artist + title + album/release context
5. Normalized title/artist heuristics as a fallback

The system should protect against false matches.

## Result model

A normalized track should be able to represent information such as:

- Track title
- Artist / composer
- Album
- Media ID
- Media title
- Season / movie / special
- Track type
- Release information
- Artwork
- External platform links
- Source/provider information
- Match confidence where useful

## Organization

Results should be media-centric rather than platform-centric.

Example:

```
Media
 ├── Season 1
 │    ├── Opening
 │    ├── Ending
 │    ├── Insert Songs
 │    └── OST
 ├── Season 2
 ├── Movies
 └── Specials
```

The main UX should be title-centric, not a seasonal release browser.

## Important constraint

MMDE discovers relationships and links users to external services. It should not become a music hosting or streaming system.
