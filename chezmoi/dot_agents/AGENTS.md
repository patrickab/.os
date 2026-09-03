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
- If a change made during the session makes one of the four summary docs materially wrong or stale (new module, changed architecture, shifted focus), edit that doc directly with a small targeted diff. This is not `/repomix` — never touch `.docs/repo-context.md` this way. Skip the update if nothing material changed; don't rewrite a doc for a one-line change.
- **The agent shall NEVER commit, push, or amend unless explicitly requested and instructed by the user.**

## Efficient code search

Prefer ripgrep (`rg`) over `grep` for repository search:

- filenames: `rg --files | rg '<pattern>'`
- words, sentences, variables: `rg -n -S '<pattern>' <path>`
- restrict by type: `rg -n '<pattern>' -g '*.py'`
- include hidden files when needed: `rg --hidden -n '<pattern>'`

Use `rg`'s context, glob, and ignore support to keep results focused. Use `grep` only when `rg` is unavailable or for simple non-repository input.

## Process observability with tmux

Run any process that may outlive one tool call or needs live/post-exit
inspection in `tmux` (servers, watchers, builds, training). Never use bare
backgrounding, `nohup`, or `disown`. Foreground commands that finish within
one tool call don't need tmux.

- One session per repo, named after its folder basename; reuse it if it exists
  (`tmux new-session -d -s <repo>`). One clearly named window per process.
- Canonical launch (visible marker + reliable completion signal):
  `tmux new-window -t <repo> -n "agent: <name>" '<cmd>; rc=$?; printf "\n[process exited %s]\n" "$rc"; echo $rc > /tmp/<name>.rc; tmux wait-for -S <name>-done; read'`
- Keep output in the pane; add `tee` only when a log file is also needed.
  Verify the launch immediately and check status later with
  `tmux capture-pane -p -S -100`; never infer status from artifacts/logs alone.
- To wait for completion, block on `tmux wait-for <name>-done`, then read
  `/tmp/<name>.rc`. Never scrape pane text for the marker: echoed commands in
  scrollback and returned prompts cause false or missed matches.
- Report the session/window and `tmux attach -t <repo>` to the user. Keep the
  window until its result is inspected, then close only that window — never
  unrelated windows or a shared session.
