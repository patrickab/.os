---
name: parallelize-plan
description: Supervise the implementation of an approved plan through the agent factory. Tracks, milestones, waves and tasks, one contract as source of truth, a shared map in memory-store, every wave declared once and then built, reviewed and merged by the factory into one central branch. Use when the user asks to implement a plan, issues or tasks with agents in parallel.
---

Roles: the supervisor plans, declares and decides. Scouts read, coders implement, the reviewer is the quality gate.
The supervisor never reads code in bulk, and never waits inside a turn.

- **Coders and the reviewer run in the factory** (`agent-factory`): a coder per task in its own worktree, gates after every turn, tests in the merge queue, one commit per task, one review per wave. Reach the factory with the `factory` tool, the MCP tool, or the CLI `factory <action> '<json>'` (`factory --help`)
- **Scouts are ordinary subagents**: they write no code, so there is nothing to gate or merge. Nothing else runs as a subagent
- **Memory** is `memory-store` (CLI `memory-store`, or its MCP tools): the plan, the contract, the map

## Terms

| Term | What it is | In the factory |
|---|---|---|
| **Track** | An independent part of the plan | first segment of the wave's tag |
| **Milestone** | A goal inside a track, a group of waves | middle segment of the tag |
| **Wave** | The tasks that are built and reviewed together | a wave: declared once with its tasks, a branch off central, one review, one merge |
| **Task** | One commit: a ticket with a title and a description | one factory task that merges into the wave's branch |

```
central branch ◀── every approved wave merges here
│
├─ TRACK a
│   ├─ MILESTONE 1
│   │   ├─ WAVE 1   task ─▶ task       task        (tag a/1/1)
│   │   │           all done ─▶ reviewer ─▶ central
│   │   └─ WAVE 2   ...
│   └─ MILESTONE 2
└─ TRACK b
    └─ WAVE 1       task ─▶ task                   (tag b/1)
```

- **Wave and task carry the mechanics.** Track and milestone are names: they make the plan readable and the board navigable, the factory enforces nothing on them
- **Order comes only from dependencies.** Any two waves run at once when they share no files and neither needs the other's finished code, whatever track or milestone they are in
- A small plan is one wave. Add no level for its own sake: the tag is as deep as the plan (`<wave>`, `<track>/<wave>`, `<track>/<milestone>/<wave>`)

**Task = ticket = commit**
- **Title**: a conventional commit subject (`feat(memory): add describe op`). The factory uses it as the commit message's first line
- **Description**: sections of layered bullet points: what changes and why, never how the work went
- Cut tasks so that title and description are true as the commit message
- What a coder needs beyond that (what to read, acceptance) surrounds them in the task's request

## 1. Plan

1. **Tracks**: split the plan into parts that share no files
2. **Contract**: write down what tracks and coders share, exact: signatures, routes with request and response shapes, types, env vars. And the **invariants**: what must hold whatever the implementation does
   - a need for an *interface* goes into the contract and creates no order
   - a need for *finished code* creates an order: `after` inside a wave, or the next wave
3. **Milestones** per track, where they help reading the plan
4. **Tasks**: each one commit, verifiable on its own
5. **Waves**: tasks with disjoint files, and chains of tasks that build on each other, form a wave
   - repeated work of one shape (many endpoints, many scenes): one task goes first as pilot (`after` on the others), its lessons go into the others' requests before they start
6. **Anything the user will look at** (a screen, a layout, an output format): show a sketch and get a yes before tasks are cut

## 2. Setup (once)

- **memory_store**: `memory-store create <project>/<plan> map plan run`
  - `<project>` = last segment of the repo path
  - `run/contract.md` supervisor only · `map/<concern>` facts · `plan/<tag prefix>.md` the description of a track, milestone or wave, which the board shows (its first line is the title) · `run/feedback` facts · `run/retro.md` · `run/overview.md`
  - a document: `memory-store apply <store> --ops '[{"op":"write_doc","path":"plan/a/1.md","text":"..."}]'`. A first fact: `{"op":"add","path":"map/x","description":"...","text":"..."}`
