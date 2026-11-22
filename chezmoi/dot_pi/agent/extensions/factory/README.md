# Pi factory plugin

A Pi extension that runs coding tasks for you in the background. Each task gets its own git worktree and branch.
A coder agent works on it in rounds: after every turn the repo's hooks and gates run, then an optional review, and
problems go back to the coder. A passed round merges into the target branch, or waits for approve.

## Requirements

- On PATH: `pi` (loads this directory from its extensions dir), `git`, `bun` (the detached task runner), `pgrep`
  (finds a task's runner; without it the tool refuses to act), `sh`, `awk`, `flock` and `sleep` (the merge lock and
  queue)
- Linux is the supported platform (`flock`, `/proc` for process liveness); macOS is untested
- Optional: `agent-worktree` on PATH. When it is there, task worktrees are made with it, else with `git worktree add`
  into `<repo>/../worktrees/<repo name>/<task>`
- The target branch must hold a committed `factory.yaml` (`/factory init` writes a draft into the main checkout)

## `factory.yaml` (read from the task's base commit, never from the coder's tree)

- `hooks.after_create`: argv lists, run once in a new task worktree
- `hooks.after_code`: run after every coder turn, before the gates
- `hooks.after_merge`: run in the main checkout after a merge that changed a lockfile
- `gates`: fast checks after every coder turn. Exit 0 passes, 75 = broken environment (the task blocks), else fails
- `merge_gates`: run in the merge queue on the rebased branch before the fast-forward. Default: `gates`
- `protected`: globs the coder must not change. Default: `factory.yaml`, `.factory/**`
- `lockfiles`: file names that trigger `after_merge` and go last in the review patch. Default:
  `uv.lock`, `package-lock.json`, `bun.lock`, `bun.lockb`
- Role prompts: `.factory/agents/coder.md`, `.factory/agents/reviewer.md`
- See `factory.template.yaml` for a commented example

## The `factory` tool

- One tool for agents: `{action, repo?, title?, request?, id?, overrides?, force?}`. `repo` defaults to the repository of
  the current directory, `id` accepts a unique prefix. Every answer is one short text plus `details`
  (`{record, state, interrupted}`, for `list` `{tasks: [...]}`). Errors come back as error results, one sentence each.
  Calls run one at a time, and each action holds a per-task lock from its check on (a runner keeps it until it exits)
- `start` (needs `title`, `request`): creates the worktree, runs `after_create`, spawns the runner and returns. An
  abort before the runner is spawned kills the hook and removes the worktree and branch
- `status`, `list`: the task's last state (`running`, `waiting_approve`, `blocked`, `merging`, `done`, `cancelled`);
  `interrupted` when it is `running`/`merging` but its runner is gone (crash, reboot)
- `approve` (from `waiting_approve`), `retry` (from `blocked`, `cancelled` or interrupted), `cancel` (stops a live
  runner first)
- `remove`: deletes the record, log, worktree and the task's own branch (through git) of a task that is not running.
  It refuses a task with commits its target branch lacks or uncommitted changes, naming the commit count; with
  `force: true` it removes it anyway and names what it dropped
- `overrides`: `merge` (`auto` | `review`), `maxRounds` (1..20), `review` (bool), `branch`, `models.coder`,
  `models.reviewer` (`provider/model`)

## Commands (inside a task's own Pi session)

- `/factory init`: write a draft `factory.yaml` into the main checkout (any session), uncommitted
- `/factory start <json>`: `{"request", "title", "settings"}`; what the tool's runner and gigachad-bot send
- `/factory approve`, `/factory retry`, `/factory cancel`
- A plain message to a resting task starts a new run

## How a task runs without an interactive session

- `bun runner.ts <worktree> <sessionDir> <sessionId> <message>` spawns `pi --mode rpc` in the worktree, sends one
  command and closes Pi's stdin once no agent run is active and the task rests (for `approve`/`retry`: after it
  has left the state it started in). Detached, one runner per command. A prompt Pi did not handle as a command (the
  plugin is not in Pi's extensions dir) makes it abort and exit 1; extension dialogs are answered as cancelled

## Where state lives (`<agent dir>/factory/`, agent dir = `PI_CODING_AGENT_DIR` or `~/.pi/agent`)

- `tasks/<id>.json`: the task record (repo, worktree, branch, title, session id and dir); `tasks/<id>.log`: runner
  output; `tasks/<id>.lock`: `<pid> <start time>` of whoever acts on the task (a dead holder's lock is taken over)
- `sessions/<repo dir name>/` (`/a/b` -> `--a-b--`): the Pi session files of a repository's tasks, apart from
  Pi's own sessions (`pi -r` does not list them). The task's truth is its `factory-*` session entries
- `repos/<URI-encoded path>.yaml` (`/a/b` -> `%2Fa%2Fb.yaml`): per-repo settings (`merge`, `maxRounds`, `review`, `branch`, `models`)
- Reviews: `<agent dir>/factory-reviews/<session id>/`. Merge lock and queue: in the repo's git common dir

## Entry protocol

- Version 2 (`PROTOCOL_VERSION` in `state.ts`, written into every `factory-task` entry). Entries: `factory-task`,
  `-round`, `-gate`, `-review`, `-merge-intent`, `-merge`, `-state`, and `factory-feedback` messages

## Development

- `bun run types`, `bun test` in this directory. Tests use temp git repos and a fake `pi`; no model is called
