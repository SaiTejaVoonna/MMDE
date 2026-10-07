# MMDE — Data Model

The data model should represent relationships between media and music without depending on any single provider.

## Media

A canonical media entity may contain:

- Internal ID
- Title
- Alternate titles
- Media type
- Release information
- Parent / season relationships
- External provider IDs

Examples of media types:

- Anime
- Movie
- TV show
- Game
- Special
- OVA

## Music track

A normalized track may contain:

- Internal ID
- Title
- Artists
- Composer
- Album
- Track type
- Media relationship
- Season / movie / special context
- Release information
- Artwork
- External identifiers
- Platform links
- Source records
- Match confidence

## Track types

Initial categories can include:

- Opening
- Ending
- Insert
- Character song
- Theme
- Vocal song
- OST
- Original score
- Promotional
- Other

The exact taxonomy can evolve as provider coverage improves.

## Platform links

Platform links should be stored as external references, for example:

```
{
  "spotify": "...",
  "appleMusic": "...",
  "youtube": "...",
  "deezer": "..."
}
```

A missing link should be represented as unavailable rather than treated as an error.

## Source records

Keep enough source information to understand where a relationship or metadata field came from.

This will help with:

- Debugging
- Conflict resolution
- Confidence scoring
- Updating stale data
- Provider replacement