- **Central branch and worktree** through the `worktree` skill, never the user's primary checkout: every approved wave merges here, the user looks only here
  - it starts from the primary checkout's current state. Uncommitted work that belongs to the plan comes along as a snapshot (`git stash create`), unrelated uncommitted work stays out; say which in the contract
  - it must hold the repo's committed `factory.yaml` (`factory config.get`), and factory models must be set (`factory models.get`)
  - **prove the gates before the first wave**: run the repo's merge gates once in the central worktree. A gate that fails or disturbs other work there fails in every task
- **Dependencies**: the supervisor adds them on the central branch as a commit of its own, and smoke-imports them, before the waves that need them branch
- **Contract core** (top of `run/contract.md`, every agent reads it):
  - services and data nobody touches
  - the agent rules (section 5), written once here, never repeated in requests

## 3. Wave loop

1. **Scout** every concern the wave needs that `memory-store ls <store>` does not show as explored
   - a scout writes `map/<concern>`: facts with `file:line`, no prose
   - a scout checks the plan's file lists against the code and marks each gap `MISSING FROM PLAN`
   - status (explored, partly, stale) goes into the memory's description
2. **Contract section** for the wave: the interfaces its tasks share, which task owns which files, decisions taken
3. **Describe** the wave: `plan/<tag>.md` (title line, what it delivers, its tasks). Tracks and milestones get theirs once
4. **Declare** the wave, once, with all its tasks:
   ```
   factory waves.start '{"repo": "<repo>", "tag": "<track>/<milestone>/<wave>", "plan": "<project>/<plan>",
     "title": "<what the wave delivers>", "request": "<reviewer instructions, section 4>",
     "overrides": {"branch": "<central branch>"},
     "tasks": [{"key": "a", "title": "<task title>", "request": "<see below>"},
               {"key": "b", "title": "...", "request": "...", "after": ["a"]}]}'
   ```
   - **a task's request**: read `run/contract.md` and the named map memories · the task's description · its acceptance commands · "files of an interrupted predecessor may exist: verify them, then continue"
   - the factory creates the wave's branch, starts each task when the tasks it waits for are done, reviews the whole wave when all are done or cancelled, and merges it into central. The wave's commits stay as they are
5. **End the turn** with one line of state. The factory reports into this session whatever needs the supervisor, and each report starts a turn:

   | Report | Do |
   |---|---|
   | a coder asks (`waiting_answer`) | decide, answer with `tasks.message` |
   | a task is `blocked` or interrupted | read why (`tasks.get`), then `tasks.message` with what to change, `tasks.retry`, or `tasks.cancel` and `waves.add` a differently cut task |
   | the wave is `rejected` | the findings are in the report. Decide each, cut them into fix tasks, `waves.add`. The factory reviews again by itself |
   | the wave is `blocked` | `conflict`: section 6 · `gates`, `dirty`: `waves.add` a task that fixes it · then `waves.retry` where the wave does not move by itself |
   | tasks can never start | their predecessor was cancelled: `waves.add` a replacement, or `waves.cancel` |
   | the wave is `merged` | step 6, then the next wave |

   - a factory without reports (`factory actions` shows no notifications, or the wave was declared outside a Pi session): dispatch `factory tasks.wait '{"wave": "<id>"}'` as a background command that wakes the session, then end the turn. Never run a wait in the foreground
   - a second rejection on the same topic: decide the rule yourself, write it into the contract as an invariant, and give the fix task that rule, not the reviewer's smallest fix
   - a wave's task can only be continued while the wave is building. Later work goes in through `waves.add`
6. **Collect** after the merge: read the change requests and risks at the end of each task's last message (`tasks.get`). Decide each, write accepted ones into the contract. The wave shrinks to one line in the contract

After the last wave: one integrated smoke run in the central worktree, then the retro, then the final overview.

## 4. Reviewer (the wave's `request`)

The reviewer is the quality gate: no wave reaches central without its approval. It only sees code that passed the gates, it judges the wave's whole diff, and it has no time limit. It may have no shell: what it must know stands in the request or in files of the repository.

