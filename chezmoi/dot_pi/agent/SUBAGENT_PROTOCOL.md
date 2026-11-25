# Parallel work protocol

How parallel agent work (the `parallelize-plan` skill) is set up, and why. A single subagent without a plan needs none of this: `AGENTS.md`, section 8. The binding rules live in the files under "Where it is defined": change them there, then bring this page in line.

## Goal

High-quality, conflict-free parallel work at low token cost, with quality gates that are code and not goodwill. The expensive supervisor decides and never reads code in bulk, cheap scouts read, coders write as factory tasks, a reviewer gates every wave, and the user reads one message at the end and sees the rest on the board.

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
| Wave | The tasks built and reviewed together | a branch off central and one merge request back |
| Task | One commit: a ticket whose title and description are the commit message | a factory task merging into the wave's branch |

A task the user starts alone belongs to no wave: its tag is the user's name.

## Roles

| Role | Runs as | Does |
|---|---|---|
| supervisor | the session the user talks to, strongest model | plans, writes the contract and the requests, answers questions, decides on blocked tasks |
| scout | subagent, cheap and fast | reads code, writes the map, checks the plan's file lists against the code |
| coder | factory task | implements one task; asks through `factory_ask_supervisor` |
| reviewer | factory merge request | judges a wave's whole diff, approves or rejects with findings |

## Flow

```
central branch ◀──────────────── fast-forward ◀─────────────┐
   │ git branch                                             │
   ▼                                                        │
wave branch ◀── merge queue (tests) ◀── task ◀── gates ◀── coder turn
   │                                     ▲                  │
   │            supervisor: tasks.wait ──┘ answers, retries │
   ▼                                                        │
merge request: rebase ─▶ gates ─▶ reviewer ─▶ approved ─────┘
                                     └─▶ rejected: findings become tasks of the wave, then retry
```

After the last wave: one smoke run in the central worktree, the retro from `run/feedback`, the final overview.

## Why it is built this way

| Choice | Reason |
|---|---|
| Coders are factory tasks, not subagents | Gates, tests and merge are deterministic code, every step is on the board, and a task survives a restart |
| The factory has its own message path (`tasks.wait`, `tasks.message`, `factory_ask_supervisor`) | No dependency on a harness's subagent or intercom tools, and questions stay in the task's timeline |
| A wave is a branch with a merge request | Tasks of a wave see each other's merged work, the reviewer judges them together, and central only ever receives reviewed code |
| Merge requests are never squashed | A task is a commit: the history says what the plan said |
| Track and milestone are only tag segments | The plan's shape can change without touching the factory |
| A central branch per plan | The user looks at one place and nothing touches the primary checkout |
| Contract with exact shared interfaces and invariants before a wave starts | Parallel agents that agree late drift apart, and a rule left unsaid costs a review round per hole |
| Interface needs go into the contract, code needs create an order | What only needs a signature can be built at the same time, which is where the parallelism comes from |
| Map in memory-store, facts updated by id | Agents read only their concerns, parallel corrections do not collide, nothing is scouted twice |
| Scouts check the plan against the code | Plans miss files, and a gap found before the wave is cheap |
| Feedback apart from the work | How the work went improves the protocol, not the task: read once, at the end |
| No reports during the run, one final overview | The user's attention goes to one text worth keeping, the board shows the rest |
| Wait on a signal, bound every wait | Polling delays follow-up work, an unbounded wait can cost the session |

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
