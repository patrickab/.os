/**
 * Integration tests of the side-effect modules (`run.ts`, `git.ts`, `merge.ts`) against throwaway git repos in a temp
 * dir. Every git call names its repo with `-C`, the user's global git config is left out.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROTECTED, protectedPaths, type FactoryConfig } from "./config.ts";
import { abortLeftoverRebase, LOCKFILES, taskBase, taskDiff, taskGit } from "./git.ts";
import { MERGE_ATTEMPTS, mergeTask, rebaseWorktree, type MergeInput, type MergeOutcome } from "./merge.ts";
import { joinQueue, leaveQueue, queueAhead } from "./queue.ts";
import { runRound, type PipelineSteps } from "./pipeline.ts";
import { CommandRunner, type Exec } from "./run.ts";
import type { MergeData, Settings, Snapshot, Task } from "./state.ts";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "factory-merge-test-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const runner = new CommandRunner();
const settings: Settings = { branch: "main", merge: "auto", maxRounds: 3, review: false, models: {} };
const noGates: FactoryConfig = { hooks: { after_create: [], after_code: [], after_merge: [] }, gates: [], merge_gates: [], protected: DEFAULT_PROTECTED, lockfiles: LOCKFILES };
/** `noGates` whose round and merge gates are both `gates`, as a `factory.yaml` without `merge_gates` reads. */
const gated = (gates: string[][], rest: Partial<FactoryConfig> = {}): FactoryConfig => ({ ...noGates, gates, merge_gates: gates, ...rest });

/** The `factory-merge` data of a merge that merged or failed; throws for a conflict or a failed gate. */
function mergeData(outcome: MergeOutcome): MergeData {
  if (outcome.result.kind !== "merged" && outcome.result.kind !== "failed") throw new Error(`the merge ended ${outcome.result.kind}, no merge data`);
  return outcome.result.merge;
}

function gitIn(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

let repo: string;
let counter = 0;

/** A fresh repo on `main` with one commit holding `README.md` and `factory.yaml`. */
beforeEach(() => {
  counter += 1;
  repo = join(scratch, `repo-${counter}`);
  mkdirSync(repo);
  gitIn(repo, "init", "--quiet", "--initial-branch", "main");
  gitIn(repo, "config", "user.name", "Factory Test");
  gitIn(repo, "config", "user.email", "factory@test.invalid");
  writeFileSync(join(repo, "README.md"), "readme\n");
  writeFileSync(join(repo, "factory.yaml"), "gates: []\n");
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "--quiet", "-m", "base");
});

/** A linked worktree of `repo` on a new branch, as a task gets one. */
function addWorktree(branch: string): string {
  const path = join(scratch, `wt-${counter}-${branch}`);
  gitIn(repo, "worktree", "add", "--quiet", "-b", branch, path);
  return path;
}

async function taskIn(root: string, title = "Task title"): Promise<Task> {
  return { title, request: "do it", settings, ...(await taskGit(runner.run, root, "main")) };
}

function input(root: string, task: Task, config: FactoryConfig, round = 1): MergeInput {
  return { exec: runner.run, cleanup: runner.cleanup, root, round, task, config, intent: () => undefined };
}

