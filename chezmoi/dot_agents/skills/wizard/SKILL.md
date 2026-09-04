---
name: wizard
description: Generate a gum/fzf-driven terminal UI for a multi-step workflow — menu-and-case dispatch, confirmation gates, spinners, fuzzy pickers, and (when the workflow calls for it) a persistent tmux job you can check back on. Use for multi-step ops you want a nice terminal script for instead of re-deriving each time. Don't invoke this for a single one-off command.
---

# Wizard

A **runbook** is a small terminal UI for a workflow: a `gum choose` menu dispatching into steps, confirmation gates before anything irreversible, clear pass/fail output. [template.sh](template.sh) is a starting point and pattern reference, not a fixed library — adapt its shape to the actual procedure rather than forcing every runbook into the same layout.

## Primitives to draw from

- `gum input` / `gum write` — collect a value, single or multi-line
- `gum confirm` — yes/no gate, exit-code based; use before anything irreversible
- `gum choose` (`--no-limit` for multi-select) — pick from a short list of named options
- `gum filter` — fuzzy filter over a longer list, no preview
- fzf with `--preview` (`bat`) — fuzzy-find **with a preview pane**; the one thing gum can't do. Reach for it only when a preview earns its place (similar files/configs), not for a short list of names
- `gum spin --title "..." -- cmd` — spinner around a synchronous command
- tmux (`new-session`/`new-window` + `wait-for -S`/`wait-for`) — for anything long-running or that should survive the script exiting; wrap the wait in `gum spin` instead of a silent block

All four (`gum`, `fzf`, ripgrep for a live-grep picker) are worth checking for with `command -v` and falling back to plain bash (`select`, `read`) when absent, so a runbook never hard-depends on any of them. See `primitives-demo.sh` in this directory for a working demo of each — including the live-ripgrep-as-you-type + preview pattern, which isn't in template.sh but is worth copying into a stage that needs jump-to-line search.

**Styling rule:** if a stage calls `gum style` directly, use `--foreground`/`--bold` only. `--border`/`--padding`/`--margin` paint an opaque background on every cell they touch, which ignores terminal transparency (kitty, wezterm, alacritty) and shows as a solid box instead of blending with the user's background.

A runbook is ephemeral by default: built for one run, saved to a scratch or `scripts/` path, deleted when the job's done. Commit it only when the user wants it to live in the repo as a repeatable procedure.

## Process

## 1. Potential Suggestions

If a certain commandline tool, program, primitve could significantly improve either the workflow-skript desired by the user, then propose it. Also propose adding reusable primitives to the tempalte shellscript is useful.

### 1. Scope the procedure

Work out the steps and what each needs to run. Existing scripts, Makefiles, docker-compose files, or docs often already name the real commands. Confirm the shape with the user: they may add, drop, or reorder steps — and say how much structure it actually needs (a full menu, or just a couple of confirms and a spinner).

**Done when:** you know each step's exact command(s), whether it's irreversible (needs `confirm`) or long-running (needs a tmux job), and how the user wants to navigate between steps.

### 2. Author the runbook

Copy `template.sh` to the target path and reshape it — this is a demonstration of patterns, not scaffolding to preserve. Drop the menu entirely for a linear procedure; keep it for something the user will run repeatedly with different choices each time. Use whichever primitives the steps actually call for (see above).

Hold the bar regardless of shape: check for any CLI a step depends on before using it, `gum confirm`/a y/N gate before irreversible actions, `set -euo pipefail` so failures abort loudly instead of limping on. Give any tmux window a meaningful name — what the user calls it, or what the task does (`build`, `train-256x5`) — never a generic placeholder.

### 3. Verify and hand off

- `bash -n <script>`; run `shellcheck` if available.
- `chmod +x <script>`.
- Trace it statically if it touches real infra or shared state; running it end-to-end is fine when it's safe and idempotent.
- Tell the user how to run it. If it's a repeatable procedure, commit it and link it from the README.
