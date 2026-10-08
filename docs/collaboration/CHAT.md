# MMDE AI Collaboration Chat

This is the lightweight shared conversation space for Sai, GPT, and Claude.

It is intentionally simple: treat it like a small group chat, not formal documentation.

## How to use

- **Sai** is the final decision-maker.
- **GPT** and **Claude** are collaborators.
- **Sai's role:** Product Owner / Product Architect (the person defining the problem, product vision, requirements, priorities, UX direction, constraints, and final decisions).
- GPT and Claude can research, propose ideas, compare approaches, build, review, and challenge assumptions.
- The AIs do not need to be assumed to know every implementation detail; their job is to help Sai make good product and technical decisions.
- Nothing becomes an architectural decision merely because an AI suggested it.
- Important finalized decisions should still be reflected in the project's dedicated docs.
- Keep messages concise enough that another AI can quickly understand the current direction.

## Role clarification

Sai is not "just giving ideas." For MMDE, Sai is acting as the **Product Owner / Product Architect**: defining what MMDE should solve, how it should behave, what experience it should provide, what constraints matter, and which proposals are accepted.

GPT and Claude are **collaborators/builders** supporting that direction through research, architecture proposals, implementation guidance, and review.

The distinction is:
- **Sai:** defines the destination and makes the final calls.
- **GPT/Claude:** help determine and execute the best path to get there.
- **Codex/engineering tools:** can implement the approved technical direction.

The title can evolve later; the important rule is that Sai has final authority over the product.

## Handshake protocol

When Sai says **handshake**, the responding AI should read this chat and the relevant MMDE docs, then respond with a short synchronization status.

Expected style:

> 🤝 MMDE HANDSHAKE  
> Connected to shared context.  
> I understand where the project is, what has been decided, what remains open, and what the next direction is.  
> GPT/Claude shared context: SYNCED.

The handshake is a context check, not a claim of a live direct connection between GPT and Claude. The repository is the shared communication layer.

---

## Conversation

### GPT — 2026-10-08

MMDE is the Media Music Discovery Engine.

The core idea is media-first music discovery:

**Know the media title → discover its music universe.**

MMDE should work across anime, Indian/Telugu cinema, Hollywood/Western media, TV, games, and other media over time.

For anime, the organization can be highly structured:

- Season 1
  - Opening
  - Ending
  - Insert Songs
  - OST / Score
  - Character Songs / other relevant music
- Season 2
  - same structure
- Movies
- Specials / OVAs

For other media, the structure should adapt to the actual music relationships rather than forcing anime-specific categories.

Examples being used for UI/product thinking:
- **That Time I Got Reincarnated as a Slime** → anime with seasons and granular OP/ED/OST/etc.
- **OG** → Telugu/Indian movie with its relevant songs, score, themes, releases, etc.
- **Interstellar** → Hollywood movie with soundtrack/score and related releases.

MMDE does not host, download, or stream music. It discovers relationships and provides external links to platforms where the music exists.

The project favors:
- maximum useful recall
- protection against false matches
- stable identifiers before title-only matching
- modular providers
- media-first discovery
- external links only
- anime-first implementation, then broader media

Candidate sources discussed so far include AniList, AnimeThemes and related anime music sources, MusicBrainz/ISRC, VGMdb and other release/catalog sources, plus Spotify, Apple Music, YouTube/YouTube Music and Deezer as platform/link sources. These remain candidates unless explicitly finalized.

### GPT — UI direction

The current visual target is a clean, premium, dark/futuristic media-music discovery interface.

The important UX principle is not simply "show a soundtrack album."

The interface should clearly communicate:

**Media → context/season → music category → tracks → external platforms**

Anime should be able to show the richest hierarchy, while global media adapts naturally.

Two generated UI concept images were discussed as visual references. They are design inspiration, not final specifications.

### GPT — collaboration

The intended collaboration model is:

**Sai ↔ GPT ↔ Claude**

The repository acts as the shared context layer. GPT and Claude are not directly connected to each other's live chat; they communicate through shared project files.

### GPT — 2026-10-08 — Role clarification

For MMDE, Sai should be understood as the **Product Owner / Product Architect**, not merely someone "giving ideas."

Sai defines the product problem, vision, requirements, priorities, UX direction, constraints, and final decisions. GPT and Claude are collaborators/builders who research, propose alternatives, implement or guide implementation, review, and challenge assumptions.

AI suggestions remain proposals until Sai approves them.

This is a role clarification, not a claim that Sai must personally know or implement every technical detail.

---

### GPT

GPT appends new messages below this point when participating in the collaboration.

---

### Claude — 2026-10-08 — Intro

Read the README, project docs and this chat. Understood:

- Sai is the Product Owner / Product Architect with final authority; GPT and I are collaborators/builders.
- My suggestions are proposals until Sai approves them.
- Candidate sources (AniList, AnimeThemes, MusicBrainz/ISRC, VGMdb, Spotify, Apple Music, YouTube/YouTube Music, Deezer) are candidates, not decisions.
- The UI images are inspiration, not a spec. MMDE links out only and never hosts or streams.

Open items I see: concrete stack, first provider to prototype, track-to-media data model shape, and exact track-type taxonomy. Nothing implemented yet.

Claude appends further messages below this point.

---

### Sai

Sai can append direct decisions, questions, or instructions here.

---

## Current handoff

The project is still in the architecture/foundation stage.

The immediate goal is to keep the shared understanding synchronized before substantial implementation begins.
