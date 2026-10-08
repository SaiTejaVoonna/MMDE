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

### Claude — 2026-10-08 — Research pass delivered

Sai asked for a broad provider/architecture validation. Full report: `docs/collaboration/CLAUDE_RESEARCH_2026-10-08.md` (proposal only, nothing approved; ✅ sourced vs ⚠️ unverified items marked).

Top points: (1) "free" is thinner than assumed (Spotify gated, YouTube ~100 searches/day, AniList/TMDB commercial thresholds); (2) AniList terms forbid using the API as data storage, which conflicts with a local DB; (3) MusicBrainz + AnimeThemes are the open backbone; (4) no open source found for Telugu/Indian cinema or TV/film scene music; (5) stack is fine, but prefer Next.js + worker, Postgres-only, one TS codebase for now.

Questions for Sai: is MMDE commercial? Is a curated layer OK for Telugu cinema? Are search-link fallbacks OK? GPT: please review and add findings.

---

### Claude — 2026-10-08 — M1 Slime prototype on branch `prototype/m1-slime`

Sai approved building a personal, non-commercial prototype first (commercialization later). Pushed to branch `prototype/m1-slime`, NOT `main`. Please fetch that branch to review.

What exists (Node 22.18+, no dependencies; `npm test`, `npm run slime`): domain model, provider interfaces, matching with version guard (instrumental/live/TV-size never merge with original; same title + different artist can never confirm), pipeline with confirmed/suggested/unverified status, organizer (Season -> role), evaluator (precision/recall vs ground truth), and untested live adapters for AniList and MusicBrainz.

Important caveats:
- My sandbox's network policy blocks Wikipedia, AniList, MusicBrainz and Deezer (403), so the live adapters are UNTESTED. Run them locally or from an unrestricted environment.
- `data/ground-truth/slime.s1.json` is built from web-search summaries only (no primary page read). Sai asked GPT and me to both verify it; GPT, please check it against the listed sources, especially OP2/ED2 and the episode-23 insert song, which the seed does not yet include.
- UPDATE: the full stack is now on the branch (see `docs/PROTOTYPE_RUNBOOK.md`): HTTP server + job progress API, JSON store, web UI (search, progress, filters, per-track platform links, OST release section), Wikipedia+LLM extractor with a verbatim-quote guard, Deezer link resolver, search-link fallbacks. 27 tests + 17 headless-browser checks pass offline; all live adapters are untested.

### Claude — 2026-10-08 — Browser-only mode (Sai asked for "browser philosophy")

Sai found a server hard to run, so the app now also runs entirely in the browser: `web/index.html` + one bundled script `web/mmde.js` (built with esbuild from `src/browser/main.ts`; build output is committed). Works from file:// by double-click or any static host; with no server it calls AniList, MusicBrainz and Wikipedia directly from the browser, persists results in localStorage, and has a Settings panel (live providers toggle, optional Anthropic key for the Wikipedia+AI extractor). If served by the Node server it uses the server API instead. See `docs/PROTOTYPE_RUNBOOK.md`.

Live site: https://saitejavoonna.github.io/MMDE/ (GitHub Pages from branch `gh-pages`; Sai enabled Pages, repo is public). GPT: please open it and try "slime" (offline sample) and a live title like "jujutsu kaisen"; report any Provider notes errors here. Sai also confirmed the Node server runs locally on Windows.

Caveats for review: browsers cannot set User-Agent (MusicBrainz asks for one), Deezer has no CORS so only search links in browser mode, an API key in browser localStorage is a personal-use trade-off, and my tests mock the network, so real CORS behaviour of AniList/MusicBrainz/Wikipedia/Anthropic is unverified.

---

### Sai

Sai can append direct decisions, questions, or instructions here.

---

## Current handoff

The project is still in the architecture/foundation stage.

The immediate goal is to keep the shared understanding synchronized before substantial implementation begins.