describe("CommandRunner", () => {
  test("reports exit code, stdout and the combined output", async () => {
    const result = await runner.run(["sh", "-c", "echo out; echo err >&2; exit 3"], { cwd: scratch, maxStdoutChars: 100 });
    expect(result).toMatchObject({ exitCode: 3, killed: false, timedOut: false, stdout: "out\n", stdoutTruncated: false });
    expect(result.output).toContain("err");
  });

  test("a command that cannot start has no exit code", async () => {
    const result = await runner.run(["factory-no-such-command"], { cwd: scratch });
    expect(result.exitCode).toBeNull();
    expect(result.output).toContain("factory-no-such-command");
  });

  test("cancel kills the whole process group and never reports exit 0", async () => {
    const own = new CommandRunner();
    const pidFile = join(scratch, `grandchild-${counter}.pid`);
    const running = own.run(["sh", "-c", `sleep 60 & echo $! > ${pidFile}; wait`], { cwd: scratch });
    while (!existsSync(pidFile) || readFileSync(pidFile, "utf8").trim() === "") await Bun.sleep(20);
    const grandchild = Number(readFileSync(pidFile, "utf8"));
    own.cancel();
    const result = await running;
    expect(result).toMatchObject({ exitCode: null, killed: true });
    await Bun.sleep(100);
    expect(() => process.kill(grandchild, 0)).toThrow();
    expect(await own.run(["true"], { cwd: scratch })).toMatchObject({ exitCode: null, killed: true });
    own.reset();
    expect(await own.run(["true"], { cwd: scratch })).toMatchObject({ exitCode: 0, killed: false });
  });

  test("keeps the end of the output and only the asked start of stdout, whatever the command prints", async () => {
    const chatty = ["sh", "-c", "head -c 3000000 /dev/zero | tr '\\0' x; echo; echo end"];
    const unkept = await runner.run(chatty, { cwd: scratch });
    expect(unkept.stdout).toBe("");
    expect(unkept.output.length).toBe(64_000);
    expect(unkept.output.endsWith("x\nend\n")).toBe(true);
    const kept = await runner.run(chatty, { cwd: scratch, maxStdoutChars: 1000 });
    expect(kept).toMatchObject({ exitCode: 0, stdout: "x".repeat(1000), stdoutTruncated: true });
  });

  test("a multi-byte character split over two chunks stays whole", async () => {
    const result = await runner.run(["sh", "-c", "printf '\\303'; sleep 0.2; printf '\\244\\n'"], { cwd: scratch, maxStdoutChars: 10 });
    expect(result.stdout).toBe("ä\n");
  });

  test("a command that leaves a daemon holding its pipes ends when the command exits", async () => {
    const result = await runner.run(["sh", "-c", "setsid sleep 30 & echo $!"], { cwd: scratch, maxStdoutChars: 100 });
    process.kill(Number(result.stdout), "SIGKILL");
    expect(result).toMatchObject({ exitCode: 0, killed: false });
    expect(result.durationMs).toBeLessThan(5000);
  });

  test("a group member that ignores SIGTERM does not outlive a cancelled command", async () => {
    const own = new CommandRunner();
    const pidFile = join(scratch, `stubborn-${counter}.pid`);
    const running = own.run(["sh", "-c", `(trap "" TERM; echo $$ > /dev/null; sleep 60) & echo $! > ${pidFile}; wait`], { cwd: scratch });
    while (!existsSync(pidFile) || readFileSync(pidFile, "utf8").trim() === "") await Bun.sleep(20);
    await Bun.sleep(100);
    own.cancel();
    expect(await running).toMatchObject({ exitCode: null, killed: true });
    await Bun.sleep(100);
    expect(() => process.kill(Number(readFileSync(pidFile, "utf8")), 0)).toThrow();
  });

  test("cleanup runs after a cancel and is not killed by one", async () => {
    const own = new CommandRunner();
    own.cancel();
    const cleanup = own.cleanup(["sh", "-c", "sleep 0.2; echo cleaned"], { cwd: scratch, maxStdoutChars: 100 });
    own.cancel();
    expect(await cleanup).toMatchObject({ exitCode: 0, killed: false, stdout: "cleaned\n" });
  });

  test("a timeout kills the command and marks it", async () => {
    const result = await runner.run(["sleep", "60"], { cwd: scratch, timeoutMs: 100 });
    expect(result).toMatchObject({ exitCode: null, killed: true, timedOut: true });
  });
});

