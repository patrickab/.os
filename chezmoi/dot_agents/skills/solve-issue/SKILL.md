---
name: solve-issue
description: Use when solving GitLab issues locally with glab, issue intake, branch setup, assessment, implementation, validation, and commits.
---

# Solve Issue

Use this skill to solve GitLab issues in `~/git/<repo>`.

For GitLab/glab API work, use the existing `gitlab` skill.  
For code edits, assign the software engineering agent.

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
   - target branch already exists and reuse was not confirmed

3. Fetch issue context with a subagent using the `gitlab` skill:
   - title
   - description
   - comments/discussion
   - labels
   - linked issues/MRs
   - referenced links

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

6. Prepare branch:

   ```bash
   git fetch --all
   git switch <source-branch>
   git pull
   git checkout -b <issue-nr>-<slugified-title>
   ```

7. Classify issue:
   - implement directly if clear, local, low-risk, and acceptance criteria are obvious
   - assess first if scope, behavior, architecture, or tests are unclear
   - ask user if product/technical decisions are needed

8. Direct implementation:
   - assign software engineering agent
   - implement smallest correct change
   - run targeted validation

9. Assessment first:
   - spawn assessment subagent
   - if it finds a clear solution, assign software engineering agent
   - if it finds unresolved decisions, summarize for user and ask

10. Validation:
    - run targeted checks
    - run `scripts/precommit.sh` if available
    - inspect `git diff`
    - inspect `git status --short`

11. Commit:
    - commit automatically
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

12. Final response:
    - issue
    - branch
    - commits
    - changes
    - validation
    - remaining decisions or follow-ups
