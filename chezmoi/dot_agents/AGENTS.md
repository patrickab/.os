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

## Process observability with tmux

Any process that may outlive one tool call or need live or post-exit inspection
must run in `tmux`. This includes webapps, dev servers, watchers, training,
sweeps, benchmarks, monitors, and long-running scripts. Never launch these with
bare backgrounding, `nohup ... &`, or `disown`. Foreground commands that finish
within one tool call and return their complete output do not need `tmux`.

- Name the session after the repository folder basename. Reuse it when it
  exists; otherwise create it with `tmux new-session -d -s <reponame>`.
- Use a separate, clearly named window for each process. Launch with a visible
  completion marker and retain the pane for inspection:
  `tmux new-window -t <reponame> -n "agent: <name>" '<command>; rc=$?; printf "\n[process exited %s]\n" "$rc"; read'`.
- Keep output visible in the pane. Do not redirect it away; use `tee` when a
  persistent log is also needed.
- Immediately verify every launch with `tmux list-panes` and
  `tmux capture-pane -p -S -100`, checking for startup errors and visible
  progress.
- Observe later status through `tmux capture-pane`, the pane's current command,
  and the `[process exited N]` marker. Do not infer process status only from
  artifacts or log files.
- Report the session, window, `tmux attach-session -t <reponame>`, and
  `tmux select-window -t '<reponame>:<window>'` so the user can inspect it.
- Keep the window until its result has been inspected. Then close only that
  window; never kill unrelated windows or a shared session.
