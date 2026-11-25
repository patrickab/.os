/**
 * Starts a factory task without an interactive session.
 *
 * - Consumes the primary checkout of a repo, a title, a request and settings overrides
 * - Provides `launchTask`: resolves the settings and the target branch (it must hold a committed `factory.yaml`),
 *   creates the task's worktree on a new branch
 *   (`agent-worktree` when it is on PATH, else `git worktree add`), runs the repo's `hooks.after_create` in it, writes
 *   the `TaskRecord` and starts the detached runner with `/factory start <json>`. A failing or aborted step undoes the
 *   earlier ones, through git only. A missing target branch or `factory.yaml` throws a `LaunchRefusedError`
 * - A `merge_request` gets a worktree on its existing `source` branch instead (`git worktree add`): a source that is
 *   missing, the target itself or checked out in a worktree is a `LaunchRefusedError`. Its source branch is never
 *   deleted, not by a failed start and not by `deleteTask`
 * - Provides `sendCommand`: one more message to a task's session, through a new detached runner (the caller's `env`;
 *   `runnerSpawn` puts it in a systemd user scope under a service) that takes over the task lock its caller holds;
 *   `messageTask`: a message to the coder in any state but merging (`taskInboxPath` of a live runner, else a new
 *   runner); a state refusal is a `MessageRefusedError`
 * - Provides `defaultBranch`, `localBranchExists` and `startCommand` (the payload `parseStartPayload` accepts)
 * - Provides `liveRunners`/`stopRunners` (a task's runner processes, found with `pgrep -f`), `unmergedWork` and
 *   `deleteTask` (worktree, branch, record, log and inbox, removed through git: the task's own branch, never another)
 */
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { appendFile, mkdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseFactoryYaml } from "./config.ts";
import { git, primaryCheckout } from "./git.ts";
import { inboxReadPath, lastFactoryState, taskMainBranch } from "./runner.ts";
import { CommandRunner, runCommand, type Exec } from "./run.ts";
import { factoryHome, loadSettings, resolveSettings, type StoredSettings } from "./settings.ts";
import type { Settings, StartPayload } from "./state.ts";
import { handTaskLock, lockTask, removeTask, systemUser, TaskBusyError, taskLockPath, taskLogPath, tasksDir, unlockTask, writeTask, type TaskKind, type TaskRecord } from "./tasks.ts";
import { outputTail } from "./util.ts";

// `import.meta.dirname`, not Bun's `import.meta.dir`: inside Pi the latter is not this directory, and a runner would not start.
const RUNNER_PATH = join(import.meta.dirname, "runner.ts");
const SLUG_MAX_CHARS = 40;
const HOOK_TIMEOUT_MS = 10 * 60_000;
/** How long `stopRunners` waits for a runner to end after SIGTERM, then after SIGKILL. */
const STOP_WAIT_MS = 10_000;

/** `Bun.which` reads the PATH the process started with unless it is given the current one. */
function onPath(binary: string): string | null {
  return Bun.which(binary, { PATH: process.env.PATH ?? "" });
}

