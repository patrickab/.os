---
name: vibe-hpo
description: Execute an hpo-plan.md — run each phase sequentially, document each run, adjust future plan based on observations. Also covers observable process execution with tmux, inspecting run artifacts, and Optuna conventions. Trigger on "run/execute this hpo plan", references to an hpo-plan file, or any training/sweep/benchmark launch.
---

# Vibe HPO

Execute the referenced hpo-plan.md sequentially, phase by phase. After each run, inspect the
results and make a decision before starting the next.

Run dedicated drivers via `uv run python scripts/<driver>.py`.

## Process observability

Run any process that may outlive a single tool call or need live or post-exit inspection in tmux.
This includes training, sweeps, HPO, benchmarks, servers, monitors, and long-running scripts. Never
launch them with bare backgrounding, `nohup ... &`, or `disown`. Foreground commands that complete
within one tool call and return their full output do not need tmux.

- Reuse an existing named session if possible; otherwise create one named after the repository or
  task: `tmux new-session -d -s <session>`.
- Use one clearly named window per process and print its exit status before retaining the pane:
  `tmux new-window -t <session> -n "agent: <name>" '<command>; rc=$?; printf "\n[process exited %s]\n" "$rc"; read'`.
- Command must stream live progress into the pane — don't redirect it away. If it can't render
  live, pipe through `tee <logfile>`.
- Keep the trailing completion marker and `read` so output and exit status remain visible.
- Immediately verify the process and visible output with
  `tmux list-panes -t '<session>:<window>' -F '#{pane_pid} #{pane_dead} #{pane_current_command}'`
  and `tmux capture-pane -p -t '<session>:<window>' -S -100`.
- Observe later progress with `tmux capture-pane`; use `tmux list-panes`, the pane's current
  command, and the `[process exited N]` marker to distinguish running from completed. Do not infer
  status only from artifact files.
- Report the session/window, attach command (`tmux attach-session -t <session>`), and direct window
  command (`tmux select-window -t '<session>:<window>'`) so the user can inspect the same process.
- Keep the window until its result has been inspected and recorded. Then close only that window;
  do not kill unrelated windows or a shared session.

## Inspecting a run

Artifact contract per run: `run.json`, `metrics.json`, `network.flax`, plots. Old split-file
formats aren't supported by current readers.

```bash
RUN=data/benchmarks/<timestamp>_<name>_<commit>
```

`metrics.json` gets one row per logging window, atomically rewritten on each interval and after
every validation — safe to read mid-run. Validation columns are `null` on non-validation windows.

```bash
# full run record / metrics history
uv run python -m json.tool "$RUN/run.json"
uv run python -m json.tool "$RUN/metrics.json"

# config / KPIs only, via the app's own projections
uv run python -c 'import json, sys; from pathlib import Path; from src.lib.run_artifacts import load_config; print(json.dumps(load_config(Path(sys.argv[1])), indent=2))' "$RUN"
uv run python -c 'import json, sys; from pathlib import Path; from src.lib.run_artifacts import load_kpis; print(json.dumps(load_kpis(Path(sys.argv[1])), indent=2))' "$RUN"

# replay the Rich training table
uv run python -m src.engine.network --show "$RUN"

# fused objective from stored KPIs, no rerun
uv run python -c 'import sys; from pathlib import Path; from src.lib.run_artifacts import load_kpis; k = load_kpis(Path(sys.argv[1])); print(k["loss_median"] + 0.3 * k["loss_p95"])' "$RUN"
```

## Benchmark procedure

1. State the comparison and success metric before launching. Change only the tested variables;
   keep evaluator, seeds, budgets, and static config fixed.
2. Run the cheapest smoke test / self-check first.
3. New search space or protocol → new study/run name. Never resume a database after changing its
   distributions, objective, model config, budget, or evaluator.
4. Launch via uv inside tmux. Optuna CLI: pass `--reset-sqlite` or `--resume-sqlite` explicitly
   when a database exists. Programmatic drivers: `restart=True` for clean, `restart=False` for
   compatible resume.
5. Preserve provenance: git commit, config, seed, objective, evaluator protocol, budget, source
   run. Warmstart only from observations matching all of these and fitting current distributions.
6. Verify completed artifacts and compare declared metrics before concluding. Never mix
   legacy/incompatible results into a ranking.

Experiment-specific parameters, phases, and acceptance rules belong in a `scripts/` driver and
its `docs/` protocol doc — not in this file.

## Optuna conventions

- `SearchSpaceConfig`: model/training params — scalar = pinned, list = discrete choices,
  `Range` = continuous axis.
- `StudyConfig`: orchestration only — trial count, pruning, ranking, persistence, optional
  foundation-model config. Don't pass its fields into `HyperParams`.
- Warmstart trials inform the sampler, don't consume the local trial budget.
- Patience-stopped trials are completed/rankable; exceptions are failures.
- `checkpoint_policy`: `none` keeps nothing, `top_k` saves every completed trial and ranks the
  requested top set, `all` saves every trial during training.
- Pruned/failed/aborted trials must discard their incomplete run directory.
- Study artifacts live at `data/hpo/<timestamp>_<study_name>_<commit>/`.

## Documenting each run

For each run, write `<name>-hpo-<idx>.md`:

```markdown
# <Name> HPO Run <idx>

## Goal
2-3 concise sentences.

## Reasoning
- bullet points explaining why this config was chosen

## Config
\```json
{ }
\```

## Results

## Conclusion
```

You may adjust the future plan in `hpo-plan-<name>.md` based on what a run shows. Document this
in that run's Conclusion section (e.g. "observed X in run-i, therefore future runs will Y").
Never edit an already-executed run's markdown.