describe("taskGit and taskDiff", () => {
  test("a task is a linked worktree on its own branch, and the branch it merges into must exist", async () => {
    gitIn(repo, "branch", "release");
    const worktree = addWorktree("task-a");
    expect(await taskGit(runner.run, worktree, "release")).toEqual({ branch: "task-a", mainBranch: "release", baseSha: gitIn(repo, "rev-parse", "HEAD") });
    await expect(taskGit(runner.run, worktree, "nowhere")).rejects.toThrow("the branch nowhere does not exist");
    await expect(taskGit(runner.run, worktree, "task-a")).rejects.toThrow("a task works on a branch of its own");
  });

  test("refuses the main checkout and a directory that is not the root of a checkout", async () => {
    await expect(taskGit(runner.run, repo, "main")).rejects.toThrow("is the repository's main checkout");
    mkdirSync(join(repo, "sub"));
    await expect(taskGit(runner.run, join(repo, "sub"), "main")).rejects.toThrow("is not the root of its git checkout");
    await expect(taskGit(runner.run, scratch, "main")).rejects.toThrow("git rev-parse");
  });

  test("the diff holds tracked changes and untracked files, and leaves the index alone", async () => {
    const worktree = addWorktree("task-d");
    const task = await taskIn(worktree);
    writeFileSync(join(worktree, "README.md"), "readme changed\n");
    writeFileSync(join(worktree, "new.txt"), "brand new\n");
    const diff = await taskDiff(runner.run, worktree, await taskBase(runner.run, worktree, task));
    expect(diff.base).toBe(task.baseSha);
    expect(diff.paths.sort()).toEqual(["README.md", "new.txt"]);
    expect(diff.patch).toContain("+readme changed");
    expect(diff.patch).toContain("+brand new");
    expect(gitIn(worktree, "status", "--porcelain")).toBe("M README.md\n?? new.txt");
  });

  test("the patch puts source before lockfiles", async () => {
    const worktree = addWorktree("task-l");
    const task = await taskIn(worktree);
    mkdirSync(join(worktree, "zz"));
    writeFileSync(join(worktree, "zz", "source.ts"), "export const answer = 42;\n");
    writeFileSync(join(worktree, "bun.lock"), "lock body\n");
    mkdirSync(join(worktree, "app"));
    writeFileSync(join(worktree, "app", "package-lock.json"), "{}\n");
    const diff = await taskDiff(runner.run, worktree, task.baseSha);
    expect(diff.paths).toEqual(["app/package-lock.json", "bun.lock", "zz/source.ts"]);
    const at = (text: string) => diff.patch.indexOf(text);
    expect(at("b/zz/source.ts")).toBeGreaterThanOrEqual(0);
    expect(at("b/zz/source.ts")).toBeLessThan(at("b/app/package-lock.json"));
    expect(at("b/app/package-lock.json")).toBeLessThan(at("b/bun.lock"));
    expect(diff.patch.endsWith("+lock body\n")).toBe(true);
  });

  test("the patch puts the given lockfile names last, and only those", async () => {
    const worktree = addWorktree("task-lc");
    const task = await taskIn(worktree);
    writeFileSync(join(worktree, "Cargo.lock"), "cargo body\n");
    writeFileSync(join(worktree, "bun.lock"), "bun body\n");
    writeFileSync(join(worktree, "zz.rs"), "fn main() {}\n");
    const diff = await taskDiff(runner.run, worktree, task.baseSha, ["Cargo.lock"]);
    const at = (text: string) => diff.patch.indexOf(text);
    expect(at("b/bun.lock")).toBeGreaterThanOrEqual(0);
    expect(at("b/bun.lock")).toBeLessThan(at("b/zz.rs"));
    expect(at("b/zz.rs")).toBeLessThan(at("b/Cargo.lock"));
    expect(diff.patch.endsWith("+cargo body\n")).toBe(true);
    const none = await taskDiff(runner.run, worktree, task.baseSha, []);
    expect(none.patch).toContain("+cargo body");
    expect(none.patch.indexOf("b/Cargo.lock")).toBeLessThan(none.patch.indexOf("b/zz.rs"));
  });

  test("the diff base follows a rebase onto the moved target branch", async () => {
    const worktree = addWorktree("task-b");
    const task = await taskIn(worktree);
    writeFileSync(join(repo, "other.txt"), "someone else\n");
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "--quiet", "-m", "other task");
    writeFileSync(join(worktree, "mine.txt"), "mine\n");
    expect(await taskBase(runner.run, worktree, task)).toBe(task.baseSha);
    gitIn(worktree, "rebase", "--quiet", "--autostash", "main");
    const diff = await taskDiff(runner.run, worktree, await taskBase(runner.run, worktree, task));
    expect(diff.paths).toEqual(["mine.txt"]);
  });
});

