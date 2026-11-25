# Parallel work protocol

How parallel agent work (the `parallelize-plan` skill) is set up, and why. A single subagent without a plan needs none of this: `AGENTS.md`, section 8. The binding rules live in the files under "Where it is defined": change them there, then bring this page in line.

## Goal

High-quality, conflict-free parallel work at low token cost, with quality gates that are code and not goodwill. The expensive supervisor decides and never reads code in bulk, cheap scouts read, coders write as factory tasks, a reviewer gates every wave, the factory reports to the supervisor whatever needs a decision, and the user reads one message at the end and sees the rest on the board.

## Three parts

| Part | Does | Where |
|---|---|---|
| `parallelize-plan` skill | the orchestration: how a plan becomes tracks, waves and tasks, who decides what | `dot_agents/skills/parallelize-plan/SKILL.md` |
| `agent-factory` | the execution: a task in its own worktree, gates after every turn, tests in the merge queue, review, merge | `github.com/patrickab/agent-factory` (`factory` CLI, MCP server, Pi extension) |
| `memory-store` | the memory: contract, map of the codebase, plan descriptions, feedback | `github.com/patrickab/memory-store` (`memory-store` CLI, MCP server) |

## Terms

| Term | What it is | In the factory |
|---|---|---|
| Track | An independent part of the plan | first segment of a task's tag |
| Milestone | A goal inside a track, a group of waves | middle segment of the tag |
| Wave | The tasks built and reviewed together | a wave: declared once with its tasks, a branch off central, one review, one merge |
| Task | One commit: a ticket whose title and description are the commit message | a factory task merging into the wave's branch |

A task the user starts alone belongs to no wave: its tag is the user's name.

## Roles

| Role | Runs as | Does |
|---|---|---|
| supervisor | the session the user talks to, strongest model | plans, writes the contract, declares waves, answers questions, decides on blocked tasks and rejected waves. Never waits inside a turn |
| scout | subagent, cheap and fast | reads code, writes the map, checks the plan's file lists against the code |
| coder | factory task | implements one task; asks through `factory_ask_supervisor` |
| reviewer | started by the factory when a wave's tasks are done | judges the wave's whole diff, approves or rejects with findings. No time limit, starts no tasks |

## Flow

```
supervisor: waves.start (tag, reviewer instructions, tasks with their order) ─▶ ends its turn
                                                                                    ▲
factory:   wave branch ◀── merge queue (tests) ◀── gates ◀── coder turn             │ reports that start a turn:
              │  starts each task when its predecessors are done                    │ a coder asks · a task is blocked
              ▼  all tasks done                                                     │ the wave is rejected (with findings)
           rebase ─▶ gates ─▶ reviewer ─▶ approved ─▶ merge queue ─▶ central        │ the wave is blocked · merged
                                 └─▶ rejected ──────────────────────────────────────┘
supervisor: answers (tasks.message) · adds fix tasks (waves.add) · declares the next wave
```

After the last wave: one smoke run in the central worktree, the retro from `run/feedback`, the final overview.

## Why it is built this way

| Choice | Reason |
|---|---|
| Coders are factory tasks, not subagents | Gates, tests and merge are deterministic code, every step is on the board, and a task survives a restart |
| The factory has its own message path (`factory_ask_supervisor`, `tasks.message`, reports into the supervisor's session) | No dependency on a harness's subagent or intercom tools, and questions stay in the task's record |
| The factory reports, the supervisor never waits | A supervisor inside a wait shows nothing and cannot be talked to: to the user the run looks dead |
| A wave never waits silently | Whatever the supervisor cannot see does not exist for it: every stall rests in a state that is reported, with its reason |
| A wave is an object of the factory, declared once | The factory owns the order of its tasks, the review and the merge; the supervisor only decides. Tasks of a wave see each other's merged work, the reviewer judges them together, and central only ever receives reviewed code |
| A wave has no session of its own | Rebase, gates and merge are deterministic steps, the reviewer is one process: a session around them was only a container |
| Nothing reaches a wave's branch after its review began | Gates and reviewer must see exactly what is merged; later work goes back through the review |
| After a rejection the supervisor decides | What to do with a finding is judgement: the reviewer only judges, the factory never creates fix tasks |
| The reviewer has no time limit | A whole wave's diff takes as long as it takes; a cut review is a lost one |
| What is stored, what programs get, what agents get are three things | The record is a full event log, a UI gets all of it as JSON, an agent gets the few lines its next decision needs |
| A wave's commits are never squashed | A task is a commit: the history says what the plan said |
| Track and milestone are only tag segments | The plan's shape can change without touching the factory |
| A central branch per plan | The user looks at one place and nothing touches the primary checkout |
| Contract with exact shared interfaces and invariants before a wave starts | Parallel agents that agree late drift apart, and a rule left unsaid costs a review round per hole |
| Interface needs go into the contract, code needs create an order | What only needs a signature can be built at the same time, which is where the parallelism comes from |
| Map in memory-store, facts updated by id | Agents read only their concerns, parallel corrections do not collide, nothing is scouted twice |
| Scouts check the plan against the code | Plans miss files, and a gap found before the wave is cheap |
| Feedback apart from the work | How the work went improves the protocol, not the task: read once, at the end |
| No reports during the run, one final overview | The user's attention goes to one text worth keeping, the board shows the rest |
| A sketch before UI tasks are cut | What the user will look at is cheapest to correct before it is built |
| Fixes outside every task's files are made once, on central | Two parallel tasks that both repair the same shared file collide at merge |

## Where it is defined

Sources in `~/.os/chezmoi/`, deployed by chezmoi.

| What | Source |
|---|---|
| The protocol itself | `dot_agents/skills/parallelize-plan/SKILL.md` |
| Testing, waiting, long-running processes, plain subagent use | `dot_agents/AGENTS.md`, sections 2 "Testing", 5 "Waiting", 7, 8 |
| Working in a worktree (overlay venv, packages, submodules) | `dot_agents/skills/worktree/SKILL.md` |
| Models, thinking and tools of scouts | `dot_pi/agent/modify_settings.json` (`subagents`) |
| Models of coders and reviewers | the factory's settings per repo (`factory settings.get`) |
| A repo's gates, hooks and role prompts | its `factory.yaml` and `.factory/agents/` |
| Worktrees ready to work in | `dot_local/bin/executable_agent-worktree`, `/worktree` in `dot_pi/agent/extensions/worktree.ts` |
