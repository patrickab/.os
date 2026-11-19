---
name: parallelize-plan
description: Supervise the implementation of an approved plan with parallel subagents. One contract file as source of truth, strict file ownership, report files per agent, bounded agent sessions. Use when the user asks to implement a plan, issues or slices with subagents in parallel.
---

The supervisor plans, briefs, integrates and reports. Subagents implement, review and verify. Spawn, steer, message, check and stop them with the harness's own delegation tools, whose documentation is authoritative.

`<scratch>` holds the contract, reports and reviews: the repo's planning area, or a session scratch (omp `local://`) mirrored there after every change, since it dies with the session.

## Supervisor loop

1. **Slice**: one task per plan item. One concern, about 10 files, about 70 agent requests, verifiable on its own. Bigger: split before spawning.
2. **Batch**: group slices with disjoint file ownership. A file several slices need: sequence them, or run a small backbone slice first (stubs, registries, empty files, shared types) that the others fill.
3. **Contract** `<scratch>/<plan>-contracts.md`, the single source of truth, edited by the supervisor only:
   - interfaces (types, routes, messages, env vars, ports, storage keys) with exact names
   - file-ownership table per batch
   - rules every agent follows
   - status: done, running, accepted change requests, open user decisions
4. **Brief** per agent, 4k chars at most:
   - goal, owned files, acceptance criteria
   - the contract sections it needs (quoted, or named by heading), exact file:line pointers into code it must read. Never "read the contract end to end", never earlier slice reports unless one is named for a reason
   - output hygiene: read code by range, pipe logs through `tail`, query specific UI elements instead of dumping pages
5. **Spawn** the batch at once. Coders run build, lint and tests once at the end.
6. **Collect**: each agent overwrites `<scratch>/report-<slice>.md`, also for corrections: `## Implemented`, `## Files`, `## Verification` (commands and observed results), `## Contract change requests`, `## Open risks`. The supervisor re-reads it, accepts or rejects change requests, updates the contract. An accepted change that affects a running agent goes to that agent as a steer with the delta, since its brief quotes the old contract.
7. **Review** only complex or risky slices: overrides of external code, security boundaries, concurrency, data integrity. Read-only reviewers write `<scratch>/review-<slice>.md`: blocker, major, minor, each with file:line and a concrete fix. Fixes go to a fresh agent.
8. Repeat until every acceptance criterion holds. Then one fresh integrated-smoke agent. Then propose commits to the user.

## Safeguards

- **Session size**: slice and brief size are the control, the harness's request or time budget only a backstop. An agent near 70 requests or about 200k context finishes its current step and reports, a fresh agent briefed from that report does the rest. Large live verification runs in its own fresh agent, never at the tail of a long implementation run.
- **No duplicates**: never spawn a replacement before the original's run is idle.
- **Ownership over messaging**: peer messages carry information, never ownership. An agent that needs a file outside its row writes the need into its report and does not edit it. Blocking decisions go to the supervisor, not to siblings.
- **Shared running services**: agents never stop, restart or rebuild the user's running instance. They use spare ports and scratch homes and stop what they start.
- **No git state changes** by agents. The supervisor commits only when the user asks.
- **Cleanup**: agents name every worktree, unit or process they register. The supervisor removes them.

## Talking to the user

- After each batch: what landed, verification, decisions needed (`Q1`), risks (`R1`).
- Ask only for materially different tradeoffs. Otherwise pick the conservative default, record it in the contract, and say so.
- A user decision that changes scope: update the contract first, then spawn.