describe("mergeTask", () => {
  test("commits with the title, rebases onto main, runs the gates again and fast-forwards the primary", async () => {
    const worktree = addWorktree("task-c");
    const task = await taskIn(worktree, "Add feature");
    writeFileSync(join(repo, "other.txt"), "someone else\n");
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "--quiet", "-m", "other task");
    writeFileSync(join(worktree, "feature.txt"), "feature\n");
    const config = gated([["test", "-f", "other.txt"], ["test", "-f", "feature.txt"]], { hooks: { after_create: [], after_code: [], after_merge: [["touch", "synced"]] } });

    const outcome = await mergeTask(input(worktree, task, config, 2));

    expect(mergeData(outcome)).toEqual({ ok: true, commit: gitIn(repo, "rev-parse", "HEAD"), error: null, depsSynced: false });
    expect(outcome.gates.map((gate) => [gate.round, gate.phase, gate.argv.join(" "), gate.exitCode])).toEqual([
      [2, "merge_gates", "test -f other.txt", 0],
      [2, "merge_gates", "test -f feature.txt", 0],
    ]);
    expect(gitIn(repo, "log", "--format=%s")).toBe("Add feature\nother task\nbase");
    expect(readFileSync(join(repo, "feature.txt"), "utf8")).toBe("feature\n");
    expect(existsSync(join(repo, ".git", "factory-merge.lock"))).toBe(true);
    expect(existsSync(join(repo, "synced"))).toBe(false);
  });

  test("a merge that changes a lockfile runs after_merge in the primary checkout", async () => {
    const worktree = addWorktree("task-d");
    const task = await taskIn(worktree);
    mkdirSync(join(worktree, "pi-host"));
    writeFileSync(join(worktree, "pi-host", "bun.lock"), "lock\n");
    const config: FactoryConfig = { ...noGates, hooks: { after_create: [], after_code: [], after_merge: [["touch", "synced"]] } };

    const outcome = await mergeTask(input(worktree, task, config, 1));

    expect(mergeData(outcome)).toMatchObject({ ok: true, depsSynced: true, error: null });
    expect(outcome.gates).toMatchObject([{ round: 1, phase: "after_merge", argv: ["touch", "synced"], exitCode: 0 }]);
    expect(existsSync(join(repo, "synced"))).toBe(true);
    expect(existsSync(join(worktree, "synced"))).toBe(false);
  });

  test("a merge that changes a lockfile named in config.lockfiles runs after_merge", async () => {
    const worktree = addWorktree("task-lk");
    const task = await taskIn(worktree);
    writeFileSync(join(worktree, "Cargo.lock"), "lock\n");
    const config: FactoryConfig = { ...noGates, lockfiles: ["Cargo.lock"], hooks: { after_create: [], after_code: [], after_merge: [["touch", "synced-cargo"]] } };

    const outcome = await mergeTask(input(worktree, task, config, 1));

    expect(mergeData(outcome)).toMatchObject({ ok: true, depsSynced: true, error: null });
    expect(existsSync(join(repo, "synced-cargo"))).toBe(true);
  });

  test("a default lockfile no longer runs after_merge once config.lockfiles leaves it out", async () => {
    const worktree = addWorktree("task-ln");
    const task = await taskIn(worktree);
    writeFileSync(join(worktree, "bun.lock"), "lock again\n");
    const config: FactoryConfig = { ...noGates, lockfiles: ["Cargo.lock"], hooks: { after_create: [], after_code: [], after_merge: [["touch", "synced-bun"]] } };

    const outcome = await mergeTask(input(worktree, task, config, 1));

    expect(mergeData(outcome)).toMatchObject({ ok: true, depsSynced: false, error: null });
    expect(outcome.gates).toEqual([]);
    expect(existsSync(join(repo, "synced-bun"))).toBe(false);
  });

  test("a failing after_merge hook leaves the merge done and reports the hook", async () => {
    const worktree = addWorktree("task-e");
    const task = await taskIn(worktree);
    writeFileSync(join(worktree, "uv.lock"), "lock\n");
    const config: FactoryConfig = { ...noGates, hooks: { after_create: [], after_code: [], after_merge: [["sh", "-c", "echo no network >&2; exit 1"]] } };

    const outcome = await mergeTask(input(worktree, task, config, 1));

    expect(mergeData(outcome)).toMatchObject({ ok: true, depsSynced: false, commit: gitIn(repo, "rev-parse", "HEAD") });
    expect(mergeData(outcome).error).toContain("after_merge failed: sh -c echo no network >&2; exit 1: no network");
    expect(outcome.gates).toMatchObject([{ phase: "after_merge", exitCode: 1, outputTail: "no network\n" }]);
  });

  test("rebases again and merges when the main branch moved during the merge gates", async () => {
    const worktree = addWorktree("task-f2");
    const task = await taskIn(worktree);
    gitIn(repo, "commit", "--quiet", "--allow-empty", "-m", "earlier");
    writeFileSync(join(worktree, "feature.txt"), "feature\n");
    // The merge gate plays a second task that merges while this one's first gates run, once.
    const marker = join(worktree, "..", "raced-once");
    const race = `test -e ${marker} || { touch ${marker}; git -C ${repo} commit --quiet --allow-empty -m raced; }`;
    const config = gated([["sh", "-c", race]]);

    const outcome = await mergeTask(input(worktree, task, config, 1));

    expect(mergeData(outcome)).toMatchObject({ ok: true, commit: gitIn(repo, "rev-parse", "main") });
    expect(outcome.gates.map((gate) => gate.phase)).toEqual(["merge_gates", "merge_gates"]);
    expect(gitIn(repo, "log", "--format=%s")).toBe(`${task.title}\nraced\nearlier\nbase`);
  });

  test("refuses when the main branch keeps moving through every merge attempt: no fast-forward, main untouched", async () => {
    const worktree = addWorktree("task-f");
    const task = await taskIn(worktree);
    gitIn(repo, "commit", "--quiet", "--allow-empty", "-m", "earlier");
    writeFileSync(join(worktree, "feature.txt"), "feature\n");
    // The merge gate plays a second task that merges while this one's gates run, every time.
    const config = gated([["git", "-C", repo, "commit", "--quiet", "--allow-empty", "-m", "raced"]]);

    const outcome = await mergeTask(input(worktree, task, config, 1));

    expect(mergeData(outcome)).toMatchObject({ ok: false, commit: null, depsSynced: false });
    expect(mergeData(outcome).error).toContain("update of main refused: main moved past the task's base");
    expect(outcome.gates).toHaveLength(MERGE_ATTEMPTS);
    expect(gitIn(repo, "log", "--format=%s")).toBe(`${"raced\n".repeat(MERGE_ATTEMPTS)}earlier\nbase`);
    expect(existsSync(join(repo, "feature.txt"))).toBe(false);
  });

  test("a rebase conflict is aborted and reported with its files, a failing merge gate stops before the merge", async () => {
    const worktree = addWorktree("task-g");
    const task = await taskIn(worktree);
    writeFileSync(join(repo, "README.md"), "main version\n");
    gitIn(repo, "commit", "--quiet", "-am", "main edit");
    writeFileSync(join(worktree, "README.md"), "task version\n");

    const conflict = await mergeTask(input(worktree, task, noGates));
    expect(conflict.result).toEqual({ kind: "conflict", files: ["README.md"] });
    expect(gitIn(worktree, "status", "--porcelain")).toBe("");
    expect(gitIn(worktree, "symbolic-ref", "--short", "HEAD")).toBe("task-g");
    expect(readFileSync(join(worktree, "README.md"), "utf8")).toBe("task version\n");

    const other = addWorktree("task-h");
    gitIn(repo, "commit", "--quiet", "--allow-empty", "-m", "moved");
    writeFileSync(join(other, "feature.txt"), "feature\n");
    const gateFailed = await mergeTask(input(other, await taskIn(other), gated([["false"]])));
    expect(gateFailed.gates).toHaveLength(1);
    expect(gateFailed.result).toMatchObject({ kind: "gate_failed", gate: { argv: ["false"], result: { exitCode: 1 } } });
    // The rebase stays: the coder fixes the change on top of main.
    expect(gitIn(other, "merge-base", "--is-ancestor", "main", "HEAD")).toBe("");
    expect(gitIn(repo, "log", "--format=%s")).toBe("moved\nmain edit\nbase");
  });

  test("a target checked out nowhere is moved by compare-and-swap: no working tree touched, after_merge skipped", async () => {
    const worktree = addWorktree("task-i");
    const task = await taskIn(worktree);
    gitIn(repo, "commit", "--quiet", "--allow-empty", "-m", "main moved");
    gitIn(repo, "switch", "--quiet", "-c", "elsewhere");
    writeFileSync(join(worktree, "uv.lock"), "lock\n");
    const config: FactoryConfig = { ...noGates, hooks: { after_create: [], after_code: [], after_merge: [["touch", "hook-ran"]] } };

    const outcome = await mergeTask(input(worktree, task, config));

    expect(mergeData(outcome)).toMatchObject({ ok: true, error: null, depsSynced: false });
    expect(gitIn(repo, "rev-parse", "main")).toBe(gitIn(worktree, "rev-parse", "HEAD"));
    expect(gitIn(repo, "log", "--format=%s", "main")).toBe("Task title\nmain moved\nbase");
    expect(gitIn(repo, "symbolic-ref", "--short", "HEAD")).toBe("elsewhere");
    expect(existsSync(join(repo, "uv.lock"))).toBe(false);
    expect(existsSync(join(repo, "hook-ran"))).toBe(false);
    expect(outcome.gates).toEqual([]);
  });

  test("a target checked out in another worktree is fast-forwarded there: its files updated, after_merge skipped", async () => {
    const worktree = addWorktree("task-o");
    const task = await taskIn(worktree);
    gitIn(repo, "switch", "--quiet", "-c", "elsewhere");
    const other = join(scratch, `wt-${counter}-main`);
    gitIn(repo, "worktree", "add", "--quiet", other, "main");
    writeFileSync(join(worktree, "feature.txt"), "feature\n");
    writeFileSync(join(worktree, "uv.lock"), "lock\n");
    const config: FactoryConfig = { ...noGates, hooks: { after_create: [], after_code: [], after_merge: [["touch", "hook-ran"]] } };

    const outcome = await mergeTask(input(worktree, task, config));

    expect(mergeData(outcome)).toMatchObject({ ok: true, commit: gitIn(worktree, "rev-parse", "HEAD"), error: null, depsSynced: false });
    expect(gitIn(other, "log", "--format=%s")).toBe("Task title\nbase");
    expect(readFileSync(join(other, "feature.txt"), "utf8")).toBe("feature\n");
    expect(gitIn(other, "status", "--porcelain")).toBe("");
    expect(existsSync(join(other, "hook-ran"))).toBe(false);
    expect(existsSync(join(repo, "feature.txt"))).toBe(false);
    expect(outcome.gates).toEqual([]);
  });

  test("a worktree holding the target whose uncommitted change the merge would overwrite refuses it: nothing moved", async () => {
    const worktree = addWorktree("task-q");
    const task = await taskIn(worktree);
    gitIn(repo, "switch", "--quiet", "-c", "elsewhere");
    const other = join(scratch, `wt-${counter}-main`);
    gitIn(repo, "worktree", "add", "--quiet", other, "main");
    writeFileSync(join(worktree, "README.md"), "task version\n");
    writeFileSync(join(other, "README.md"), "user work in the other worktree\n");

    const outcome = await mergeTask(input(worktree, task, noGates));

    expect(mergeData(outcome)).toMatchObject({ ok: false, commit: null });
    expect(mergeData(outcome).error).toContain("update of main refused");
    expect(mergeData(outcome).error).toContain("README.md");
    expect(readFileSync(join(other, "README.md"), "utf8")).toBe("user work in the other worktree\n");
    expect(gitIn(repo, "log", "--format=%s", "main")).toBe("base");
  });

  test("two tasks on the same target checked out in another worktree merge one after the other, the second on top", async () => {
    const first = addWorktree("task-r");
    const second = addWorktree("task-s");
    const firstTask = await taskIn(first, "First");
    const secondTask = await taskIn(second, "Second");
    gitIn(repo, "switch", "--quiet", "-c", "elsewhere");
    const other = join(scratch, `wt-${counter}-main`);
    gitIn(repo, "worktree", "add", "--quiet", other, "main");
    writeFileSync(join(first, "first.txt"), "first\n");
    writeFileSync(join(second, "second.txt"), "second\n");

    const one = await mergeTask(input(first, firstTask, noGates));
    const two = await mergeTask(input(second, secondTask, noGates));

    expect(mergeData(one).ok).toBe(true);
    expect(mergeData(two)).toMatchObject({ ok: true, commit: gitIn(other, "rev-parse", "HEAD") });
    expect(gitIn(other, "log", "--format=%s")).toBe("Second\nFirst\nbase");
    expect(readFileSync(join(other, "first.txt"), "utf8")).toBe("first\n");
    expect(readFileSync(join(other, "second.txt"), "utf8")).toBe("second\n");
    expect(gitIn(other, "status", "--porcelain")).toBe("");
  });
});

