---
name: solve-issue
description: Use when solving GitLab issues locally with glab, issue intake, branch setup, assessment, implementation, validation, and commits.
---

# Solve Issue

Use this skill to solve GitLab issues in `~/git/<repo>`.

For GitLab/glab API work, use the existing `gitlab` skill.  
For code edits, assign the software engineering agent in an observable run. Prefer foreground execution where supported; otherwise keep the task visible and relay progress to the user.

## Workflow

1. `cd ~/git/<repo>`

2. Safety checks:

   ```bash
   git status --short
   git remote -v
   git branch --show-current
   ```

   Stop if:
   - not a git repo
   - uncommitted changes exist
   - target branch/worktree already exists and reuse was not confirmed

3. Fetch issue context with a subagent using the `gitlab` skill. Use concise, structured output—not raw API JSON. Prefer `glab` with `--output json`/`--jq` or dedicated commands, selecting only:
   - title
   - description
   - comments/discussion
   - labels
   - linked issues/MRs
   - referenced links

   Fetch referenced links only when they may affect scope or implementation. Do not dump full API responses into context.

4. Subagent report:
   - summary
   - acceptance criteria
   - references
   - ambiguities
   - suggested next step

5. Derive branch name:
   - default source branch: `dev`
   - if title is `<prefix> | <title>`, drop `<prefix> |`
   - format: `<issue-nr>-<slugified-title>`
   - lowercase
   - hyphenated
   - no punctuation
   - collapse repeated hyphens

6. Prepare separate worktree:

   ```bash
   git fetch --all
   git switch <source-branch>
   git pull
   WORKTREE=~/git/worktrees/<repo>/<issue-nr>-<slugified-title>
   git worktree add -b <issue-nr>-<slugified-title> "$WORKTREE" <source-branch>
   cd "$WORKTREE"
   ```

   Do all edits, validation, and any user-approved commits inside this worktree.

7. Classify issue:
   - implement directly if clear, local, low-risk, and acceptance criteria are obvious
   - assess first if scope, behavior, architecture, or tests are unclear
   - ask user if product/technical decisions are needed

8. Direct implementation:
   - assign software engineering agent
   - provide the worktree path and issue report
   - require progress updates after setup, investigation, implementation, and validation
   - relay those updates to the user
   - implement the smallest correct change
   - run targeted validation
   - leave changes uncommitted for user review

9. Assessment first:
   - spawn an observable assessment subagent
   - give it the concise issue report, not raw API output
   - require progress updates and a detailed final report
   - if it finds a clear solution, assign software engineering agent
   - if it finds unresolved decisions, summarize the report for the user and ask

10. Validation:
    - run targeted checks
    - run `scripts/precommit.sh` if available
    - inspect `git diff`
    - inspect `git status --short`

11. Review before commit:
    - after validation, show the user the concise diff summary, validation results, and proposed commit message
    - leave all changes uncommitted while iterating interactively
    - do not commit, amend, rebase, reset, or otherwise rewrite history unless the user explicitly approves the commit
    - an instruction to implement, validate, inspect, refine, or review is not commit approval

12. Commit after explicit approval:
    - first commit format:

      ```text
      <type>(<scope>): <issue-title> (#<issue-number>)
      ```

    - use conventional commits
    - for long-running/multi-task issues, make multiple reviewable commits
    - prefer single-line commit messages
    - add body text only when useful
    - never add `Co-authored-by`
    - never push unless explicitly instructed

13. Final response:
    - issue
    - branch
    - worktree path
    - commits, or explicitly state that changes are awaiting commit approval
    - changes
    - validation
    - remaining decisions or follow-ups