- **What to read**, by name: the plan and docs in the repository · `.docs/architecture.md` and `.docs/module-map.md` where they exist
- **What the wave was meant to deliver**
- **The contract's invariants** the wave must hold, written out
- **What is accepted** and must not be reported again
- **What to judge**:
  - follows the repo's code and project standards (`AGENTS.md`)
  - reuses what exists instead of rebuilding it
  - no complexity the task does not need
  - readable by a human, documented where a reader needs it
  - modular, reusable where reuse is real
  - correct at the edges the tests do not cover
  - test gaps: behaviour the wave adds or changes that no test would catch if it broke
- Reject only for a blocker or major finding, each with `file:line`, an executed failing scenario where one exists, and the smallest fix

The reviewer only judges. It starts no tasks and talks to no coder: its findings reach the supervisor, who decides who fixes what.

## 5. Agent rules (go into the contract core)

- **Done** means your acceptance commands pass. The factory runs the gates after your turn and the tests at merge, and commits for you
- **Scope**: change what the task needs. A file another task owns: build against the contract instead, and say so. A fix that seems needed outside your files (a broken test elsewhere, the environment): ask first, another task may be making the same fix
- **Ask** the supervisor (`factory_ask_supervisor`) when a decision changes the contract, risks data, or reaches outside your files. Otherwise take the conservative choice and name it
- **Never**: manifests or lockfiles (name the dependency) · the user's running services · existing tests bent to pass (adapt one only where the contract changes the behaviour it asserts)
- **Tests** never reach the network, a real model, real state or other processes on the machine: temp dirs, fakes, ids that match nothing real
- **Map**: `update` a fact you found wrong, `add` what the next agent would have to rediscover
- **Last message**, state only: contract change requests with exact shapes · open risks · what you left undone
- **Feedback**: a problem with the request, the protocol, the tools or the environment is one `add` to `run/feedback`: `kind · what happened · cost · suggestion`

## 6. Supervisor rules

- **Never wait inside a turn**, and never run a long command silently: say in one line what starts, run it in the background, end the turn
- **Evidence before cause**: when a task dies or a wave stalls, read its state, log and timestamps before naming a cause to the user
- **Contract changes**: decide, write the contract, then per affected task: running → `tasks.message` with the delta; done → `waves.add` a new task
- **A fix outside every task's files** (a shared test helper, the environment, a gate): the supervisor makes it once on the central branch as a commit of its own, before the waves that need it branch; running tasks get it at merge
- **A wave's rebase conflict**: mechanical (both sides made the same change, or disjoint edits collide) → the supervisor rebases the wave's branch itself, runs the merge gates on the result, then `waves.retry`. Anything that needs judgement about the code → `waves.add` a task that resolves it
- **No duplicates**: never start a replacement before the original rests
- **Git**: the factory branches and merges. The supervisor creates the central worktree, never pushes, never touches the primary checkout
- **A change to code a running service loads** (a moved path, a new install): plan the restart with the user first, or keep the old path working until it happened
- **Cleanup**: every unit and process the run registered. Merged waves' branches go with `waves.remove`; the central worktree and the tasks on the board stay
- **User**: no reports and no review requests unless the user asked for them. Ask only for materially different tradeoffs, otherwise take the conservative choice and record it in the contract. The one message the user reads is the final overview (section 8). The board shows the rest

## 7. Retro (last)

- Read `run/feedback`. Write `run/retro.md`, one page:
  - the costliest problems with evidence and cost
  - one proposed edit each (this skill, `AGENTS.md`, the repo, the factory, the environment) or "no action"
  - what worked
- The user reads it when they want and asks for the edits they approve

## 8. Final overview (the last message, also saved as `run/overview.md`)

What the user needs to understand how the new system works, at a high level. It is the text they read now and look up later.

- **Content**: what exists now and how its parts work together · how to use it · what behaves differently than before · decisions taken on the user's behalf · what is left open · where the central worktree is
- **Not in it**: how the run went, per-task detail, anything the user can get by asking
- **Form**: sections of bullet points. A section may open with two or three sentences. As long as the information needs, no longer
