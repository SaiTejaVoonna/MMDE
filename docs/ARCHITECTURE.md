# MMDE — Architecture

## Core architecture

MMDE is an **orchestration layer over multiple media and music sources**.

```
User
  ↓
Media Search
  ↓
Media Resolver
  ↓
Canonical Media
  ↓
Discovery Orchestrator
  ├─ Relationship providers
  ├─ Release/catalog providers
  ├─ Community/public discovery
  └─ Controlled web/search adapters
  ↓
Candidate Music
  ↓
Normalize + Deduplicate
  ↓
Music Identity + Version Matching
  ↓
Evidence + Confidence
  ↓
Platform Resolvers
  ├─ Spotify
  ├─ Apple Music
  ├─ Deezer
  ├─ YouTube / YouTube Music
  └─ Other platforms
  ↓
External Links + Discovery Sources
```

See docs/DISCOVERY_GRAPH.md for the detailed discovery model.

## Provider architecture

Providers are modular and capability-based.

Suggested capabilities:

```
MediaResolver
DiscoveryProvider
ReleaseProvider
RecordingIdentityProvider
PlatformResolver
CommunityDiscoveryProvider
ArtworkProvider
```

A single provider can implement multiple capabilities, but the core application should depend on the capability interface rather than the provider brand.

Conceptual layout:

```
providers/
  media/
  discovery/
  music/
  platforms/
  community/
  artwork/
```

Each provider returns normalized candidates plus provenance. Provider-specific data must not leak throughout the application.

## Media resolution

Media resolution answers:

> Which media does this title refer to?

AniList, TMDB, IGDB or other sources may be used as interchangeable resolvers depending on media type.

**AniList is not the MMDE core.** It is one optional anime identity source.

## Discovery orchestration

The orchestrator fans out from one canonical media entity to multiple sources.

Example:

```
Tensura S1
  ├─ anime-theme source
  ├─ music catalog
  ├─ release catalog
  ├─ community playlists
  └─ permitted web/search discovery
```

The orchestrator should tolerate partial failures. One provider returning zero or an error must not erase results from other providers.

Each discovery run should be observable:

- provider attempted;
- provider succeeded/failed;
- candidates returned;
- candidates accepted/rejected;
- match method;
- confidence;
- source URL/ID where applicable.

## Chintune / AniPlaylist as inspiration

AniPlaylist is a useful benchmark for the **product/data quality pattern** rather than a dependency.

The current site demonstrates:

- granular anime music roles such as opening, ending, insert, OST and character song;
- per-platform availability;
- a large accumulated relationship index;
- a submission/review workflow for missing official links.

MMDE should adopt the underlying lessons:

- accumulate a high-quality relationship graph;
- keep context and role;
- resolve platforms independently;
- support correction/submission workflows later;
- distinguish official/canonical evidence from community discovery.

MMDE must not clone or scrape AniPlaylist's data as its source of truth. Its current production ingestion system is not assumed to be public or reusable.

## Music identity and matching

Use a conservative matching ladder:

1. Provider-specific stable ID.
2. MusicBrainz/other catalog ID.
3. ISRC or equivalent recording identifier.
4. Release + track relationship.
5. Artist + title + album/release context.
6. Normalized title/artist + duration.
7. Fuzzy matching as a **suggestion**, not automatic confirmation.

Protect against version collisions:

- full vs TV-size;
- original vs re-recording;
- live vs studio;
- remix vs original;
- cover vs original;
- instrumental/karaoke;
- alternate language/version.

Every match should record its method and confidence.

## Media-to-music relationships

Do not make the music recording itself responsible for media context.

Represent the edge separately:

```
MediaPart
   ↓
MusicRelationship
   ↓
Recording
```

The relationship stores:

- role;
- context;
- source;
- confidence;
- match method;
- optional episode/season information.

This allows one recording to be related to multiple media contexts without duplicating the recording.

## Platform availability

Platform resolution is independent per recording.

```
Recording
  ├─ Spotify: found
  ├─ Apple Music: not found
  ├─ Deezer: found
  ├─ YouTube: found
  └─ YouTube Music: unknown
```

A missing platform link is not a missing music record.

Where an exact catalog match cannot be confirmed, a search-link fallback may be shown as **unverified** if the provider/terms allow it.

## Community and web discovery

Community playlists and controlled web discovery can increase recall, but they must not automatically become canonical truth.

A discovery candidate should carry:

- source type;
- source URL/ID;
- extracted title/artist;
- discovered role/context if present;
- extraction method;
- confidence;
- review state.

Structured sources should outrank weak search/community evidence.

## Resilience

Each provider should have:

- rate limiting;
- timeout;
- retry policy;
- circuit breaker/degraded mode;
- cache policy compatible with provider terms.

Do not make Redis, Elasticsearch, a giant crawler, or a permanent mirror mandatory for M1.

PostgreSQL is sufficient for the first persistent implementation. A worker process can handle slower discovery jobs.

## First implementation boundary

The first serious target remains **anime**, with **That Time I Got Reincarnated as a Slime** as a stress-test title.

Do not implement all media types before the anime discovery graph is proven.

The next implementation should make the current prototype evolve from:

```
media → a few providers → tracks
```

to:

```
media → discovery fan-out → candidates → identity/matching → evidence → platform availability
```
