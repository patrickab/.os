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
  `tasks.list|get` (a `TaskView`: record fields (`tag`, `plan`, `kind` included), last state with its time, `question`
  (the coder's open question while `waiting_answer`, else null), `running` = a live runner holds it,
  `interrupted`, the task's settings, token and cost usage of coder and reviews, `actions` = the task actions the core
  accepts now), `tasks.timeline` (session entries as `{at, kind, data}`, `since`/`next` = a byte cursor, read from
  `since` on), `tasks.diff` (base, patch, per-file added/removed lines), `tasks.start|approve|retry|cancel|remove|message`,
  `tasks.wait`
- `tasks.list {repo?, tag?}`: `tag` keeps the tasks whose tag is it or starts with `tag + "/"` (`a` holds `a/b`, not
  `ab`)
- `tasks.wait {ids?, tag?, ignore?, timeoutMs?}` (`mutates: false`): exactly one of `ids` (ids or unique prefixes,
  resolved once) and `tag` (as in `tasks.list`, re-listed on every poll, so tasks started later count); `ignore` leaves
  ids out; `timeoutMs` 1000..3600000, default 600000. A task rests when no runner lives and its state is
  `waiting_approve`, `waiting_answer`, `blocked`, `done` or `cancelled`, or it is interrupted; it needs attention when
  it rests and is not `done`. Answers `{tasks, attention: ids, timedOut}` once every watched task rests, one needs
  attention, the timeout passes or no task is watched; an abort fails it. A poll re-reads a session file only when it
  changed and looks for runners only where that decides the answer
- `tasks.import` (`hostOnly`, `{record}`): registers a task record another store kept; an existing id stays. It refuses
  a record unless `repo` is a primary checkout and `worktree` one of its linked worktrees with `branch` checked out
- A `repo` param is a path inside the repository, relative to the caller's `cwd`, which is also its default; without
  `cwd` it must be absolute. `id` accepts a unique prefix. Each action that checks a task's state and acts on it holds a
  per-task lock from the check on (a runner keeps it until it exits)
- `tasks.start` (`title`, `request`, `overrides`, `tag`, `plan`, `kind`, `source`): `tag` is path segments of
  `[A-Za-z0-9._@+-]` joined by `/` (default the system user name), `plan` a memory_store path the factory only stores,
  `kind` `task` (default) or `merge_request` (below; `source` is for it only). It creates the worktree, runs
  `after_create`, spawns the runner and returns. An abort before the runner is spawned kills the hook and removes the
  worktree and branch
- `tasks.approve` (from `waiting_approve`), `tasks.retry` (from `blocked`, `cancelled` or interrupted), `tasks.cancel`
  (stops a live runner first), `tasks.message` (a live runner gets it as a follow-up through the task's inbox, a
  resting or interrupted task a new runner; to a task in `waiting_answer` it is the answer; refused while merging and
  for a merge request). A line that reaches the inbox after the runner
  closed Pi goes to a successor runner. Cancel or retry of an interrupted task fails when its runner ends before it ran
- `tasks.remove`: deletes the record, log, worktree and the task's own branch (through git) of a task that is not
  running (an interrupted task counts as not running) and not in `waiting_answer`. It refuses a task with commits its target branch lacks or
  uncommitted changes; with `force: true` it removes it anyway and names what it dropped. A merge request's source
  branch is never deleted, so its commits count as nothing dropped
- `overrides` and stored settings: `merge` (`auto` | `review`), `maxRounds` (1..20), `review` (bool), `branch`,
  `models.coder`, `models.reviewer` (`provider/model`)
- The `factory` tool for agents: `{action, ...}` with `action` an `ACTIONS` name that is not `hostOnly` and that
  action's params. The answer is the result as JSON text and `details`; errors are error results starting `factory: `.
  Calls run one at a time
- In a task's own session (Pi started by the runner, `FACTORY_TASK_SESSION=1`, or a session holding a `factory-task`
  entry) the tool offers only the actions with `mutates: false`; a mutating one (`tasks.start`, `models.set`, ...)
  answers as unknown. A task's coder starts a task only through `factory_new_task` (below)

## Factory models (`models.ts`)

- One user-level list of `provider/model` ids every task and repository picks from, in `<agent dir>/factory/models.yaml`.
  Actions `models.get` (`{models}`) and `models.set` (`{models}`, deduplicated); `/factory models` lists it,
  `/factory models add <id>`, `remove <id>`, `set <id> ...` change it (in the TUI `add` alone offers Pi's models)
- `tasks.start` and `settings.set` are `refused` for a model not on the list, and for anything while it is empty
  ("no factory models are set (set them with /factory models)"). Reading settings and listing tasks never check it

## Commands (inside a task's own Pi session)

- `/factory init`: write a draft `factory.yaml` into the main checkout (any session), uncommitted
- `/factory start <json>`: `{"request", "title", "settings", "kind"?}`; what the tool's runner and gigachad-bot send
- `/factory approve`, `/factory retry`, `/factory cancel`
- A plain message to a resting task starts a new run; to a task in `waiting_answer` it is the answer (below)

## Questions to the supervisor

- In a task session the coder may call `factory_ask_supervisor {question}` while its task is `running`: it records a
  `factory-question {text}` entry (timeline kind `question`, `TaskView.question`) and the resting state
  `waiting_answer`, and ends the coder's turn. The round's hooks, gates and review do not run; the runner ends. It is
  refused next to another tool call in the same message and while a message is queued for the coder: Pi would carry
  the turn on past either
- The next message (`tasks.message`) is the answer: the coder continues the same round, with no new round, no fresh
  round budget and no squash or rebase of the worktree (the state goes back to `running`, reason `answer`). The
  round's steps run when that turn ends, as for any turn. In `waiting_answer` the actions are `tasks.message` and
  `tasks.cancel`; `tasks.wait` counts the task as needing attention

## Merge requests

- `tasks.start {kind: "merge_request", source, overrides: {branch: <target>}, title, request}` reviews and merges an
  existing branch, the gate between a wave's branch and the branch all waves flow into. `source` must be a local
  branch other than the target, checked out in no worktree; the task's worktree checks it out (`TaskView.branch` is
  `source`). A failed start or `tasks.remove` never deletes it
