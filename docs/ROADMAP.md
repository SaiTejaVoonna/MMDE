# MMDE — Roadmap

## Phase 1 — Foundation

- [x] Define media-first product model
- [x] Define initial music relationship model
- [x] Define modular provider concept
- [x] Define discovery-graph direction
- [x] Establish AI collaboration/handoff
- [ ] Implement canonical media model
- [ ] Implement normalized recording/release model
- [ ] Implement provider capability interfaces

## Phase 2 — Anime M1: Discovery graph

Target: **That Time I Got Reincarnated as a Slime**.

- [x] Basic anime media resolution prototype
- [x] Basic theme/music discovery prototype
- [x] Music identity matching prototype
- [x] Live diagnostics workflow
- [ ] Multi-provider discovery fan-out
- [ ] Normalize candidates into MediaPart → MusicRelationship → Recording
- [ ] Record provenance and confidence for every relationship
- [ ] Add version guardrails
- [ ] Separate canonical tracks from discovery/community sources
- [ ] Scope releases to the selected media part
- [ ] Improve Slime recall and false-match rate
- [ ] Benchmark Slime against additional anime titles

## Phase 3 — Platform availability

- [ ] Resolve Spotify independently
- [ ] Resolve Apple Music independently
- [ ] Resolve Deezer independently
- [ ] Resolve YouTube / YouTube Music independently
- [ ] Show platform availability per recording
- [ ] Keep a recording visible when one platform is missing
- [ ] Add clearly labelled unverified search-link fallbacks where permitted
- [ ] Add platform match method/confidence

## Phase 4 — Community / web discovery

- [ ] Community playlist provider interface
- [ ] YouTube playlist discovery
- [ ] Spotify playlist discovery where access permits
- [ ] Controlled web/search discovery adapter
- [ ] Extract candidate title/artist/release/context
- [ ] Run all candidates through the same identity matcher
- [ ] Store discovery-source provenance
- [ ] Separate community evidence from canonical relationships

## Phase 5 — Curation and quality

Inspired by lessons from AniPlaylist/Chintune, without copying its data:

- [ ] Missing-link submission workflow
- [ ] Human review queue
- [ ] Duplicate/merge tools
- [ ] Relationship correction workflow
- [ ] Source disagreement handling
- [ ] Confidence/ranking evaluation
- [ ] Recall vs false-match benchmark dataset

## Phase 6 — Broader media

- [ ] Movies
- [ ] TV shows
- [ ] Indian / Telugu cinema
- [ ] Western media
- [ ] Games
- [ ] Specials and other media formats

## Phase 7 — Performance / scale

- [ ] Provider-specific rate limiting
- [ ] TTL caching compatible with terms
- [ ] Background worker for slow discovery
- [ ] PostgreSQL persistence
- [ ] Search/indexing improvements
- [ ] Add heavier infrastructure only when measured need appears

## Guiding rule

Build the **discovery graph and evidence system first**. Add providers incrementally. Never let one provider become the definition of MMDE.