describe("mergeTask: what a merge must not get wrong", () => {
  test("skips the merge gates when the rebase did not move HEAD", async () => {
    const worktree = addWorktree("task-k");
    const task = await taskIn(worktree);
    writeFileSync(join(worktree, "feature.txt"), "feature\n");
    const outcome = await mergeTask(input(worktree, task, gated([["false"]])));
    expect(outcome).toMatchObject({ gates: [], result: { kind: "merged", merge: { ok: true, commit: gitIn(repo, "rev-parse", "HEAD") } } });
    expect(gitIn(repo, "log", "--format=%s")).toBe("Task title\nbase");
  });

  test("a cancel during the rebase still aborts it, and a retry merges from the task branch", async () => {
    const worktree = addWorktree("task-l");
    const task = await taskIn(worktree);
    writeFileSync(join(repo, "README.md"), "main version\n");
    gitIn(repo, "commit", "--quiet", "-am", "main edit");
    writeFileSync(join(worktree, "README.md"), "task version\n");
    // The rebase stops on the conflict, and the cancel arrives before the pipeline can clean up.
    const own = new CommandRunner();
    const exec: Exec = async (argv, options) => {
      const result = await own.run(argv, options);
      if (argv[1] === "rebase") own.cancel();
      return result;
    };

    const cancelled = await mergeTask({ ...input(worktree, task, noGates), exec, cleanup: own.cleanup });

    // Nothing merged: the rebase conflicted (or was killed), no matter how the result reports it.
    expect(cancelled.result.kind).not.toBe("merged");
    expect(existsSync(gitIn(worktree, "rev-parse", "--path-format=absolute", "--git-path", "rebase-merge"))).toBe(false);
    expect(gitIn(worktree, "symbolic-ref", "--short", "HEAD")).toBe("task-l");

    // Retry: the coder moves its work onto main and resolves the conflict by hand.
    gitIn(worktree, "reset", "--quiet", "--soft", "main");
    writeFileSync(join(worktree, "README.md"), "main and task version\n");
    writeFileSync(join(worktree, "feature.txt"), "feature\n");
    const retried = await mergeTask(input(worktree, task, noGates));
    expect(mergeData(retried)).toMatchObject({ ok: true, commit: gitIn(repo, "rev-parse", "HEAD") });
    expect(readFileSync(join(repo, "feature.txt"), "utf8")).toBe("feature\n");
  });

  test("abortLeftoverRebase puts a worktree a killed process left mid-rebase back on its branch", async () => {
    const worktree = addWorktree("task-m");
    writeFileSync(join(repo, "README.md"), "main version\n");
    gitIn(repo, "commit", "--quiet", "-am", "main edit");
    writeFileSync(join(worktree, "README.md"), "task version\n");
    gitIn(worktree, "commit", "--quiet", "-am", "task edit");
    const tip = gitIn(worktree, "rev-parse", "HEAD");
    expect(() => gitIn(worktree, "rebase", "--quiet", "main")).toThrow();
    await abortLeftoverRebase(runner.cleanup, worktree);
    expect(gitIn(worktree, "symbolic-ref", "--short", "HEAD")).toBe("task-m");
    expect(gitIn(worktree, "rev-parse", "HEAD")).toBe(tip);
  });

  test("a rebase in progress at merge start fails the merge and keeps the coder's resolution and edits", async () => {
    const worktree = addWorktree("task-r");
    const task = await taskIn(worktree);
    writeFileSync(join(repo, "README.md"), "main version\n");
    gitIn(repo, "commit", "--quiet", "-am", "main edit");
    writeFileSync(join(worktree, "README.md"), "task version\n");
    gitIn(worktree, "commit", "--quiet", "-am", "task edit");
    expect(() => gitIn(worktree, "rebase", "--quiet", "main")).toThrow();
    // The coder resolved the conflict and edited another file, but did not continue the rebase.
    writeFileSync(join(worktree, "README.md"), "resolved\n");
    writeFileSync(join(worktree, "factory.yaml"), "gates: [[true]]\n");

    const outcome = await mergeTask(input(worktree, task, noGates));

    expect(mergeData(outcome).error).toBe("a git operation is in progress in the task checkout (rebase-merge)");
    expect(readFileSync(join(worktree, "README.md"), "utf8")).toBe("resolved\n");
    expect(readFileSync(join(worktree, "factory.yaml"), "utf8")).toBe("gates: [[true]]\n");
    expect(gitIn(repo, "log", "--format=%s", "main")).toBe("main edit\nbase");
  });

  test("a cancel reaches the wait for a merge lock someone else holds: nothing is merged, also once the lock frees", async () => {
    const worktree = addWorktree("task-w");
    const task = await taskIn(worktree);
    writeFileSync(join(worktree, "feature.txt"), "feature\n");
    const lock = join(repo, ".git", "factory-merge.lock");
    const holder = Bun.spawn(["flock", lock, "sleep", "30"]);
    await Bun.sleep(200);
    const own = new CommandRunner();
    const intents: unknown[] = [];
    setTimeout(() => own.cancel(), 1500);
    const started = Date.now();
    const outcome = await mergeTask({ ...input(worktree, task, noGates), exec: own.run, cleanup: own.cleanup, intent: (data) => intents.push(data) });
    holder.kill();
    await holder.exited;
    expect(Date.now() - started).toBeLessThan(4000);
    expect(mergeData(outcome)).toMatchObject({ ok: false, error: "cancelled while waiting for the merge lock" });
    expect(intents).toEqual([{ commit: gitIn(worktree, "rev-parse", "HEAD"), before: task.baseSha, message: { title: task.title, body: "" } }]);
    await Bun.sleep(300);
    expect(gitIn(repo, "rev-parse", "main")).toBe(task.baseSha);
  });

  test("untracked nested repositories are left out of the diff and the commit", async () => {
    const worktree = addWorktree("task-n");
    const task = await taskIn(worktree);
    mkdirSync(join(worktree, "empty"));
    gitIn(join(worktree, "empty"), "init", "--quiet");
    mkdirSync(join(worktree, "sub"));
    gitIn(join(worktree, "sub"), "init", "--quiet");
    writeFileSync(join(worktree, "sub", "x"), "x\n");
    gitIn(join(worktree, "sub"), "add", "x");
    gitIn(join(worktree, "sub"), "-c", "user.name=a", "-c", "user.email=a@b.invalid", "commit", "--quiet", "-m", "x");
    writeFileSync(join(worktree, "feature.txt"), "feature\n");
    expect((await taskDiff(runner.run, worktree, task.baseSha)).paths).toEqual(["feature.txt"]);
    const outcome = await mergeTask(input(worktree, task, noGates));
    expect(mergeData(outcome).ok).toBe(true);
    expect(gitIn(repo, "show", "--format=", "--name-only", "main")).toBe("feature.txt");
  });

  test("the primary switched to another branch during the merge gates: main is moved by ref, the primary's tree untouched", async () => {
    const worktree = addWorktree("task-n");
    const task = await taskIn(worktree);
    gitIn(repo, "commit", "--quiet", "--allow-empty", "-m", "moved");
    const main = gitIn(repo, "rev-parse", "main");
    writeFileSync(join(worktree, "feature.txt"), "feature\n");
    const config = gated([["git", "-C", repo, "switch", "--quiet", "-c", "wip"]]);

    const outcome = await mergeTask(input(worktree, task, config));

    expect(mergeData(outcome)).toMatchObject({ ok: true, commit: gitIn(worktree, "rev-parse", "HEAD"), depsSynced: false });
    expect(gitIn(repo, "rev-parse", "main^")).toBe(main);
    expect(gitIn(repo, "rev-parse", "wip")).toBe(main);
    expect(existsSync(join(repo, "feature.txt"))).toBe(false);
  });

  test("a primary checkout whose uncommitted work the merge would overwrite refuses the fast-forward", async () => {
    const worktree = addWorktree("task-p");
    const task = await taskIn(worktree);
    writeFileSync(join(worktree, "README.md"), "task version\n");
    writeFileSync(join(repo, "README.md"), "user work in the primary\n");
    const outcome = await mergeTask(input(worktree, task, noGates));
    expect(mergeData(outcome).ok).toBe(false);
    expect(mergeData(outcome).error).toContain("update of main refused");
    expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("user work in the primary\n");
    expect(gitIn(repo, "log", "--format=%s")).toBe("base");
  });

  test("a worktree that left the task branch is not merged and not reported as merged", async () => {
    const worktree = addWorktree("task-o");
    const task = await taskIn(worktree);
    gitIn(worktree, "switch", "--quiet", "-c", "fix-x");
    writeFileSync(join(worktree, "feature.txt"), "feature\n");
    const onOther = await mergeTask(input(worktree, task, noGates));
    expect(mergeData(onOther)).toMatchObject({ ok: false, commit: null, error: "the task checkout is on fix-x, not on task-o" });
    gitIn(worktree, "switch", "--quiet", "--detach");
    const detached = await mergeTask(input(worktree, task, noGates));
    expect(mergeData(detached).error).toBe("the task checkout is on a detached HEAD, not on task-o");
    expect(gitIn(worktree, "status", "--porcelain")).toBe("?? feature.txt");
    expect(gitIn(repo, "log", "--format=%s")).toBe("base");
  });
});

