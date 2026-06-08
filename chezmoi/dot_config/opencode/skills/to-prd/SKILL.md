---
name: to-prd
description: Turn the current conversation context into a PRD. When called directly, publishes it as a GitHub issue. When called by to-issues, writes the PRD to .docs/ without publishing.
---

This skill takes the current conversation context and codebase understanding and produces a PRD. Do NOT interview the user — just synthesize what you already know.

## Modes

This skill operates in two modes depending on how it is invoked:

### Direct mode (called by the user)

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the PRD, and respect any ADRs in the area you're touching.
2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can.
3. Check with the user that these seams match their expectations.
4. Write the PRD using the template below, then publish it to the project issue tracker as a single GitHub issue. Apply the `ready-for-agent` triage label — no need for additional triage.

### Composition mode (called by to-issues)

When invoked by the to-issues skill, follow steps 1–3 above but instead of publishing an issue, write the finalized PRD to `.docs/prd.md` in the project root. This file is consumed by to-issues for decomposition. Do NOT publish a GitHub issue in this mode.

## PRD Template

```markdown
## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.
```