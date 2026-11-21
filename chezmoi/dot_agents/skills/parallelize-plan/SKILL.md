---
name: parallelize-plan
description: Supervise the implementation of an approved plan with parallel subagents. One contract as source of truth, a shared codebase map, strict file ownership, short handoffs, one feedback file, a retro that improves the next run. Use when the user asks to implement a plan, issues or slices with subagents in parallel.
---

The supervisor plans, briefs, decides and reports. Scouts read, workers implement, reviewers judge. The supervisor never reads code in bulk and never reads how a child's work went. Spawn, steer, message, check and stop children with the harness's own delegation tools, whose documentation is authoritative.

## Run directory

`<run>` is one directory per plan in the repo's planning area (git-ignored), or a session scratch mirrored there after every change.

```
<run>/
  contract.md      supervisor only: core + one section per stage
  map/
    index.md       one line per concern: file, what it covers, status (explored, partly, stale)
    <concern>.md   what is known about one part of the codebase
  handoffs/
    <stage>-<slice>.md
  feedback.md      append-only, every agent, one line per entry
  retro.md         the supervisor's suggestions for the user, written last
```

- **`contract.md`**
  - Core, under 2 KB, every agent reads it: the rules of this skill that bind agents, the environment (worktree path, how to run tests and checks there, the throwaway database recipe, the cheap-model run command, services nobody touches)
  - One section per stage: interfaces with exact names (types, signatures, routes, messages, env vars, ports, storage keys), the file-ownership table, decisions taken
  - A landed stage shrinks to one line. Its detail stays in the handoffs
- **`map/`**: facts an agent gets slower from the code: ownership, contracts, entry points with `file:line`, traps, how to run things. No prose summaries of files. Any agent corrects a map file when it changes what the file describes, and adds its line to `index.md` for a new concern. A failed edit means re-read and retry. The map dies with the run: lasting knowledge belongs in the repo's docs
- **Handoff**, 1.5 KB at most, state only: what changed (files), each acceptance command with the last line of its output, contract change requests with exact shapes, open risks. No narrative
- **`feedback.md`**: `time · agent · kind · what happened · cost · suggestion`. Protocol, brief, tool and environment problems, and suggestions for them. Nobody reads it during the run

## Stage loop

1. **Slice**: one task per plan item. One concern, about 10 files, about 70 agent requests, verifiable on its own. Bigger: split before spawning.
2. **Scout**: for every concern the stage needs and `map/index.md` does not list as explored, a scout writes `map/<concern>.md`. Scouts of one stage run in parallel. Nothing is scouted twice.
3. **Stage**: group slices with disjoint file ownership into one stage. A file several slices need: sequence them, or run a small backbone slice first.
   - **Shared names first**: every type, signature, route or file that two slices of the stage both touch is in the contract with its exact name before the stage starts
   - **Ripple files**: for everything a slice removes or renames, grep its importers and callers (code, tests, scripts, docs). Each one goes into exactly one ownership row
   - **Checkout**: agents never work in the user's primary checkout. A stage shares one worktree, made once through the `worktree` skill. A slice gets its own checkout only when it needs a quiet tree: it regenerates files, runs a formatter or codemod over the repo, or changes dependencies
4. **Brief** per agent, 4k chars at most:
   - goal, owned files, acceptance commands that must pass before it may finish
   - the contract sections and map files to read, by name. Never "read the contract end to end", never another slice's handoff unless one is named for a reason
   - the standing defaults below, so the agent does not stop to ask
5. **Spawn** the stage at once. Wait for the completion notices, never poll.
6. **Collect**: read the handoffs. Decide every change request, write accepted ones into the contract. Run the full check (build, lint, whole suite) once, output to a log, and read its tail.
7. **Review**: large, risky and/or complex slices must undergo independent review. The reviewer gets a shell and a write tool, reproduces what it can, and writes `handoffs/<stage>-review.md`: blocker, major, minor, each with `file:line`, a failing scenario and the smallest fix. Fixes go to a fresh worker.
8. Repeat until every acceptance criterion of the plan holds. Then one integrated smoke agent. Then propose commits to the user.
9. **Retro**: the supervisor reads `feedback.md` and writes `retro.md`, one page for the user: the costliest problems with evidence and cost, one proposed edit each (this skill, `AGENTS.md`, the repo, the environment) or "no action", and what worked. The user approves every edit. An approved edit to the protocol also goes into `~/.os/chezmoi/dot_pi/agent/SUBAGENT_PROTOCOL.md`, the overview of how and why it is set up.

## Standing defaults (quote in every brief)

- Tests follow `AGENTS.md`, "Testing". You finish only when your acceptance commands pass, and you run only the tests and type checks of your own files.
- Tests of your owned files are yours. A file outside your list that breaks only through your change: make the smallest fix and name it in the handoff.
- A name a sibling has not delivered yet: build against the contract's name, work around it locally, name it in the handoff.
- Ask the supervisor only when a decision changes the contract or risks data. Everything else: take the conservative choice and name it in the handoff.
- A failure that comes from a file you do not own is reported, not fixed.
- Read code by range, pipe logs through `tail`, query specific UI elements instead of dumping pages.
- No git state changes. Throwaway repos: `git -C <abs path>`, `set -e`, `mkdir -p` before `cd`.
- Correct the map files you read when your change makes them wrong.
- Your handoff states the result, never how the work went. A problem with the protocol, the brief, the tools or the environment, or a suggestion for them, goes as one line into `feedback.md`.
- Waiting follows `AGENTS.md`, "Waiting": on a signal, bounded, with short timeouts.

## Contract changes

- A subagent requests a change with its justification (in the handoff, or as a supervisor request when it blocks).
- The supervisor decides and writes the contract. Then, per affected agent: check its status first. Still running: steer it with the delta. Finished: the supervisor applies an edit of up to about 20 lines itself, a larger one goes into the next stage.

## Safeguards

- **Session size**: slice and brief size are the control, the harness's request or time budget only a backstop. An agent near 70 requests or about 200k context finishes its current step and hands off, a fresh agent briefed from that handoff does the rest. Large live verification runs in its own fresh agent, never at the tail of a long implementation run.
- **No duplicates**: never spawn a replacement before the original's run is idle.
- **Ownership over messaging**: peer messages carry information, never ownership. Two agents never write the same code file.
- **Dependencies**: an agent names a dependency it needs in its handoff (package, version, why). The supervisor adds it in the primary checkout (`uv add -q`, `npm install --silent`). Manifests and lockfiles are supervisor-only.
- **Shared running services**: agents never stop, restart or rebuild the user's running instance. They use spare ports and scratch homes and stop what they start.
- **No git state changes** by agents. The supervisor commits only when the user asks.
- **Cleanup**: agents name every worktree, unit or process they register. The supervisor removes them.

## Talking to the user

- After each stage: what landed, verification, decisions needed (`Q1`), risks (`R1`).
- Ask only for materially different tradeoffs. Otherwise pick the conservative default, record it in the contract, and say so.
- A user decision that changes scope: update the contract first, then spawn.