test("a round whose diff touches a protected path is refused before any merge", async () => {
  const worktree = addWorktree("task-j");
  const task = await taskIn(worktree);
  writeFileSync(join(worktree, "feature.txt"), "feature\n");
  writeFileSync(join(worktree, "factory.yaml"), "gates: [[true]]\n");
  const snapshot: Snapshot = { task, state: "running", round: 1, runFirstRound: 1, reason: "start", mergeIntent: null, mergeError: null, mergedCommit: null, commitMessage: null };
  let merges = 0;
  const steps: PipelineSteps = {
    status: () => undefined,
    cancelled: () => false,
    pendingMessages: () => false,
    config: () => noGates,
    runCommand: (argv) => runner.run(argv, { cwd: worktree }),
    diff: async () => taskDiff(runner.run, worktree, await taskBase(runner.run, worktree, task)),
    review: async () => {
      throw new Error("review is off");
    },
    merge: (config) => {
      merges += 1;
      return mergeTask(input(worktree, task, config));
    },
    openRebase: async () => null,
  };

  const result = await runRound(snapshot, steps);

  expect(result.continue).toBe(true);
  expect(result.entries[0]).toMatchObject({ customType: "factory-round", data: { round: 2, trigger: "protected" } });
  expect((result.entries[1] as { content: string }).content).toContain("- factory.yaml");
  expect(merges).toBe(0);
  expect(gitIn(repo, "log", "--format=%s")).toBe("base");
  expect(protectedPaths(["factory.yaml"], noGates.protected)).toEqual(["factory.yaml"]);
});