export async function localBranchExists(repo: string, branch: string): Promise<boolean> {
  const result = await runCommand(["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repo });
  return result.exitCode === 0;
}

/** The branch `origin/HEAD` names, else `main`, else `master`: the first of them that exists locally. */
export async function defaultBranch(repo: string): Promise<string> {
  const originHead = await runCommand(["git", "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd: repo, maxStdoutChars: 1000 });
  const candidates = originHead.exitCode === 0 ? [originHead.stdout.trim().replace(/^origin\//, ""), "main", "master"] : ["main", "master"];
  for (const branch of candidates) {
    if (branch !== "" && (await localBranchExists(repo, branch))) return branch;
  }
  throw new Error(`${repo}: no default branch (origin/HEAD, main and master do not exist locally)`);
}

/** The prompt that starts a task in its session. */
export function startCommand(title: string, request: string, settings: Settings, kind: TaskKind = "task"): string {
  const payload: StartPayload = { request, title, settings, ...(kind === "merge_request" ? { kind } : {}) };
  return `/factory start ${JSON.stringify(payload)}`;
}

function slug(title: string): string {
  const text = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, SLUG_MAX_CHARS).replace(/^-+|-+$/g, "");
  return text === "" ? "task" : text;
}

/** `hooks.after_create` of the worktree's `factory.yaml` (the target branch's), none without the file. */
async function afterCreateHooks(worktree: string): Promise<string[][]> {
  const file = Bun.file(join(worktree, "factory.yaml"));
  if (!(await file.exists())) return [];
  return parseFactoryYaml(await file.text()).hooks.after_create;
}

/** The path of the worktree that has `branch` checked out, if any. */
async function worktreeOfBranch(repo: string, branch: string): Promise<string | undefined> {
  const result = await runCommand(["git", "worktree", "list", "--porcelain"], { cwd: repo, maxStdoutChars: 1_000_000 });
  if (result.exitCode !== 0) return undefined;
  for (const block of result.stdout.split("\n\n")) {
    const lines = block.split("\n");
    if (lines.includes(`branch refs/heads/${branch}`)) return lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
  }
  return undefined;
}

/** Best effort, through git only: removes the worktree at `path` and deletes `branch`, the task's own branch, when given. */
async function removeWorktree(repo: string, path: string | undefined, branch: string | undefined): Promise<void> {
  if (path !== undefined && existsSync(path)) await runCommand(["git", "worktree", "remove", "--force", path], { cwd: repo });
  await runCommand(["git", "worktree", "prune"], { cwd: repo });
  if (branch !== undefined && (await localBranchExists(repo, branch))) await runCommand(["git", "branch", "-D", branch], { cwd: repo });
}

/** The branch a task owns and removing it deletes: a merge request's source branch is not its own. */
function ownBranch(record: Pick<TaskRecord, "branch" | "kind">): string | undefined {
  return record.kind === "merge_request" ? undefined : record.branch;
}

function worktreePath(repo: string, name: string): string {
  return resolve(repo, "..", "worktrees", basename(repo), name);
}

/** The new worktree's path. A failure removes what the attempt left (a worktree on `name`, the branch `name`). */
async function createWorktree(exec: Exec, repo: string, name: string, base: string): Promise<string> {
  try {
    const agentWorktree = onPath("agent-worktree");
    if (agentWorktree !== null) {
      const result = await exec([agentWorktree, "create", name, "--base", base, "--background"], { cwd: repo, maxStdoutChars: 100_000 });
      if (result.exitCode !== 0 || result.killed) throw new Error(`agent-worktree create ${name}: ${outputTail(result.output)}`);
      const path = result.stdout.trim().split("\n").at(-1)?.trim() ?? "";
      if (path === "") throw new Error(`agent-worktree create ${name}: printed no path`);
      return path;
    }
    const path = worktreePath(repo, name);
    await git(exec, repo, ["worktree", "add", "-b", name, path, base]);
    return path;
  } catch (error) {
    await removeWorktree(repo, await worktreeOfBranch(repo, name), name).catch(() => undefined);
    throw error;
  }
}

/**
 * A worktree named `name` on the existing branch `source`, through git: `agent-worktree` only makes new branches. A
 * failure removes the worktree the attempt left, never `source`.
 */
async function checkoutWorktree(exec: Exec, repo: string, name: string, source: string): Promise<string> {
  const path = worktreePath(repo, name);
  try {
    await git(exec, repo, ["worktree", "add", "--quiet", path, source]);
    return path;
  } catch (error) {
    await removeWorktree(repo, path, undefined).catch(() => undefined);
    throw error;
  }
}

/** Refuses a merge request's `source` unless it is a local branch other than `target`, checked out in no worktree. */
async function requireSourceBranch(repo: string, source: string, target: string): Promise<void> {
  if (!(await localBranchExists(repo, source))) throw new LaunchRefusedError(`${repo}: the source branch ${source} does not exist locally`);
  if (source === target) throw new LaunchRefusedError(`${repo}: the source branch ${source} is the target branch itself`);
  const holder = await worktreeOfBranch(repo, source);
  if (holder !== undefined) throw new LaunchRefusedError(`${repo}: the source branch ${source} is checked out in ${holder}, remove that worktree or switch it to another branch first`);
}

async function runAfterCreate(exec: Exec, worktree: string): Promise<void> {
  for (const argv of await afterCreateHooks(worktree)) {
    const result = await exec(argv, { cwd: worktree, timeoutMs: HOOK_TIMEOUT_MS });
    if (result.exitCode !== 0 || result.killed) {
      const why = result.timedOut ? "timed out" : `exit ${result.exitCode}`;
      throw new Error(`hooks.after_create ${argv.join(" ")} (${why}): ${outputTail(result.output)}`);
    }
  }
}

/** A launch the repository's branches forbid: the target branch is missing or has no committed `factory.yaml`. */
export class LaunchRefusedError extends Error {}

/** A message `messageTask` refuses for the task's state (merging, not started). */
export class MessageRefusedError extends Error {}

/** The environment of the runners a caller starts (`process.env` when it gives none). */
export type RunnerEnv = Record<string, string | undefined>;

export interface LaunchInput {
  /** A path in the repository; the task records its primary checkout. */
  repo: string;
  title: string;
  request: string;
  overrides?: StoredSettings;
  /** Default: `systemUser()`. */
  tag?: string;
  plan?: string | null;
  /** Default: `task`. */
  kind?: TaskKind;
  /** The existing branch a `merge_request` reviews and merges; required for that kind, ignored for `task`. */
  source?: string;
  /** Aborting it before the runner is started kills the running hook and undoes the launch. */
  signal?: AbortSignal;
  /** The runner's environment. */
  env?: RunnerEnv;
}

export async function launchTask(input: LaunchInput): Promise<TaskRecord> {
  const repo = await primaryCheckout(runCommand, input.repo).then(
    (checkout) => checkout.primary,
    () => {
      throw new Error(`${input.repo} is not inside a git repository`);
    },
  );
  const stored = await loadSettings(repo);
  const overrides = input.overrides ?? {};
  const explicit = overrides.branch ?? stored.branch;
  const fallback =
    explicit ??
    (await defaultBranch(repo).catch(() => {
      throw new LaunchRefusedError(`${repo} has no default branch (origin/HEAD, main and master do not exist locally)`);
    }));
  const settings = resolveSettings(stored, overrides, fallback);
  if (!(await localBranchExists(repo, settings.branch))) throw new LaunchRefusedError(`${repo}: branch ${settings.branch} does not exist locally`);
  const config = await runCommand(["git", "cat-file", "-e", `refs/heads/${settings.branch}:factory.yaml`], { cwd: repo });
  if (config.exitCode !== 0) {
    throw new LaunchRefusedError(`${repo}: branch ${settings.branch} has no factory.yaml (write one with /factory init or the config.write action, and commit it)`);
  }
  const kind = input.kind ?? "task";
  const source = kind === "merge_request" ? input.source : undefined;
  if (kind === "merge_request") {
    if (source === undefined) throw new Error("a merge request needs a source branch");
    await requireSourceBranch(repo, source, settings.branch);
  }

  const id = crypto.randomUUID();
  const name = `${slug(input.title)}-${id.slice(0, 8)}`;
  const commands = new CommandRunner();
  const abort = () => commands.cancel();
  const aborted = () => input.signal?.aborted === true;
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (aborted()) throw new Error("the start was aborted");
    const made = source === undefined ? createWorktree(commands.run, repo, name, settings.branch) : checkoutWorktree(commands.run, repo, name, source);
    const worktree = await made.catch((error: unknown) => {
      throw aborted() ? new Error("the start was aborted") : error;
    });
    let recorded = false;
    try {
      await runAfterCreate(commands.run, worktree);
      if (aborted()) throw new Error("the start was aborted");
      const record: TaskRecord = {
        id,
        repo,
        worktree,
        branch: source ?? name,
        title: input.title,
        sessionId: crypto.randomUUID(),
        sessionDir: join(factoryHome(), "sessions", repoDirName(repo)),
        createdAt: new Date().toISOString(),
        tag: input.tag ?? systemUser(),
        plan: input.plan ?? null,
        kind,
      };
      await writeTask(record);
      recorded = true;
      await lockTask(id);
      await sendCommand(record, startCommand(input.title, input.request, settings, kind), input.env);
      return record;
    } catch (error) {
      if (recorded) await removeTask(id).catch(() => undefined);
      await removeWorktree(repo, worktree, source === undefined ? name : undefined).catch(() => undefined);
      throw aborted() ? new Error("the start was aborted") : error;
    }
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}

/** What a systemd user scope needs to reach the user manager; copied from the host when `env` lacks it. */
const SYSTEMD_USER_ENV = ["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"];

/**
 * The argv and environment of a runner. Under a systemd service (`INVOCATION_ID` in `hostEnv`) with `systemdRun` on
 * PATH it runs in a user scope of its own, outside the service's control group: a restart of the service leaves it.
 * `systemd-run --scope` execs the command, so the spawned pid is the runner's.
 */
export function runnerSpawn(command: string[], env: RunnerEnv, hostEnv: RunnerEnv, systemdRun: string | null): { argv: string[]; env: RunnerEnv } {
  if (!hostEnv.INVOCATION_ID || systemdRun === null) return { argv: command, env };
  const scopeEnv = { ...env };
  for (const key of SYSTEMD_USER_ENV) if (scopeEnv[key] === undefined && hostEnv[key] !== undefined) scopeEnv[key] = hostEnv[key];
  return { argv: [systemdRun, "--user", "--scope", "--quiet", "--", ...command], env: scopeEnv };
}

/**
 * Starts `bun runner.ts` for `message` in its own process group, detached, output appended to the task's log, with
 * `env` (default `process.env`) plus the lock path. The caller holds the task lock (`lockTask`): it passes to the
 * runner, which removes it when it exits.
 */
export async function sendCommand(record: TaskRecord, message: string, env: RunnerEnv = process.env): Promise<void> {
  const bun = onPath("bun");
  if (bun === null) throw new Error("bun is not on PATH: the task runner needs it");
  await mkdir(tasksDir(), { recursive: true });
  await mkdir(record.sessionDir, { recursive: true });
  const log = openSync(taskLogPath(record.id), "a");
  let pid: number | undefined;
  try {
    const runner = runnerSpawn(
      [bun, RUNNER_PATH, record.worktree, record.sessionDir, record.sessionId, taskInboxPath(record.id), message],
      // A task runs without pauses, so the default short prompt cache is enough and the dearer long cache writes are not.
      { ...env, FACTORY_TASK_LOCK: taskLockPath(record.id), PI_CACHE_RETENTION: "short" },
      process.env,
      onPath("systemd-run"),
    );
    const child = spawn(runner.argv[0], runner.argv.slice(1), {
      cwd: dirname(RUNNER_PATH),
      detached: true,
      env: runner.env,
      stdio: ["ignore", log, log],
    });
    await new Promise<void>((resolveSpawn, reject) => {
      child.once("spawn", () => resolveSpawn());
      child.once("error", reject);
    });
    child.unref();
    pid = child.pid;
  } finally {
    closeSync(log);
  }
  if (pid !== undefined) await handTaskLock(record.id, pid);
}

/** The messages for a task's live runner, one JSON `{"text"}` per line; the runner stores how far it sent them in `<inbox>.read`. */
export function taskInboxPath(id: string): string {
  return join(tasksDir(), `${id}.inbox`);
}

/**
 * A message for the task's coder. A live runner holds the task: one line in its inbox, which it sends to Pi as a
 * follow-up. Resting or interrupted: takes the task lock and starts a runner with `text` as the prompt and `env`, the
 * lock handed to it. Throws a `MessageRefusedError` of one sentence while the task merges or before it has a state, a
 * `TaskBusyError` while another holds its lock.
 */
export async function messageTask(record: TaskRecord, text: string, env?: RunnerEnv): Promise<void> {
  const refuseState = async () => {
    const state = await lastFactoryState(record.sessionDir, record.sessionId);
    if (state === undefined) throw new MessageRefusedError(`task ${record.id.slice(0, 8)} has not started yet, send the message once it runs`);
    if (state.state === "merging") throw new MessageRefusedError(`task ${record.id.slice(0, 8)} is merging, send the message when the merge has ended`);
  };
  const toInbox = async () => {
    await mkdir(tasksDir(), { recursive: true });
    await appendFile(taskInboxPath(record.id), `${JSON.stringify({ text })}\n`, "utf8");
  };
  await refuseState();
  if ((await liveRunners(record)).length > 0) return toInbox();
  await lockTask(record.id);
  try {
    await refuseState();
    if ((await liveRunners(record)).length > 0) throw new TaskBusyError(`task ${record.id.slice(0, 8)} is busy: its last runner is still ending, try again in a few seconds`);
    if ((await lastFactoryState(record.sessionDir, record.sessionId))?.state === "done") await restoreWorktree(record);
    await sendCommand(record, text, env);
  } finally {
    await unlockTask(record.id);
  }
}

/**
 * The worktree of a done task that is gone, made again before a runner starts in it: on the task branch when that
 * still exists, else on a new one off the target branch. `git worktree prune` first drops the stale entry.
 */
export async function restoreWorktree(record: TaskRecord): Promise<void> {
  if (existsSync(record.worktree)) return;
  const target = await taskMainBranch(record.sessionDir, record.sessionId);
  await git(runCommand, record.repo, ["worktree", "prune"]);
  if (await localBranchExists(record.repo, record.branch)) await git(runCommand, record.repo, ["worktree", "add", "--quiet", record.worktree, record.branch]);
  else if (target !== undefined) await git(runCommand, record.repo, ["worktree", "add", "--quiet", "-b", record.branch, record.worktree, `refs/heads/${target}`]);
  else throw new Error(`the worktree ${record.worktree} is gone and the task's target branch is unknown`);
}

/** The pids of the runners of a task still alive, found by their command line (`runner.ts ... <sessionId> ...`). */
export async function liveRunners(record: Pick<TaskRecord, "sessionId">): Promise<number[]> {
  const pattern = `runner\\.ts .*${record.sessionId.replace(/[^A-Za-z0-9._-]/g, ".")}`;
  const result = await runCommand(["pgrep", "-f", pattern], { cwd: "/", maxStdoutChars: 10_000 });
  // Exit 1 is "no match"; anything else (pgrep missing or failing) would hide a live runner.
  if (result.exitCode === 1) return [];
  if (result.exitCode !== 0) throw new Error(`pgrep, which finds a task's runner, failed (exit ${result.exitCode}): ${outputTail(result.output)}`);
  return result.stdout.split("\n").filter((line) => line.trim() !== "").map(Number);
}

function signalRunner(pid: number, signal: NodeJS.Signals): void {
  // A runner leads its own process group, Pi is in it. Every command the plugin starts has a group of its own
  // (`run.ts`), so a Pi killed with SIGKILL leaves those running.
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, signal);
      return;
    } catch {
      // not a group leader, or gone already
    }
  }
}

async function runnersEnded(record: Pick<TaskRecord, "sessionId">, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  while ((await liveRunners(record)).length > 0) {
    if (Date.now() > deadline) return false;
    await Bun.sleep(100);
  }
  return true;
}

/** Ends the task's runners: SIGTERM (the runner closes Pi's stdin), SIGKILL when that is not enough. */
export async function stopRunners(record: Pick<TaskRecord, "sessionId">): Promise<void> {
  const pids = await liveRunners(record);
  if (pids.length === 0) return;
  for (const pid of pids) signalRunner(pid, "SIGTERM");
  if (await runnersEnded(record, STOP_WAIT_MS)) return;
  for (const pid of await liveRunners(record)) signalRunner(pid, "SIGKILL");
  if (!(await runnersEnded(record, STOP_WAIT_MS))) throw new Error(`the runner of task ${record.sessionId} does not end`);
}

/** What removing the task would drop: commits on its branch that `target` lacks, uncommitted changes in its worktree. */
export interface UnmergedWork {
  commits: number;
  dirty: boolean;
}

/**
 * The task's unmerged work. Without a `target` (the task never recorded one) its commits are those no other local
 * branch has. A worktree whose status cannot be read counts as dirty. A merge request's commits stay on its source
 * branch, which removing it keeps: none count.
 */
export async function unmergedWork(record: TaskRecord, target: string | undefined): Promise<UnmergedWork> {
  let commits = 0;
  if (ownBranch(record) !== undefined && (await localBranchExists(record.repo, record.branch))) {
    const range =
      target !== undefined && (await localBranchExists(record.repo, target))
        ? [`refs/heads/${target}..refs/heads/${record.branch}`]
        : // `--exclude` matches what `--branches` lists: names below refs/heads/.
          [`refs/heads/${record.branch}`, "--not", `--exclude=${record.branch}`, "--branches"];
    commits = Number(await git(runCommand, record.repo, ["rev-list", "--count", ...range]));
  }
  let dirty = false;
  if (existsSync(record.worktree)) {
    const status = await runCommand(["git", "status", "--porcelain"], { cwd: record.worktree, maxStdoutChars: 1000 });
    dirty = status.exitCode !== 0 || status.stdout.trim() !== "";
  }
  return { commits, dirty };
}

/**
 * Removes the task's worktree, its own branch (through git; a merge request's source branch stays), its record, its
 * runner log, its lock and its inbox. The session file stays.
 */
export async function deleteTask(record: TaskRecord): Promise<void> {
  const branch = ownBranch(record);
  await removeWorktree(record.repo, record.worktree, branch);
  if (existsSync(record.worktree)) throw new Error(`${record.worktree}: the worktree could not be removed`);
  if (branch !== undefined && (await localBranchExists(record.repo, branch))) throw new Error(`${record.repo}: the branch ${branch} could not be deleted`);
  await removeTask(record.id);
  await rm(taskInboxPath(record.id), { force: true });
  await rm(inboxReadPath(taskInboxPath(record.id)), { force: true });
}

/** Pi's directory name of a path (`/a/b` -> `--a-b--`): one sessions folder per repository, as pi-host names it. */
function repoDirName(repo: string): string {
  return `--${resolve(repo).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}
