---
name: to-issues
description: Turn the current conversation context into multiple separately implementable GitHub issues for parallel agent work. First produces a PRD via to-prd, then decomposes it into agent-sized issues.
---

This skill decomposes a feature into multiple independently implementable GitHub issues that can be worked on by parallel agents. It first generates a PRD (using the to-prd skill in composition mode), then splits that PRD into discrete issues.

Do NOT interview the user — synthesize what you already know from the conversation and codebase.

## Process

### Phase 1 — PRD Generation (Composition Mode)

1. Invoke the **to-prd** skill in composition mode: perform the same exploration, seam-sketching, and PRD writing, but **do not publish a GitHub issue**. Instead, write the finalized PRD to `.docs/prd.md` in the project root.
2. Confirm with the user that the PRD captures the feature correctly before proceeding.

### Phase 2 — Decomposition

3. Read `.docs/prd.md` and decompose it into **separately implementable issues**. Each issue must satisfy:
   - **Atomic**: One coherent unit of work that can be completed end-to-end by a single agent session.
   - **Parallel-safe**: No implicit dependency on another issue's implementation being merged first, unless explicitly stated in a "Depends on" header.
   - **Testable**: Includes clear acceptance criteria that can be verified independently.
   - **Scopo-contained**: Touches a bounded set of modules — no issue should require touching the entire codebase.

4. Group user stories from the PRD into issue-sized clusters. Each cluster becomes one issue. Prefer fewer, well-scoped issues over many micro-issues. Aim for 3–7 issues per PRD.

5. Determine dependency ordering. If issue B requires code from issue A to function, mark B with `Depends on: #A`. Issues with no dependencies can be worked on in parallel by separate agents.

### Phase 3 — Publication

6. For each decomposed issue, create a GitHub issue using `gh issue create` with the following structure:

```markdown
## Summary

One-paragraph description of what this issue implements.

## Context

Reference to the PRD: links back to `.docs/prd.md` and the original conversation context.

## Acceptance Criteria

- [ ] Specific, testable outcome 1
- [ ] Specific, testable outcome 2
- [ ] ...

## Implementation Notes

- Modules to modify (not file paths — module names)
- Key constraints from the PRD
- Testing approach

## Depends on

- (leave empty if this issue has no blockers, otherwise reference issue numbers)
```

7. Apply labels to each issue:
   - `ready-for-agent` — signals the issue is scoped and can be picked up by an agent
   - Any component-specific labels relevant to the modules being touched
   - Do NOT apply additional triage labels

8. After all issues are created, print a summary showing:
   - Issue numbers and titles
   - Dependency graph (which issues depend on which)
   - Which issues can be started in parallel immediately

### Parallel Execution Guidance

Issues with no `Depends on` field can be picked up by separate agents simultaneously. The user can launch multiple opencode sessions, each pointed at one issue number, to implement in parallel. Issues with dependencies should only be started after their prerequisite is merged.

## Issue Template

```
## Summary
<one-paragraph summary>

## Context
PRD: .docs/prd.md — <feature name>

## Acceptance Criteria
- [ ] <criterion 1>
- [ ] <criterion 2>

## Implementation Notes
- <module-level guidance, constraints, testing approach>

## Depends on
<issue number or empty>
```