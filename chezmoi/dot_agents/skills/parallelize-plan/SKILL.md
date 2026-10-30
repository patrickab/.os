---
name: parallelize-plan
description: Supervise the implementation of an approved plan with parallel subagents. One contract file as source of truth, strict file ownership, report files per agent, bounded agent sessions. Use when the user asks to implement a plan, issues or slices with subagents in parallel.
---

The supervisor plans, briefs, integrates and reports. Subagents implement, review and verify. The contract is the single source of truth for interfaces, ownership and status.

## Supervisor loop

1. **Slice**: one task per plan item. A slice is about 70 agent requests at most: one concern, about 10 files, verifiable on its own. Bigger: split before spawning.
2. **Batch**: group slices with disjoint file ownership. A file several slices need: sequence them, or run a small backbone slice first (stubs, registries, empty files, shared types) that the others fill.
3. **Contract** `local://<plan>-contracts.md`, owned and edited by the supervisor only:
   - interfaces (types, routes, messages, env vars, ports, storage keys) with exact names
   - file-ownership table per batch
   - rules every agent follows
   - status: done, running, accepted change requests, open user decisions
   - Mirror it to a persistent path in the repo's planning area after every change. `local://` dies with the session.
4. **Brief** per agent, 4k chars at most:
   - goal, owned files, acceptance criteria
   - the contract sections it needs (quoted, or named by heading), exact file:line pointers into code it must read
   - never "read the contract end to end", never earlier slice reports unless one is named for a reason
5. **Spawn** the batch in one `task` call. Coders run build, lint and tests once at the end.
6. **Collect**: each agent overwrites `local://report-<slice>.md` with `## Implemented`, `## Files`, `## Verification` (commands and observed results), `## Contract change requests`, `## Open risks`. For corrections it overwrites the same file. The supervisor re-reads it, accepts or rejects change requests, updates the contract, mirrors the report.
7. **Review** only complex or risky slices: overrides of external code, security boundaries, concurrency, data integrity. Reviewers are read-only and write `local://review-<slice>.md`, ranked blocker, major, minor with file:line and a concrete fix. Fixes go to a fresh agent.
8. Repeat until every acceptance criterion holds. Then one fresh integrated-smoke agent. Then propose commits to the user.

## Safeguards

- **Session size**: an agent near 70 requests or about 200k context finishes its current step and reports. The rest goes to a fresh agent briefed from that report. Large live verification runs in its own fresh agent, never at the tail of a long implementation run.
- **No duplicates**: never spawn a replacement while the original still runs. Subagents may not be cancellable. Check the transcript is idle first.
- **No peer messaging assumed**: coordinate through ownership only. An agent that needs a file outside its row writes the need into its report and does not edit it.
- **Shared running services**: agents never stop, restart or rebuild the user's running instance. They use spare ports and scratch homes and stop what they start.
- **Output hygiene** in every brief: read code by range, pipe logs through `tail`, query specific UI elements instead of dumping pages.
- **No git state changes** by agents. The supervisor commits only when the user asks.
- **Cleanup**: agents name every worktree, unit or process they register. The supervisor removes them.
- **Tool budget**: subagent compaction (`task.agentCompactionThresholdOverrides`) and the soft request budget are a backstop, not the plan. Slice size and brief size are the primary control.

## Talking to the user

- After each batch: what landed, verification, decisions needed (`Q1`), risks (`R1`).
- Ask only for materially different tradeoffs. Pick the conservative default otherwise, record it in the contract, and say so.
- A user decision that changes scope: update the contract first, then spawn.
