---
name: parallelize-plan
description: Supervise the implementation of an approved plan with parallel subagents. Tracks, milestones, waves and tasks, one contract as source of truth, a shared map in memory-store, strict file ownership, one reviewer per milestone as quality gate. Use when the user asks to implement a plan, issues or tasks with subagents in parallel.
---

Roles: the supervisor plans, briefs and decides. Scouts read, coders implement, the reviewer is the quality gate.
The supervisor never reads code in bulk. Agents are spawned and steered with the harness's own delegation tools.

## Terms

| Term | What it is | Runs | Ends with |
|---|---|---|---|
| **Track** | An independent part of the plan with its own worktree. Tracks share no files and meet only at the contract | in parallel | its last milestone |
| **Milestone** | A reviewed state of one track | in order within a track | the reviewer's approval and the merge into the central worktree |
| **Wave** | The coders working at the same time | in order within a milestone | the full suite passing |
| **Task** | One commit: a ticket with a title and a description | in order within one coder | its acceptance commands pass, committed |

```
central worktree ◀── every approved milestone merges here; tracks branch from it
│
├─ TRACK a                      worktree a
│   ├─ MILESTONE 1
│   │   ├─ WAVE 1   coder: task → task → task     coder: task → task
│   │   │           └ full suite once
│   │   ├─ WAVE 2   ...
│   │   └ reviewer → merge into central
│   └─ MILESTONE 2
└─ TRACK b                      worktree b
    └─ MILESTONE 1
        └─ WAVE 1   coder: task → task
```

A small plan is one track, one milestone, one wave. Unused levels cost nothing: add none for their own sake.

**Task = ticket = commit**
- **Title**: a conventional commit subject (`feat(memory): add describe op`)
- **Description**: sections of layered bullet points: what changes and why, never how the work went
- Title and description are the commit message, word for word. Cut tasks so that this is true
- What a coder needs beyond that (what to read, owned files, acceptance commands) belongs in the brief around the tasks, not in them

## 1. Plan

1. **Tracks**: split the plan into parts that share no files
2. **Contract**: write down what tracks and coders share, exact: signatures, routes with request and response shapes, types, env vars
   - a need for an *interface* goes into the contract and creates no order
   - a need for *finished code* creates an order: the next wave, or the next task of the same coder
3. **Milestones** per track: each a state that can be reviewed and merged on its own
4. **Tasks** per milestone: each one commit, verifiable on its own. Chain neighbours (a neighbour builds on the task before it)
5. **Waves**: give each chain to one coder. Chains with disjoint files form a wave
   - a chain is too long when one agent cannot finish it within its context: split it over two waves
   - repeated work of one shape (many endpoints, many scenes): one coder goes first as pilot, its lessons go into the briefs, then the rest fan out

## 2. Setup (once)

- **memory_store**: `memory-store create <project>/<plan> map handoffs briefs run`
  - `<project>` = last segment of the repo path. Agents use the `memory-store` CLI, or the MCP tools when they have them
  - `run/contract.md` supervisor only · `map/<concern>` facts · `briefs/<wave>-<coder>.md` · `handoffs/<wave>-<coder>.md` · `run/feedback` facts · `run/retro.md` · `run/overview.md`
- **Worktrees** through the `worktree` skill, never the user's primary checkout. Verify each is complete (venv, `node_modules`)
  - one **central** worktree: every approved milestone merges here, the user looks only here. It starts from the primary checkout's current state, uncommitted work included, taken as a snapshot (`git stash create`) that leaves the checkout untouched
  - one per track, branched from central. A track starts its next milestone from the current central
- **Dependencies**: the supervisor adds them in the track's worktree as a commit of its own, and smoke-imports them before writing the contract
- **Contract core** (top of `run/contract.md`, every agent reads it):
  - worktrees and how to run tests and checks there
  - services and data nobody touches
  - the agent rules (section 5), written once here, never repeated in briefs

## 3. Wave loop

1. **Scout** every concern the wave needs that `memory-store ls <store> map` does not show as explored
   - a scout writes `map/<concern>`: facts with `file:line`, no prose
   - a scout checks the plan's file lists against the code and marks each gap `MISSING FROM PLAN`
   - status (explored, partly, stale) goes into the memory's description
2. **Contract section** for the wave:
   - the interfaces its coders share
   - the ownership table: each file in exactly one row, including importers of what gets removed
   - decisions taken
