---
name: parallelize-plan
description: Supervise the implementation of an approved plan through the agent factory. Tracks, milestones, waves and tasks, one contract as source of truth, a shared map in memory-store, every task a factory task with deterministic gates, every wave a reviewed merge request into one central branch. Use when the user asks to implement a plan, issues or tasks with agents in parallel.
---

Roles: the supervisor plans, briefs and decides. Scouts read, coders implement, the reviewer is the quality gate.
The supervisor never reads code in bulk.

- **Coders and reviewers are factory tasks** (`agent-factory`): own worktree, gates after every turn, tests in the merge queue, one commit per task, visible on the board. Reach the factory with the `factory` tool, the MCP tool, or the CLI `factory <action> '<json>'` (`factory --help`)
- **Scouts are ordinary subagents**: they write no code, so there is nothing to gate or merge
- **Memory** is `memory-store` (CLI `memory-store`, or its MCP tools): the plan, the contract, the map

## Terms

| Term | What it is | In the factory |
|---|---|---|
| **Track** | An independent part of the plan | first segment of the tag |
| **Milestone** | A goal inside a track, a group of waves | middle segment of the tag |
| **Wave** | The tasks that are built and reviewed together | a branch off central, and one merge request back into it |
| **Task** | One commit: a ticket with a title and a description | one factory task that merges into the wave's branch |

