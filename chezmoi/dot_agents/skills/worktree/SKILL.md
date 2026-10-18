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
REPO=$(basename "$(git rev-parse --show-toplevel)")
git fetch --all
git switch <source-branch>
git pull
WORKTREE=~/git/worktrees/$REPO/<name>
git worktree add -b <name> "$WORKTREE" <source-branch>
cd "$WORKTREE"
```

Branch name and directory name are identical: `<name>`.

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
- If the working tree has uncommitted changes, do not switch branches in the main checkout; report and ask.

## Report

- Branch name
- Worktree path
- Base branch

## Remove

`/worktree remove <name>`, run from the main checkout `~/git/<repo>`.

```bash
git worktree remove ~/git/worktrees/$REPO/<name>
```

- Uncommitted or untracked changes: git refuses. List them, ask "Force remove? Uncommitted changes are lost." Only on yes: `git worktree remove --force …`.
- Then ask "Delete branch `<name>`?" Default no: keep the branch.
  - Yes: `git branch -d <name>`.
  - Not fully merged: ask again "Branch has unmerged commits, delete anyway?" Only on yes: `git branch -D <name>`.
- Never delete the remote branch.
- Report: removed path, branch kept or deleted.