- No coder turn ever: the branch is rebased onto the target without squashing (its commits survive, the target gets
  every one of them by fast-forward), the `gates` run (not `after_code`), the reviewer reviews the whole diff against
  the target whatever `review` says, with `request` verbatim in its prompt under its own heading as its instructions.
  Approved: the normal merge queue (`merge_gates`, fast-forward), with `merge: review` after `waiting_approve`
- Nothing is ever committed for it: uncommitted changes in its worktree (untracked files included, ignored ones not)
  end it `blocked` `dirty` before the rebase; clean them up or commit them to the source, then retry
- Nothing opens a round: a rejected review ends `blocked` `review_rejected`, a rebase conflict `blocked` `conflict`,
  failed gates or merge gates `blocked` `gates`; findings and gate output stay in the timeline. `tasks.retry` runs it
  again from the rebase. `tasks.message` is refused and not among its actions, and `factory_ask_supervisor` is not
  registered in its session
- A run aborts any rebase in progress in its worktree first: a dead run's, but also a person's half-finished
  resolution of a `conflict`, which a retry discards. Resolve a conflict by rebasing the source branch elsewhere (or
  finish the rebase with `git rebase --continue` before the retry)
- A source branch that holds merge commits (say it merged the target in and resolved a conflict there) loses them in
  the plain rebase, and the conflicts they resolved come back as `blocked` `conflict`: its owner rebases it onto the
  target first
- `factory.yaml` and the reviewer prompt come from the target branch's tip when a run starts (the start and every
  retry), never from the source: a retry is held to the gates the target has gained meanwhile. The `factory-task` entry
  (timeline kind `task`) carries `kind` and `source` (null for a `task`)

## Commit message

- A task title that is a conventional commit title (`type(scope)!: summary`) is the merge commit's message. Else,
  after the last round passed and before the merge, the coder is asked for one: a conventional title of at most 72
  characters, a blank line, `- ` bullets (at most 50 lines, 4096 characters, no control characters). An invalid
  answer falls back to the task title. The message is the `factory-commit-message` entry and goes into the
  `factory-merge-intent` entry, so a later runner's approve uses it

## Follow-up on a merged task

- A message to a task that is `done`/`merged` opens a follow-up run: the coder works in the task's worktree (made
  again from the task branch when it is gone). Once the gates pass, the change merges as a normal new commit through
  the usual merge, with its own commit message (the coder is always asked for it in a follow-up). No history is
  rewritten
- A part of the request outside the task's scope goes to a new task: the coder calls `factory_new_task {title,
  handoff}` (title a conventional commit title, handoff the complete request). The tool exists in task sessions only,
  works only in a follow-up run on a merged task, once per user message; the new task takes over this task's target
  branch and merge mode, and the parent records a `factory-spawn` entry (timeline kind `spawn`)

## How a task runs without an interactive session

- `bun runner.ts <worktree> <sessionDir> <sessionId> <inboxPath> <message>` spawns `pi --mode rpc` in the worktree, sends one
  command and closes Pi's stdin once no agent run is active and the task rests (for `approve`/`retry`: after it
  has left the state it started in). Detached, one runner per command. A prompt Pi did not handle as a command (the
  plugin is not in Pi's extensions dir) makes it abort and exit 1; extension dialogs are answered as cancelled

## Where state lives (`<agent dir>/factory/`, agent dir = `PI_CODING_AGENT_DIR` or `~/.pi/agent`)

- `tasks/<id>.json`: the task record (repo, worktree, branch, title, session id and dir, tag, plan, kind; a record
  without the last three reads as the system user's, no plan, `task`); `tasks/<id>.log`: runner
  output; `tasks/<id>.lock`: `<pid> <start time>` of whoever acts on the task (a dead holder's lock is taken over); `tasks/<id>.inbox`:
  messages for the live runner (`<inbox>.read`: how far it sent them)
- `sessions/<repo dir name>/` (`/a/b` -> `--a-b--`): the Pi session files of a repository's tasks, apart from
  Pi's own sessions (`pi -r` does not list them). The task's truth is its `factory-*` session entries
- `repos/<URI-encoded path>.yaml` (`/a/b` -> `%2Fa%2Fb.yaml`): per-repo settings (`merge`, `maxRounds`, `review`, `branch`, `models`, `preview`); the file registers the repo
- `models.yaml`: the factory models, a YAML list of `provider/model` ids
- Reviews: `<agent dir>/factory-reviews/<session id>/`. Merge lock and queue: in the repo's git common dir

## Entry protocol

- Version 2 (`PROTOCOL_VERSION` in `state.ts`, written into every `factory-task` entry). Entries: `factory-task`,
  `-round`, `-gate`, `-review`, `-merge-intent`, `-merge`, `-state`, `-commit-message`, `-spawn`, `-question`, and
  `factory-feedback` and `factory-commit-ask` messages

## Development

- `bun run types`, `bun test` in this directory. Tests use temp git repos and a fake `pi`; no model is called
