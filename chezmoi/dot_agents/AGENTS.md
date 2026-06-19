# Global project instructions for opencode

These apply to every repo. A repo may ship its own `AGENTS.md` to add or
override.

## Repomix-driven context pipeline

Every repo is expected to ship a `.docs/` directory with four small,
cheap-to-inject summary files that act as the agent's repository memory:

- `.docs/architecture.md`   — overall system architecture, components, data flow
- `.docs/module-map.md`     — directory/module layout and responsibilities
- `.docs/conventions.md`    — language/framework choices, naming, testing, lint, commit style
- `.docs/current-focus.md`  — what's actively being worked on, recent changes, open questions

### At the start of every task

1. Read `.docs/architecture.md`
2. Read `.docs/module-map.md`
3. Read `.docs/conventions.md`
4. Read `.docs/current-focus.md`

**Do not perform repository exploration unless the required information is
missing from these files.**

**The agent must NEVER run the `/repomix` command autonomously.** It is strictly user-driven. If any `.docs/` file is missing, stale, or incomplete, the agent must point the user to run `/repomix` and wait. The agent must not run the `/repomix` command itself, nor perform repository exploration as a substitute.

### Conventions

- `.docs/repo-context.md` is the raw, compressed Repomix output. It is
  intentionally large and is NOT auto-loaded. Treat it as a generated
  artifact, not source.
- The four summary docs in `.docs/` are the source of truth for "what does
  this repo look like right now". Keep them small and current.
- Do not edit `.docs/repo-context.md` by hand. It is regenerated.
- Do not duplicate information across the four summary docs.
- **The agent shall NEVER commit, push, or amend unless explicitly requested and instructed by the user.**
