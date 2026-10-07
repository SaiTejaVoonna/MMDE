# MMDE — AI Collaboration & Handoff

This file is the shared handoff space for AI assistants working on MMDE.

It is **not** a raw chat transcript. It records useful context, active work, questions, and decisions that another AI assistant should know when continuing the project.

## How to use this file

Before starting substantial work:

1. Read `README.md`.
2. Read `docs/PROJECT_CONTEXT.md`.
3. Read `docs/ARCHITECTURE.md`.
4. Read `docs/DECISIONS.md`.
5. Read `docs/ROADMAP.md`.
6. Read this file.

After substantial work, update this file with concise handoff information when another AI assistant may need it.

Do not copy entire conversations into this file. Record only information that is useful for continuing the project.

---

## Current collaboration status

**Project:** MMDE — Media Music Discovery Engine

**Stage:** Early architecture / foundation

**Primary goal:** Build a media-first system that takes a media title and discovers its associated music, then provides external platform links.

**Current priority:** Establish the foundation and data model before building a large number of integrations.

---

## Shared understanding

MMDE is:

```
Media title
    ↓
Media identity
    ↓
Music discovery
    ↓
Normalize / merge
    ↓
Music identity / matching
    ↓
External platform links
```

MMDE is NOT a music streaming or hosting service.

It should:

- Discover songs and music relationships.
- Include themes, openings, endings, inserts, character songs, OSTs, original scores, and relevant releases where available.
- Combine multiple sources.
- Prefer stable identifiers and strong matching.
- Provide links to external music platforms.
- Aim for maximum useful recall while protecting against false matches.

---

## ChatGPT ↔ Claude handoff

There is no direct automatic conversation channel between ChatGPT and Claude.

This file acts as the shared handoff layer.

### ChatGPT's role

ChatGPT can be used primarily for:

- Architecture discussions
- Research
- Comparing APIs/providers
- Data-model design
- Reasoning about product behavior
- Reviewing implementation decisions
- Planning the next development step

When ChatGPT makes an important project-level decision, it should be reflected in `DECISIONS.md` or this file.

### Claude's role

Claude can be used primarily for:

- Repository exploration
- Implementation
- Refactoring
- Tests
- Code review
- Iterating on the working codebase

Claude should inspect the repository and documentation before making changes.

### User's role

The user acts as the coordinator between both assistants.

The user can bring an implementation result, question, or proposal from one assistant to the other.

---

## Active handoff

### Current task

No implementation task is currently assigned.

### Current blockers

None recorded.

### Questions for discussion

None currently recorded.

### Recently completed

- Created the main MMDE README.
- Created the shared project documentation structure.
- Added project context, architecture, decisions, roadmap, and data-model documentation.
- Added agent instructions/context guidance for AI-assisted development.

---

## Handoff format

When leaving useful information for the next AI assistant, use this format:

### From: ChatGPT
**Date:** YYYY-MM-DD

**What changed:**
- ...

**Important findings:**
- ...

**Decision needed:**
- ...

**Recommended next step:**
- ...

### From: Claude
**Date:** YYYY-MM-DD

**What changed:**
- ...

**Implementation notes:**
- ...

**Problems / blockers:**
- ...

**Questions for ChatGPT:**
- ...

---

## Important rule

Keep this file concise.

The detailed project truth belongs in:

- `PROJECT_CONTEXT.md` — overall context
- `ARCHITECTURE.md` — architecture
- `DECISIONS.md` — settled decisions
- `ROADMAP.md` — planned work
- `DATA_MODEL.md` — data structures

Use this file for **handoffs, active work, unresolved questions, and collaboration state**.
