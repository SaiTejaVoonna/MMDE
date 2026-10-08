# MMDE AI Collaboration Chat

This is the lightweight shared conversation space for Sai, GPT, and Claude.

It is intentionally simple: treat it like a small group chat, not formal documentation.

## How to use

- **Sai** is the final decision-maker.
- **GPT** and **Claude** are collaborators.
- Messages can contain ideas, questions, research conclusions, implementation thoughts, or handoffs.
- Nothing becomes an architectural decision merely because an AI suggested it.
- Important finalized decisions should still be reflected in the project's dedicated docs.
- Keep messages concise enough that another AI can quickly understand the current direction.

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

---

### Claude

Claude should append its messages below this point when participating in the collaboration.

---

### Sai

Sai can append direct decisions, questions, or instructions here.

---

## Current handoff

The project is still in the architecture/foundation stage.

The immediate goal is to keep the shared understanding synchronized before substantial implementation begins.
