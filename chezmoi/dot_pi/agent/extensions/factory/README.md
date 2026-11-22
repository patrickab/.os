# Pi factory plugin

A Pi extension that runs coding tasks for you in the background. Each task gets its own git worktree and branch.
A coder agent works on it in rounds: after every turn the repo's hooks and gates run, then an optional review, and
problems go back to the coder. A passed round merges into the target branch, or waits for approve.

## Requirements

- On PATH: `pi` (loads this directory from its extensions dir), `git`, `bun` (the detached task runner), `pgrep`
  (finds a task's runner; without it task actions fail), `sh`, `awk`, `flock` and `sleep` (the merge lock and
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

## The core (`core.ts`) and the `factory` tool

- `core.ts` is the one module clients import: `ACTIONS` (name -> `{summary, params (JSON schema), mutates, hostOnly}`)
  and `callAction(name, params, {cwd?, signal?, env?})`, plain JSON in and out. A failure throws
  `FactoryError(code, message, detail?)`, one sentence, `code` one of `invalid`, `not_found`, `busy`, `refused`,
  `failed`; `detail` is `{force: true}` on a refused `tasks.remove` that `force` would carry out. It imports only Bun
  and `node:`
- `env` is the environment of every runner the action starts (default `process.env`): a host passes one without its
  secrets. Under a systemd service (`INVOCATION_ID`) with `systemd-run` on PATH a runner runs in a user scope of its
  own, so restarting the service leaves it running
- Actions: `repos.list|add|remove` (a repo's settings file is its registration; `add` -> `{repo, repos}`),
  `branches.list`, `settings.get|set` (`{stored, resolved, defaults}`; `preview` is a stored boolean only clients
  read), `config.get` (working copy, or a branch's committed `factory.yaml`, a draft when there is none),
  `config.write` (a registered repo; checked, not committed; replaces a file only with `overwrite: true`),
  `tasks.list|get` (a `TaskView`: record fields, last state with its time, `running` = a live runner holds it,
  `interrupted`, the task's settings, token and cost usage of coder and reviews, `actions` = the task actions the core
  accepts now), `tasks.timeline` (session entries as `{at, kind, data}`, `since`/`next` = a byte cursor, read from
  `since` on), `tasks.diff` (base, patch, per-file added/removed lines), `tasks.start|approve|retry|cancel|remove|message`
- `tasks.import` (`hostOnly`, `{record}`): registers a task record another store kept; an existing id stays. It refuses
  a record unless `repo` is a primary checkout and `worktree` one of its linked worktrees with `branch` checked out
- A `repo` param is a path inside the repository, relative to the caller's `cwd`, which is also its default; without
  `cwd` it must be absolute. `id` accepts a unique prefix. Each action that checks a task's state and acts on it holds a
  per-task lock from the check on (a runner keeps it until it exits)
- `tasks.start` (`title`, `request`, `overrides`): creates the worktree, runs `after_create`, spawns the runner and
  returns. An abort before the runner is spawned kills the hook and removes the worktree and branch
- `tasks.approve` (from `waiting_approve`), `tasks.retry` (from `blocked`, `cancelled` or interrupted), `tasks.cancel`
  (stops a live runner first), `tasks.message` (a live runner gets it as a follow-up through the task's inbox, a
  resting or interrupted task a new runner; refused while merging). A line that reaches the inbox after the runner
  closed Pi goes to a successor runner. Cancel or retry of an interrupted task fails when its runner ends before it ran
- `tasks.remove`: deletes the record, log, worktree and the task's own branch (through git) of a task that is not
  running (an interrupted task counts as not running). It refuses a task with commits its target branch lacks or
  uncommitted changes; with `force: true` it removes it anyway and names what it dropped
- `overrides` and stored settings: `merge` (`auto` | `review`), `maxRounds` (1..20), `review` (bool), `branch`,
  `models.coder`, `models.reviewer` (`provider/model`)
- The `factory` tool for agents: `{action, ...}` with `action` an `ACTIONS` name that is not `hostOnly` and that
  action's params. The answer is the result as JSON text and `details`; errors are error results starting `factory: `.
  Calls run one at a time

## Commands (inside a task's own Pi session)

- `/factory init`: write a draft `factory.yaml` into the main checkout (any session), uncommitted
- `/factory start <json>`: `{"request", "title", "settings"}`; what the tool's runner and gigachad-bot send
- `/factory approve`, `/factory retry`, `/factory cancel`
- A plain message to a resting task starts a new run

## How a task runs without an interactive session

- `bun runner.ts <worktree> <sessionDir> <sessionId> <inboxPath> <message>` spawns `pi --mode rpc` in the worktree, sends one
  command and closes Pi's stdin once no agent run is active and the task rests (for `approve`/`retry`: after it
  has left the state it started in). Detached, one runner per command. A prompt Pi did not handle as a command (the
  plugin is not in Pi's extensions dir) makes it abort and exit 1; extension dialogs are answered as cancelled

## Where state lives (`<agent dir>/factory/`, agent dir = `PI_CODING_AGENT_DIR` or `~/.pi/agent`)

- `tasks/<id>.json`: the task record (repo, worktree, branch, title, session id and dir); `tasks/<id>.log`: runner
  output; `tasks/<id>.lock`: `<pid> <start time>` of whoever acts on the task (a dead holder's lock is taken over); `tasks/<id>.inbox`:
  messages for the live runner (`<inbox>.read`: how far it sent them)
- `sessions/<repo dir name>/` (`/a/b` -> `--a-b--`): the Pi session files of a repository's tasks, apart from
  Pi's own sessions (`pi -r` does not list them). The task's truth is its `factory-*` session entries
- `repos/<URI-encoded path>.yaml` (`/a/b` -> `%2Fa%2Fb.yaml`): per-repo settings (`merge`, `maxRounds`, `review`, `branch`, `models`, `preview`); the file registers the repo
- Reviews: `<agent dir>/factory-reviews/<session id>/`. Merge lock and queue: in the repo's git common dir

## Entry protocol

- Version 2 (`PROTOCOL_VERSION` in `state.ts`, written into every `factory-task` entry). Entries: `factory-task`,
  `-round`, `-gate`, `-review`, `-merge-intent`, `-merge`, `-state`, and `factory-feedback` messages

## Development

- `bun run types`, `bun test` in this directory. Tests use temp git repos and a fake `pi`; no model is called
