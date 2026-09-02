---
name: optimize
description: >-
  Improve a codebase toward a stated goal — speed, memory, readability,
  docstrings, whatever "/optimize <task>" names. Break it into discrete changes,
  implement each in its own sequential subagent, verify each actually helps (with
  a benchmark when the goal is measurable), and keep + commit only the ones that
  do. Explicit invocation only.
argument-hint: <optimization task>
disable-model-invocation: true
allowed-tools: Task, Bash, Read, Write, Edit, Grep, Glob
---

# /optimize

`$ARGUMENTS` is the goal. You orchestrate: plan, dispatch subagents, verify,
commit. Subagents write the code; you decide what ships. Keep only changes that
provably help.

## 1. Frame the goal

State in one line what "better" means here and how you'll check it:

- **Measurable** (time, memory, latency, size, …) → a benchmark decides.
- **Non-measurable** (readability, docstrings, structure) → tests still pass and
  the change clearly serves the goal without altering behavior.

## 2. Plan

Explore the code, then list the discrete changes, smallest blast radius first.
Keep it tight. Apply them cumulatively — each change starts from the state the
last accepted one left.

## 3. Per-change loop (sequential — never parallel)

Resolve each change (commit or revert) before starting the next.

**a. Baseline** (measurable goals only). Reuse the last measurement when the code
and the check are both unchanged since it was taken — after a reverted change
(baseline still holds), or after an accepted one verified with this same check
(its winning number is now the baseline). Measure fresh only for a new check or
an otherwise-unknown state.

**b. Implement.** Dispatch one subagent (Task tool) with the brief in §5.

**c. Verify.** Measurable: run the check against the change and compare to
baseline under §4. Non-measurable: run the tests and confirm the change does what
the goal asked without changing behavior.

**d. Gate.** Real improvement → §6. Otherwise revert the edits, note it in one
line, and move on.

## 4. Benchmarking (measurable goals)

- Baseline and candidate: same environment, same inputs, back to back.
- Warm up, then take enough runs to see the noise (median + spread). Use
  hyperfine, a one-off script in any language, whatever fits — but keep it short
  and easy to review.
- A win must clearly clear the noise. "Looks a bit better" is a revert; if
  variance is high, add runs rather than lower the bar.
- Runs wherever the session is; chain the ssh skill first if you need a host.

## 5. Subagent brief (pass to each)

> Make exactly this one change, nothing else: **<change>**. Goal: **<goal>**.
> Don't break the tests or the check at `<path>`.
> - Match the codebase's conventions; read nearby code first.
> - Write the minimal, idiomatic version. Concise and clear beats clever.
> - No new abstractions, deps, or refactors the change doesn't require.
>
> Return: what changed, why it helps, and anything I should verify.

## 6. Land a win

- If it's a benchmarked improvement, optionally record it under
  `docs/performance/<feature>.md`: a sentence or two on the problem, the check,
  and before/after numbers with the environment. Short.
- Glance at the diff for a cleaner form that keeps the win — subagents already
  aim for this, so it's usually just confirmation. If you simplify, re-verify.
- Commit as one conventional commit, picking the type that fits the change:
  `perf`, `feat`, `fix`, `docs`, `refactor`, `chore`. Put before → after in the
  body for measured wins.

## Never

Claim an improvement you didn't verify. Commit a non-improvement. Run subagents
in parallel. Skip the revert on a non-win.
