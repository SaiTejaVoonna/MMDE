# AGENTS.md — MMDE

Guidance for AI coding assistants (Claude, ChatGPT/GPT, Codex, and others) working on MMDE.

## Read first

1. `README.md`
2. `docs/PROJECT_CONTEXT.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DECISIONS.md`
5. `docs/ROADMAP.md`
6. `docs/DATA_MODEL.md`
7. `docs/AI_COLLABORATION.md`
8. `docs/collaboration/CHAT.md`

## Roles

- **Sai** is the Product Owner / Product Architect and has final authority.
- **GPT and Claude** are collaborators/builders: research, propose, build, review, and challenge assumptions.
- Nothing is an architectural decision just because an AI suggested it. Record a decision in `docs/DECISIONS.md` only after Sai approves it.

## Core rules

- MMDE is media-first: media title → music discovery → external platform links.
- MMDE never hosts, downloads, or streams music.
- Providers are modular and replaceable; candidate sources are not final decisions.
- Prefer stable identifiers (ISRC, database IDs) over title-only matching.
- Keep the repository docs as the shared context; do not rely on chat transcripts.
- Inspect existing code and docs before proposing replacements.
- After substantial work, leave a concise handoff in `docs/AI_COLLABORATION.md` or `docs/collaboration/CHAT.md`.
