/**
 * Starts a factory task without an interactive session.
 *
 * - Consumes the primary checkout of a repo, a title, a request and settings overrides
 * - Provides `launchTask`: resolves the settings and the target branch (it must hold a committed `factory.yaml`),
 *   creates the task's worktree on a new branch
 *   (`agent-worktree` when it is on PATH, else `git worktree add`), runs the repo's `hooks.after_create` in it, writes
 *   the `TaskRecord` and starts the detached runner with `/factory start <json>`. A failing or aborted step undoes the
 *   earlier ones, through git only
 * - Provides `sendCommand`: one more message to a task's session, through a new detached runner that takes over the
 *   task lock its caller holds
 * - Provides `defaultBranch` and `startCommand` (the payload `parseStartPayload` accepts)
 * - Provides `liveRunners`/`stopRunners` (a task's runner processes, found with `pgrep -f`), `unmergedWork` and
 *   `deleteTask` (worktree, branch, record and log, removed through git: the task's own branch, never another)
 */
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseFactoryYaml } from "./config.ts";
import { git, primaryCheckout } from "./git.ts";
import { CommandRunner, runCommand, type Exec } from "./run.ts";
import { factoryHome, loadSettings, resolveSettings, type StoredSettings } from "./settings.ts";
import type { Settings, StartPayload } from "./state.ts";
import { handTaskLock, lockTask, removeTask, taskLockPath, taskLogPath, tasksDir, writeTask, type TaskRecord } from "./tasks.ts";
import { outputTail } from "./util.ts";

const RUNNER_PATH = join(import.meta.dir, "runner.ts");
const SLUG_MAX_CHARS = 40;
const HOOK_TIMEOUT_MS = 10 * 60_000;
/** How long `stopRunners` waits for a runner to end after SIGTERM, then after SIGKILL. */
const STOP_WAIT_MS = 10_000;

/** `Bun.which` reads the PATH the process started with unless it is given the current one. */
function onPath(binary: string): string | null {
  return Bun.which(binary, { PATH: process.env.PATH ?? "" });
}

async function localBranchExists(repo: string, branch: string): Promise<boolean> {
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
export function startCommand(title: string, request: string, settings: Settings): string {
  const payload: StartPayload = { request, title, settings };
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

/** Best effort, through git only: removes the worktree at `path` and deletes `branch`, the task's own branch. */
async function removeWorktree(repo: string, path: string | undefined, branch: string): Promise<void> {
  if (path !== undefined && existsSync(path)) await runCommand(["git", "worktree", "remove", "--force", path], { cwd: repo });
  await runCommand(["git", "worktree", "prune"], { cwd: repo });
  if (await localBranchExists(repo, branch)) await runCommand(["git", "branch", "-D", branch], { cwd: repo });
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
    const path = resolve(repo, "..", "worktrees", basename(repo), name);
    await git(exec, repo, ["worktree", "add", "-b", name, path, base]);
    return path;
  } catch (error) {
    await removeWorktree(repo, await worktreeOfBranch(repo, name), name).catch(() => undefined);
    throw error;
  }
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

export interface LaunchInput {
  /** A path in the repository; the task records its primary checkout. */
  repo: string;
  title: string;
  request: string;
  overrides?: StoredSettings;
  /** `false`: create the worktree and the record, start no runner (a host that holds the task's session itself). */
  spawn?: boolean;
  /** Aborting it before the runner is started kills the running hook and undoes the launch. */
  signal?: AbortSignal;
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
  const settings = resolveSettings(stored, overrides, explicit ?? (await defaultBranch(repo)));
  if (!(await localBranchExists(repo, settings.branch))) throw new Error(`${repo}: branch ${settings.branch} does not exist locally`);
  const config = await runCommand(["git", "cat-file", "-e", `refs/heads/${settings.branch}:factory.yaml`], { cwd: repo });
  if (config.exitCode !== 0) throw new Error(`${repo}: branch ${settings.branch} has no factory.yaml (write one with /factory init and commit it)`);

  const id = crypto.randomUUID();
  const name = `${slug(input.title)}-${id.slice(0, 8)}`;
  const commands = new CommandRunner();
  const abort = () => commands.cancel();
  const aborted = () => input.signal?.aborted === true;
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (aborted()) throw new Error("the start was aborted");
    const worktree = await createWorktree(commands.run, repo, name, settings.branch).catch((error: unknown) => {
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
        branch: name,
        title: input.title,
        sessionId: crypto.randomUUID(),
        sessionDir: join(factoryHome(), "sessions", repoDirName(repo)),
        createdAt: new Date().toISOString(),
      };
      await writeTask(record);
      recorded = true;
      if (input.spawn !== false) {
        await lockTask(id);
        await sendCommand(record, startCommand(input.title, input.request, settings));
      }
      return record;
    } catch (error) {
      if (recorded) await removeTask(id).catch(() => undefined);
      await removeWorktree(repo, worktree, name).catch(() => undefined);
      throw aborted() ? new Error("the start was aborted") : error;
    }
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}

/**
 * Starts `bun runner.ts` for `message` in its own process group, detached, output appended to the task's log. The
 * caller holds the task lock (`lockTask`): it passes to the runner, which removes it when it exits.
 */
export async function sendCommand(record: TaskRecord, message: string): Promise<void> {
  const bun = onPath("bun");
  if (bun === null) throw new Error("bun is not on PATH: the task runner needs it");
  await mkdir(tasksDir(), { recursive: true });
  await mkdir(record.sessionDir, { recursive: true });
  const log = openSync(taskLogPath(record.id), "a");
  let pid: number | undefined;
  try {
    const child = spawn(bun, [RUNNER_PATH, record.worktree, record.sessionDir, record.sessionId, message], {
      cwd: dirname(RUNNER_PATH),
      detached: true,
      env: { ...process.env, FACTORY_TASK_LOCK: taskLockPath(record.id) },
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
 * branch has. A worktree whose status cannot be read counts as dirty.
 */
export async function unmergedWork(record: TaskRecord, target: string | undefined): Promise<UnmergedWork> {
  let commits = 0;
  if (await localBranchExists(record.repo, record.branch)) {
    const range =
      target !== undefined && (await localBranchExists(record.repo, target))
        ? [`refs/heads/${target}..refs/heads/${record.branch}`]
        : [`refs/heads/${record.branch}`, "--not", `--exclude=refs/heads/${record.branch}`, "--branches"];
    commits = Number(await git(runCommand, record.repo, ["rev-list", "--count", ...range]));
  }
  let dirty = false;
  if (existsSync(record.worktree)) {
    const status = await runCommand(["git", "status", "--porcelain"], { cwd: record.worktree, maxStdoutChars: 1000 });
    dirty = status.exitCode !== 0 || status.stdout.trim() !== "";
  }
  return { commits, dirty };
}

/** Removes the task's worktree, its own branch (through git), its record, its runner log and its lock. The session file stays. */
export async function deleteTask(record: TaskRecord): Promise<void> {
  await removeWorktree(record.repo, record.worktree, record.branch);
  if (existsSync(record.worktree)) throw new Error(`${record.worktree}: the worktree could not be removed`);
  if (await localBranchExists(record.repo, record.branch)) throw new Error(`${record.repo}: the branch ${record.branch} could not be deleted`);
  await removeTask(record.id);
}

/** Pi's directory name of a path (`/a/b` -> `--a-b--`): one sessions folder per repository, as pi-host names it. */
function repoDirName(repo: string): string {
  return `--${resolve(repo).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}