describe("merge queue", () => {
  test("tickets are served in the order they joined, a ticket whose process ended is dropped", async () => {
    const gitDir = mkdtempSync(join(scratch, "queue-"));
    const first = await joinQueue(gitDir);
    await Bun.sleep(2);
    const second = await joinQueue(gitDir);
    writeFileSync(join(gitDir, "factory-merge-queue", "000000000000001-999999999-1-crashed"), "");

    expect(await queueAhead(first)).toBe(0);
    expect(await queueAhead(second)).toBe(1);
    expect(readdirSync(join(gitDir, "factory-merge-queue"))).not.toContain("000000000000001-999999999-1-crashed");

    await leaveQueue(first);
    expect(await queueAhead(second)).toBe(0);
  });

  test("a second merge waits its turn, then rebases onto the first and runs its gates on top of it", async () => {
    const one = addWorktree("queue-one");
    const two = addWorktree("queue-two");
    const [taskOne, taskTwo] = [await taskIn(one, "one"), await taskIn(two, "two")];
    writeFileSync(join(one, "one.txt"), "one\n");
    writeFileSync(join(two, "two.txt"), "two\n");
    const statuses: string[] = [];

    // Merge gates apart from the round's run even on an unchanged base: the first holds its turn for 2 s.
    const first = mergeTask(input(one, taskOne, { ...noGates, merge_gates: [["sleep", "2"]] }));
    await Bun.sleep(500);
    // Its gate proves the order: it only passes on top of the first merge.
    const second = mergeTask({ ...input(two, taskTwo, gated([["test", "-f", "one.txt"]])), status: (text) => statuses.push(text) });

    expect(mergeData(await first)).toMatchObject({ ok: true });
    expect(mergeData(await second)).toMatchObject({ ok: true });
    expect(statuses).toContain("queued for merge, 1 ahead");
    expect(gitIn(repo, "log", "--format=%s")).toBe("two\none\nbase");
    expect(readdirSync(join(repo, ".git", "factory-merge-queue"))).toEqual([]);
  }, 20_000);

  test("a queued merge that conflicts with the merge ahead of it leaves the queue for the coder", async () => {
    const one = addWorktree("queue-c1");
    const two = addWorktree("queue-c2");
    const [taskOne, taskTwo] = [await taskIn(one, "one"), await taskIn(two, "two")];
    writeFileSync(join(one, "README.md"), "one's version\n");
    writeFileSync(join(two, "README.md"), "two's version\n");

    // Merge gates apart from the round's run even on an unchanged base: the first holds its turn for 2 s.
    const first = mergeTask(input(one, taskOne, { ...noGates, merge_gates: [["sleep", "2"]] }));
    await Bun.sleep(500);
    const second = mergeTask(input(two, taskTwo, gated([["true"]])));

    expect(mergeData(await first)).toMatchObject({ ok: true });
    const outcome = await second;
    expect(outcome.result).toEqual({ kind: "conflict", files: ["README.md"] });
    expect(outcome.gates).toEqual([]);
    expect(gitIn(repo, "log", "--format=%s")).toBe("one\nbase");
    expect(readdirSync(join(repo, ".git", "factory-merge-queue"))).toEqual([]);
  });
});
