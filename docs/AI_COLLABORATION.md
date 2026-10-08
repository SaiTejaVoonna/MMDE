# MMDE — AI Collaboration & Handoff

This file is the shared handoff space for AI assistants working on MMDE.

It is **not** a raw chat transcript. It records useful context, active work, questions, and decisions that another AI assistant should know when continuing the project.

## How to use this file

Before substantial work:

1. Read README.md.
2. Read docs/PROJECT_CONTEXT.md.
3. Read docs/ARCHITECTURE.md.
4. Read docs/DECISIONS.md.
5. Read docs/ROADMAP.md.
6. Read docs/DATA_MODEL.md.
7. Read docs/DISCOVERY_GRAPH.md.
8. Read this file and docs/collaboration/CHAT.md.

After substantial work, leave a concise handoff.

---

## Current collaboration status

**Project:** MMDE — Media Music Discovery Engine

**Stage:** Anime M1 prototype → discovery-graph expansion

**Primary goal:** Build a media-first system that takes a media title and discovers its associated music, then provides external platform links.

**Current priority:** Turn the working Slime prototype into a multi-source discovery orchestrator without locking MMDE to AniList, one music database, or one streaming platform.

---

## Shared understanding

MMDE is:

```
Media title
    ↓
Media identity
    ↓
Discovery fan-out
    ↓
Normalize / merge
    ↓
Music identity / matching
    ↓
Evidence + confidence
    ↓
Platform availability
    ↓
External links
```

MMDE is NOT a music streaming or hosting service.

It should:

- maximize useful recall;
- protect against false matches;
- keep media/music roles and context;
- preserve provenance;
- treat platforms independently;
- allow community/web discovery without treating it as automatic truth.

---

## Chintune / AniPlaylist reference

ChatGPT researched the current AniPlaylist product as an architectural/product-quality reference.

Useful lessons:

- granular anime music roles;
- independent platform availability;
- accumulated relationship data;
- missing-link submission and review;
- platform-link coverage as a first-class concern.

Current AniPlaylist materials describe a large indexed catalog and multiple platform links. MMDE should learn from the **pattern**, not copy/scrape the data or depend on its private/current pipeline.

---

## Current implementation state

Claude's M1 work added:

- Slime live discovery;
- MusicBrainz/Deezer-related matching and diagnostics;
- a diagnostics GitHub Actions workflow;
- browser/server checks;
- candidate explanations for unmatched tracks;
- artist/title retry and normalization improvements.

The diagnostics workflow is intended to remove the need for manual copy/paste between assistants.

The prototype is useful, but current coverage is still limited. Do not interpret a zero-result title as proof that the music does not exist; it may simply mean the current discovery inputs are incomplete.

---

## Recommended next engineering slice

Implement the smallest vertical slice of the discovery graph:

1. canonical media result;
2. provider capability interface;
3. fan-out to two or more discovery providers;
4. normalized candidate records;
5. MediaPart → MusicRelationship → Recording;
6. provenance + confidence;
7. independent platform availability;
8. community playlist records as separate discovery sources.

Keep the existing M1 tests passing.

Do not add unrestricted crawling, giant infrastructure, or every media type in this slice.

---

## Collaboration roles

### Sai

Sai is the **Product Owner / Product Architect** and final authority.

### GPT

GPT focuses on:

- architecture;
- research;
- provider comparison;
- product behavior;
- data-model reasoning;
- review/challenge.

### Claude

Claude can focus on:

- repository exploration;
- implementation;
- refactoring;
- tests;
- implementation review.

### Codex / engineering tools

Can implement an approved technical direction.

AI proposals are not decisions until Sai approves them.

---

## Active handoff

### From: ChatGPT
**Date:** 2026-10-08

**What changed:**
- Added the discovery-graph architecture.
- Explicitly made AniList optional rather than foundational.
- Added capability-based provider orchestration.
- Added community/web discovery as a controlled recall layer.
- Added independent platform availability.
- Added Chintune/AniPlaylist lessons as inspiration, without treating its data or pipeline as reusable.
- Expanded the data model around MediaPart → MusicRelationship → Recording.
- Updated roadmap and decisions.

**Recommended next step:**
Implement the discovery-orchestrator vertical slice on top of the current M1 Slime prototype.
