# MMDE — Data Model

The data model represents a **media-to-music graph** without depending on any single provider.

## Core entities

### Media

A canonical media entity may contain:

- MMDE internal ID
- title
- alternate/localized titles
- media type
- release information
- parent/season relationships
- external provider IDs

Examples:

- Anime
- Movie
- TV show
- Game
- Special
- OVA

### MediaPart

A MediaPart represents the context in which music is attached:

- series
- season
- movie
- special
- OVA
- episode
- game chapter or other future context

This prevents anime-specific assumptions from leaking into the global model.

### Recording

A Recording is the canonical musical performance/version that MMDE is trying to identify.

Fields may include:

- MMDE internal ID
- title
- artists
- composers
- duration
- version/disambiguation
- ISRC(s)
- MusicBrainz recording ID
- other provider IDs
- artwork reference
- provenance

The recording should not contain the media relationship itself.

### Release

A Release represents an album, single, soundtrack, score album, theme release, compilation, etc.

Fields may include:

- MMDE release ID
- title
- release date
- label
- release type
- external IDs
- artwork
- source/provenance

### TrackOnRelease

Connects a Recording to a Release with:

- track number/disc;
- title as released;
- duration;
- release-specific identifiers;
- source.

This preserves the distinction between a recording and the many releases containing it.

## Media → music relationship

Use a first-class relationship:

```
MediaPart
   ↓
MusicRelationship
   ↓
Recording
```

MusicRelationship fields:

- relationship ID
- media part ID
- recording ID
- role
- context text
- episode/season metadata when known
- source/provider
- source record ID/URL
- match method
- confidence
- review state
- created/updated timestamps

## Track roles

Initial roles can include:

- Opening
- Ending
- Insert
- Character song
- Theme
- Vocal song
- OST
- Original score
- Promotional
- Image song
- Music video
- Other

Roles are relationship/context data. Do not make them intrinsic properties of a recording.

## Platform availability

Platform links are independent per recording.

Conceptually:

```
PlatformAvailability
  recording_id
  platform
  status
  external_id
  url
  country/region (optional)
  match_method
  confidence
  source
  checked_at
```

Possible status values:

- found
- not_found
- unknown
- unverified

A missing Apple Music link must not suppress a recording that is available elsewhere.

## Discovery sources

Community playlists and web-discovered candidates need their own provenance:

```
DiscoverySource
  source_type
  source_id
  source_url
  title
  provider
  extracted_at
  extraction_method
```

A source can point to:

- YouTube playlist
- Spotify playlist
- album/release page
- official artist/label page
- community page
- search result
- other permitted public source

DiscoverySource is evidence/discovery, not automatic canonical truth.

## Source records

Keep enough source information to explain how a field or relationship was discovered.

Useful fields:

- provider
- provider object ID
- raw/normalized payload reference where terms permit
- source URL
- retrieved timestamp
- extraction method
- provider version
- license/retention policy

This supports debugging, conflict resolution, confidence scoring and provider replacement.

## Identity and matching

Prefer this ladder:

1. Stable provider ID
2. MusicBrainz/other catalog ID
3. ISRC
4. Release + track relationship
5. Artist + title + release context
6. Normalized title/artist + duration
7. Fuzzy suggestion

Every match should retain its method and confidence.

Version guardrails must distinguish:

- full / TV-size
- original / re-recording
- studio / live
- remix
- cover
- instrumental/karaoke
- language/version variants

## Internal IDs

MMDE-owned IDs are the primary keys.

External IDs are cross-references only.

This keeps the system replaceable if a provider disappears, changes terms, or is replaced.
