---
name: worktree
description: "Create or remove git worktrees with conventional or agent-chosen names. Use for /worktree, optionally with a GitLab issue number, or /worktree remove <name>."
---

# Worktree

Create an isolated git worktree and branch, then work inside it. Remove it when done.

## Invocation

- `/worktree <issue-nr>`: conventional naming from the GitLab issue.
- `/worktree` (bare): agent chooses the name.
- `/worktree remove <name>`: remove the worktree, see [Remove](#remove).

## Base branch

- Default source branch: `dev`.
- If `dev` does not exist locally or on `origin`, use the repo default branch.

## Setup

```bash
git fetch --all
WORKTREE=$(agent-worktree create <name> --base origin/<source-branch> | tail -1)
cd "$WORKTREE"
```

- `agent-worktree create <name> [--base <ref>] [--path <dir>] [--background]` makes branch and directory (`~/git/worktrees/<repo>/<name>`) and sets the environment up. `agent-worktree list` shows the worktrees. Nothing to install.
- No `origin`: use the local `<source-branch>` as `--base`.

Branch name and directory name are identical: `<name>`.

## Working in a worktree

A created worktree reuses the primary checkout's tooling instead of installing it again.

- **Python**: `.venv` is an overlay that sees every package of the primary venv. Run tools as modules through it (`.venv/bin/python -m pytest`, `.venv/bin/python -m uvicorn`): the overlay has no entry-point scripts. Packages the task needs on top: `uv pip install --python .venv/bin/python <pkg>`, they stay in the overlay. Never `uv sync`, `uv run` or `uv lock` in a worktree
- **JS**: every `node_modules` is a copy-on-write copy of the primary checkout's. Run binaries from `node_modules/.bin/`. Never `npm install` in a worktree
- **Submodules**: the files of every submodule the primary checkout has initialised are copied as they are there, without their `.git`
- **Dependency changes** (manifests, lockfiles) are made in the primary checkout, never in a worktree
- A worktree some other tool made (omp's clone, a harness): run `agent-venv` once for the overlay. A missing `node_modules`: `cp -a --reflink=auto` it from the primary checkout
- Parallel coding agents work in a worktree, never in the user's primary checkout

## Naming

### With issue number

- Fetch the title with the `gitlab` skill (`glab api "projects/:id/issues/<issue-nr>" --jq .title`).
- Name: `<issue-nr>-<slug>`.
- Drop a leading `<prefix> | ` from the title before slugging.

### Bare invocation

- Agent picks a short descriptive name from the user's task.
- Name: `<slug>`, no issue prefix.

### Slug rules

- Lowercase.
- Replace every non-alphanumeric character with `-`.
- Collapse repeated hyphens; trim leading/trailing hyphens.

## Guards

- If the branch or directory already exists, stop and ask whether to reuse it. NEVER reuse silently.

## Report

- Branch name
- Worktree path
- Base branch

## Remove

`/worktree remove <name>`, run from the main checkout `~/git/<repo>`.

```bash
agent-worktree remove <name>
```

- Uncommitted or untracked changes: git refuses. List them, ask "Force remove? Uncommitted changes are lost." Only on yes: `agent-worktree remove <name> --force`.
- Then ask "Delete branch `<name>`?" Default no: keep the branch.
  - Yes: `git branch -d <name>`.
  - Not fully merged: ask again "Branch has unmerged commits, delete anyway?" Only on yes: `git branch -D <name>`.
- Never delete the remote branch.
- Report: removed path, branch kept or deleted.