3. **Brief** per coder, a file in `briefs/`:
   - what to read, by name: contract sections, map memories
   - owned files
   - its tasks in order, each with title, description and acceptance commands
   - "files of an interrupted predecessor may exist: verify them, then continue"
   - the spawn task is one line: "execute brief `<path>`"
4. **Spawn** the whole wave at once. Wait for completion notices, never poll
5. **Collect**: read the handoffs' change requests and risks. Decide each, write accepted ones into the contract
6. **Test**: the full suite runs once per wave, after all coders finished. Coders run their own tests while they work
   - a failure becomes a fix task for a fresh coder, briefed with the owning coder's handoff
7. The wave shrinks to one line in the contract

After the last wave of a milestone:

1. **Review** (section 4). Rejected: the findings become the tasks of one more wave, then review again
2. **Merge** the track into the central worktree on approval. A conflict is resolved in the track, tested there, then merged

After the last milestone: the full suite and one integrated smoke run in the central worktree, then the retro, then the final overview.

## 4. Reviewer (one per milestone, independent, a strong model, with a shell)

The reviewer is the quality gate: nothing merges without its approval.

- **Receives** only code that passed the full suite
- **Reads**: the milestone's diff (the track's commits since it branched from central) · the map · `.docs/architecture.md` and `.docs/module-map.md` where they exist · the track's and milestone's part of the plan and contract
- **May spawn scouts** for what it needs to know about the surrounding code
- **Judges**:
  - follows the repo's code and project standards (`AGENTS.md`)
  - reuses what exists instead of rebuilding it
  - no complexity the task does not need
  - readable by a human, documented where a reader needs it
  - modular, reusable where reuse is real
  - correct at the edges the tests do not cover
  - test gaps: behaviour the milestone adds or changes that no test would catch if it broke
- **Writes** `handoffs/<track>-<milestone>-review.md`: `approved`, or `rejected` with findings as blocker, major, minor, each with `file:line`, an executed failing scenario where one exists, and the smallest fix

## 5. Agent rules (go into the contract core)

- **Done** means your acceptance commands pass. Run only the tests and checks of your own files
- **Files**: write only what you own
  - a file outside your list that breaks only through your change: smallest fix, name it in the handoff
  - a failure from a file you do not own: report, do not fix
- **Interfaces** a sibling has not delivered: build against the contract, say so in the handoff
- **Ask** the supervisor only when a decision changes the contract or risks data. Otherwise take the conservative choice and name it
- **Commit** each finished task, and nothing else in git: `git add -- <its files>`, then `git commit -m "<title>" -m "<description>" -- <its files>`. Retry when the index is locked
- **Never**: any other git state change · manifests or lockfiles (name the dependency in the handoff) · the user's running services
- **Map**: `update` a fact you found wrong, `add` what the next agent would have to rediscover
- **Handoff**, state only, no narrative: tasks committed (hash, title) · each acceptance command with its last output line · contract change requests with exact shapes · open risks
- **Feedback**: a problem with the brief, the protocol, the tools or the environment is one `add` to `run/feedback`: `kind · what happened · cost · suggestion`

## 6. Supervisor rules

- **Contract changes**: decide, write the contract, then per affected agent: running → steer it with the delta; finished → a small edit you apply yourself, a larger one becomes a task of the next wave
- **Context**: an agent that runs low hands off at a task boundary, a fresh agent continues from that handoff
- **No duplicates**: never spawn a replacement before the original is idle
- **Two agents never write the same file**
- **Cleanup**: remove the track worktrees and every unit and process the run registered. The central worktree stays
- **Git**: only the supervisor merges, and only an approved milestone, into central. Nothing is pushed and the primary checkout is never touched
- **User**: no reports and no review requests unless the user asked for them (e.g. a report per milestone). Ask only for materially different tradeoffs, otherwise take the conservative choice and record it in the contract. The one message the user reads is the final overview (section 8)

## 7. Retro (last)

- Read `run/feedback`. Write `run/retro.md`, one page:
  - the costliest problems with evidence and cost
  - one proposed edit each (this skill, `AGENTS.md`, the repo, the environment) or "no action"
  - what worked
- The user reads it when they want and asks for the edits they approve

## 8. Final overview (the last message, also saved as `run/overview.md`)

What the user needs to understand how the new system works, at a high level. It is the text they read now and look up later.

- **Content**: what exists now and how its parts work together · how to use it · what behaves differently than before · decisions taken on the user's behalf · what is left open · where the central worktree is
- **Not in it**: how the run went, per-task detail, anything the user can get by asking
- **Form**: sections of bullet points. A section may open with two or three sentences. As long as the information needs, no longer