```
central branch ◀── every approved wave merges here
│
├─ TRACK a
│   ├─ MILESTONE 1
│   │   ├─ WAVE 1   branch a-1-1   task ─▶ task       task        (tag a/1/1)
│   │   │           └ merge request ─▶ reviewer ─▶ central
│   │   └─ WAVE 2   ...
│   └─ MILESTONE 2
└─ TRACK b
    └─ WAVE 1       branch b-1     task ─▶ task                   (tag b/1)
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
2. **Contract**: write down what tracks and coders share, exact: signatures, routes with request and response shapes, types, env vars. And the invariants: what must hold whatever the implementation does
   - a need for an *interface* goes into the contract and creates no order
   - a need for *finished code* creates an order: the next wave, or the next task of a chain
3. **Milestones** per track, where they help reading the plan
4. **Tasks**: each one commit, verifiable on its own. Chain neighbours (a neighbour builds on the task before it)
5. **Waves**: chains with disjoint files form a wave
   - repeated work of one shape (many endpoints, many scenes): one task goes first as pilot, its lessons go into the other requests, then the rest fan out

## 2. Setup (once)

- **memory_store**: `memory-store create <project>/<plan> map plan run`
  - `<project>` = last segment of the repo path
  - `run/contract.md` supervisor only · `map/<concern>` facts · `plan/<tag prefix>.md` the description of a track, milestone or wave, which the board shows · `run/feedback` facts · `run/retro.md` · `run/overview.md`
  - a document: `memory-store apply <store> --ops '[{"op":"write_doc","path":"plan/a/1.md","text":"..."}]'`. A first fact: `{"op":"add","path":"map/x","description":"...","text":"..."}`
- **Central branch and worktree** through the `worktree` skill, never the user's primary checkout: every approved wave merges here, the user looks only here
  - it starts from the primary checkout's current state, uncommitted work included, taken as a snapshot (`git stash create`) that leaves the checkout untouched
  - it must hold the repo's committed `factory.yaml` (`factory config.get`), and factory models must be set (`factory models.get`)
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
3. **Describe** the wave: `plan/<tag>.md` (what it delivers, its tasks). Tracks and milestones get theirs once
4. **Branch**: `git branch <plan>-<track>-<wave> <central branch>`, checked out nowhere
5. **Start** every task that waits for no other task:
   ```
   factory tasks.start '{"title": "<task title>", "request": "<see below>", "tag": "<track>/<milestone>/<wave>",
     "plan": "<project>/<plan>", "overrides": {"branch": "<wave branch>", "merge": "auto"}}'
   ```
   - **request**: read `run/contract.md` and the named map memories · the task's description · its acceptance commands · "files of an interrupted predecessor may exist: verify them, then continue"
   - the next task of a chain starts when its predecessor is `done`
6. **Wait**: `factory tasks.wait '{"tag": "<track>/<milestone>/<wave>"}'`, never poll. It returns when all rest or one needs attention:
   - `waiting_answer`: the coder asked (`question`). Decide, answer with `tasks.message`
   - `blocked`: read `tasks.timeline`, then `tasks.message` with what to change, or `tasks.retry`, or cut the task differently
   - tasks you have dealt with go into `ignore` on the next wait
7. **Collect**: read the change requests and risks at the end of each task's last message. Decide each, write accepted ones into the contract
8. **Merge request**, when every task of the wave is `done`:
   ```
   factory tasks.start '{"kind": "merge_request", "source": "<wave branch>", "title": "<what the wave delivers>",
     "request": "<reviewer instructions>", "tag": "<same tag>", "plan": "<project>/<plan>",
     "overrides": {"branch": "<central branch>"}}'
   ```
   - the factory rebases the wave, runs the gates, has the reviewer judge the whole diff, runs the tests in the merge queue and fast-forwards central. The wave's commits stay as they are
   - `blocked` `review_rejected`: the findings (timeline) become tasks of the same wave and tag, then `tasks.retry` the merge request
   - a second rejection on the same topic: decide the rule yourself, write it into the contract as an invariant, and give the fix task that rule, not the reviewer's smallest fix
   - `blocked` `conflict` or `gates`: a task in the wave fixes it on the wave's branch, then `tasks.retry`
9. The wave shrinks to one line in the contract

After the last wave: one integrated smoke run in the central worktree, then the retro, then the final overview.

## 4. Reviewer (the merge request's `request`)

The reviewer is the quality gate: no wave reaches central without its approval. It only sees code that passed the gates.

- **What to read**, by name: `run/contract.md` · the wave's `plan/` documents · the map memories · `.docs/architecture.md` and `.docs/module-map.md` where they exist
- **What the wave was meant to deliver**, and the contract's invariants it must hold
- **What to judge**:
  - follows the repo's code and project standards (`AGENTS.md`)
  - reuses what exists instead of rebuilding it
  - no complexity the task does not need
  - readable by a human, documented where a reader needs it
  - modular, reusable where reuse is real
  - correct at the edges the tests do not cover
  - test gaps: behaviour the wave adds or changes that no test would catch if it broke
- Reject only for a blocker or major finding, each with `file:line`, an executed failing scenario where one exists, and the smallest fix

## 5. Agent rules (go into the contract core)

- **Done** means your acceptance commands pass. The factory runs the gates after your turn and the tests at merge, and commits for you
- **Scope**: change what the task needs. A file another task of the wave owns: build against the contract instead, and say so
- **Ask** the supervisor (`factory_ask_supervisor`) only when a decision changes the contract or risks data. Otherwise take the conservative choice and name it
- **Never**: manifests or lockfiles (name the dependency) · the user's running services · existing tests bent to pass (adapt one only where the contract changes the behaviour it asserts)
- **Map**: `update` a fact you found wrong, `add` what the next agent would have to rediscover
- **Last message**, state only: contract change requests with exact shapes · open risks · what you left undone
- **Feedback**: a problem with the request, the protocol, the tools or the environment is one `add` to `run/feedback`: `kind · what happened · cost · suggestion`

## 6. Supervisor rules

- **Contract changes**: decide, write the contract, then per affected task: running → `tasks.message` with the delta; done → a new task in the wave
- **No duplicates**: never start a replacement before the original rests
- **Git**: the factory merges. The supervisor creates branches and the central worktree, never pushes, never touches the primary checkout
- **Cleanup**: remove the wave branches that merged and every unit and process the run registered. The central worktree and the tasks on the board stay
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
