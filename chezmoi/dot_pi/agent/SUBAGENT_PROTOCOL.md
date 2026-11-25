# Subagent protocol

How parallel subagent work (the `parallelize-plan` skill) is set up, and why. A single subagent without a plan needs none of this: `AGENTS.md`, section 8. The binding rules live in the files under "Where it is defined": change them there, then bring this page in line.

## Goal

High-quality, conflict-free parallel work at low token cost. The expensive supervisor decides and never reads code in bulk, cheap scouts read, coders write, nothing is explored twice, and the user reads one message at the end.

## Terms

| Term | What it is | Runs |
|---|---|---|
| Track | An independent part of the plan with its own worktree | in parallel |
| Milestone | A reviewed state of one track, merged into the central worktree | in order within a track |
| Wave | The coders working at the same time, tested once together | in order within a milestone |
| Task | One commit: a ticket whose title and description are the commit message | in order within one coder |

## Roles

| Role | Model tier | Does |
|---|---|---|
| supervisor | strongest | plans tracks, milestones, waves and tasks, writes the contract and the briefs, decides, merges approved milestones |
| `oracle` | strongest | second opinion on hard decisions |
| `scout` | cheap and fast | reads code, writes the map, checks the plan's file lists against the code |
| `worker` (coder) | strong coder | implements its chain of tasks and commits each |
| `reviewer` | strong coder, high thinking | the quality gate per milestone, with shell and write tools so it reproduces instead of guessing, may spawn scouts |
| other roles | cheap and fast | default, so nothing inherits the supervisor's model unnoticed |

Limits: nesting depth 2, 10 tasks per call, 10 at once.

## Run memory_store

One memory_store per plan in memory-store (`<project>/<plan>`), reached with the `memory-store` CLI or the MCP tools.

```
run/contract.md              supervisor only: core (rules, environment) + what tracks and coders share
map/<concern>                facts per concern, written by scouts, corrected by whoever changes the code
briefs/<wave>-<coder>.md     what to read, owned files, the coder's tasks in order
handoffs/<wave>-<coder>.md   state only: commits, acceptance output, change requests, risks
handoffs/<track>-<milestone>-review.md
run/feedback                 one fact per protocol problem or suggestion, from every agent
run/retro.md                 the supervisor's suggestions, read by the user when they want
run/overview.md              the final overview, also the supervisor's last message
```

## Flow

```
central worktree ◀─────────────────────────────── merge ◀──┐
   │ branch                                                │
   ▼                                                       │
track worktree                                             │
   scouts ──▶ map ──▶ contract: shared interfaces, ownership│
                         │                                 │
        coders in parallel, disjoint files, a commit per task
                         │                                 │
        handoffs ──▶ supervisor decides ──▶ full suite, once per wave
                         │  (next wave, until the milestone is built)
                         ▼                                 │
        reviewer: the milestone's diff ──▶ approved ───────┘
                         └─▶ rejected: findings become one more wave
```

After the last milestone: the full suite and one smoke run in the central worktree, the retro from `run/feedback`, the final overview.

## Why it is built this way

| Choice | Reason |
|---|---|
| Tracks with their own worktree | Independent parts never see each other's half-finished work and never wait for each other |
| A central worktree that milestones merge into | The user looks at one place, and every track starts its next milestone from what the others delivered |
| Contract with exact shared interfaces before a wave starts | Parallel agents that agree late drift apart, and late changes miss agents that already finished |
| Interface needs go into the contract, code needs create an order | What only needs a signature can be built at the same time, which is where the parallelism comes from |
| Disjoint file ownership inside a wave | No conflicts, one environment per track |
| Task = ticket = commit | The plan, the brief and the history say the same thing once, and a task maps onto a factory task |
| Briefs as files, a one-line spawn task | Inline briefs hit the harness's argument limit and cannot be reread |
| Map in memory-store, facts updated by id | Agents read only their concerns, parallel corrections do not collide, nothing is scouted twice |
| Scouts check the plan against the code | Plans miss files, and a gap found before the wave is cheap |
| Handoff holds state only | The supervisor reads every handoff: narrative there costs the most expensive tokens |
| Feedback apart from handoffs | How the work went improves the protocol, not the task: read once, at the end |
| Agent rules once in the contract core | Repeating them in every brief costs tokens, and each question to the supervisor costs a turn |
| Full suite once per wave, coders run their own tests | Tasks that pass alone can break together, and running everything per agent wastes time |
| One reviewer per milestone, only on code that passed the suite | Passing tests missed a data-loss bug the review found, and review tokens are not spent on broken code |
| No reports during the run, one final overview | The user's attention and the supervisor's tokens go to one text worth keeping |
| Wait on a signal, bound every wait | Polling delays follow-up work, an unbounded wait can cost the session |

## Where it is defined

Sources in `~/.os/chezmoi/`, deployed by chezmoi.

| What | Source |
|---|---|
| The protocol itself | `dot_agents/skills/parallelize-plan/SKILL.md` |
| Testing, waiting, long-running processes, plain subagent use | `dot_agents/AGENTS.md`, sections 2 "Testing", 5 "Waiting", 7, 8 |
| Working in a worktree (overlay venv, packages, submodules) | `dot_agents/skills/worktree/SKILL.md` |
| Models, thinking and tools per role | `dot_pi/agent/modify_settings.json` (`subagents`) |
| The memory the run lives in | `github.com/patrickab/memory-store` (`memory-store` CLI, MCP server `memory`) |
| Depth and parallel limits | `dot_pi/agent/extensions/subagent/config.json` |
| Worktrees ready to work in | `dot_local/bin/executable_agent-worktree`, `/worktree` in `dot_pi/agent/extensions/worktree.ts` |
| Pi packages (`pi-subagents`, `pi-interactive-shell`, ...) | `run_onchange_after_install-pi-packages.sh` |
