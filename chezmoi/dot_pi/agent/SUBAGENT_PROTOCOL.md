# Subagent protocol

How parallel subagent work (the `parallelize-plan` skill) is set up, and why. A single subagent without a plan needs none of this: `AGENTS.md`, section 8. The binding rules live in the files under "Where it is defined": change them there, then bring this page in line.

## Goal

High-quality, conflict-free parallel work at low token cost. The expensive supervisor decides and never reads code in bulk, cheap scouts read, workers write, nothing is explored twice.

## Roles

| Role | Model tier | Does |
|---|---|---|
| supervisor | strongest | plans stages, writes the contract, decides, reports to the user |
| `oracle` | strongest | second opinion on hard decisions |
| `scout` | cheap and fast | reads code, writes the map |
| `worker` | strong coder | implements one slice |
| `reviewer` | strong coder, high thinking | independent review, with shell and write tools so it reproduces instead of guessing |
| other roles | cheap and fast | default, so nothing inherits the supervisor's model unnoticed |

Limits: nesting depth 2, 10 tasks per call, 10 at once.

## Run directory

```
<run>/
  contract.md      supervisor only: core (rules, environment) + one section per stage
  map/index.md     what is known about which part of the codebase
  map/<concern>.md facts per concern, written by scouts, corrected by whoever changes the code
  handoffs/        one short state note per slice (1.5 KB)
  feedback.md      one line per protocol problem or suggestion, from every agent
  retro.md         the supervisor's suggestions for the user
```

## Flow of a stage

```
scouts ──▶ map ──▶ supervisor fixes shared names in the contract
                         │
        workers in parallel, one worktree, disjoint files
                         │  finish only when their acceptance commands pass
                         ▼
        handoffs ──▶ supervisor: decide change requests, one full check
                         │
        independent review of large, risky and/or complex slices ──▶ fixes by a fresh worker
```

After the last stage: one integrated smoke agent, commit proposals, then the retro from `feedback.md`.

## Why it is built this way

| Choice | Reason |
|---|---|
| Contract with exact shared names before a stage starts | Parallel agents that agree on names late drift apart, and late changes miss agents that already finished |
| One shared worktree, disjoint file ownership | No merges, no conflicts, one environment |
| Map split by concern, with an index | Agents read only their concerns, a change touches one small file, nothing is scouted twice |
| Handoff holds state only | The supervisor reads every handoff: narrative there costs the most expensive tokens |
| `feedback.md` apart from handoffs | How the work went improves the protocol, not the task: read once, at the end |
| Standing defaults in every brief | Each question to the supervisor costs a turn and leaves the agent idle |
| Supervisor makes small follow-up edits itself | A steer can arrive after the agent has finished |
| Acceptance tests outside the repo, lasting tests must earn their place | Proof of completion without filling the repo with tests |
| Agents never change existing tests without approval | A test bent to pass proves nothing |
| One full check per stage by the supervisor | Slices that pass alone can break together |
| Independent review, supervisor decides where | Passing tests missed a data-loss bug the review found |
| Wait on a signal, bound every wait | Polling delays follow-up work, an unbounded wait can cost the session |

## Where it is defined

Sources in `~/.os/chezmoi/`, deployed by chezmoi.

| What | Source |
|---|---|
| The protocol itself | `dot_agents/skills/parallelize-plan/SKILL.md` |
| Testing, waiting, long-running processes, plain subagent use | `dot_agents/AGENTS.md`, sections 2 "Testing", 5 "Waiting", 7, 8 |
| Working in a worktree (overlay venv, packages, submodules) | `dot_agents/skills/worktree/SKILL.md` |
| Models, thinking and tools per role | `dot_pi/agent/modify_settings.json` (`subagents`) |
| Depth and parallel limits | `dot_pi/agent/extensions/subagent/config.json` |
| Worktrees ready to work in | `dot_local/bin/executable_agent-worktree`, `/worktree` in `dot_pi/agent/extensions/worktree.ts` |
| Pi packages (`pi-subagents`, `pi-interactive-shell`, ...) | `run_onchange_after_install-pi-packages.sh` |
