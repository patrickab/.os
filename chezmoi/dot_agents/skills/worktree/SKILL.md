---
name: worktree
description: "Create git worktrees with conventional or agent-chosen names. Use for /worktree, optionally with a GitLab issue number."
---

# Worktree

Create an isolated git worktree and branch, then work inside it.

## Invocation

- `/worktree <issue-nr>`: conventional naming from the GitLab issue.
- `/worktree` (bare): agent chooses the name.

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
