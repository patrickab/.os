/**
 * A follow-up on a merged task against throwaway git repos in a temp dir: the worktree made again, the change merged
 * as a new commit. The coder is the test: it edits the task worktree between the calls. No Pi, no model.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROTECTED, type FactoryConfig } from "./config.ts";
import { LOCKFILES, taskGit } from "./git.ts";
import { restoreWorktree } from "./launch.ts";
import { mergeTask, type MergeInput, type MergeOutcome } from "./merge.ts";
import { CommandRunner } from "./run.ts";
import type { MergeData, Task } from "./state.ts";
import type { TaskRecord } from "./tasks.ts";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "factory-followup-test-")));
process.env.PI_CODING_AGENT_DIR = join(scratch, "agent");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const runner = new CommandRunner();
const noGates: FactoryConfig = { hooks: { after_create: [], after_code: [], after_merge: [] }, gates: [], merge_gates: [], protected: DEFAULT_PROTECTED, lockfiles: LOCKFILES };

function gitIn(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commitFile(dir: string, file: string, content: string, subject: string): string {
  writeFileSync(join(dir, file), content);
  gitIn(dir, "add", file);
  gitIn(dir, "commit", "--quiet", "-m", subject);
  return gitIn(dir, "rev-parse", "HEAD");
}

let counter = 0;
let repo: string;
let worktree: string;
/** The task's merged commit `feat: add a` (a.txt = "one\n"), on main. */
let merged: string;

/** main: base, the task's merged commit, then the `later` commits from the primary. The task worktree is up to date with main. */
function setUp(later: [file: string, content: string, subject: string][]): void {
  counter += 1;
  repo = join(scratch, `repo-${counter}`);
  mkdirSync(repo);
  gitIn(repo, "init", "--quiet", "--initial-branch", "main");
  gitIn(repo, "config", "user.name", "Factory Test");
  gitIn(repo, "config", "user.email", "factory@test.invalid");
  writeFileSync(join(repo, "factory.yaml"), "gates: []\n");
  gitIn(repo, "add", "factory.yaml");
  commitFile(repo, "README.md", "readme\n", "base");
  worktree = join(scratch, `wt-${counter}`);
  gitIn(repo, "worktree", "add", "--quiet", "-b", "task", worktree);
  merged = commitFile(worktree, "a.txt", "one\n", "feat: add a");
  gitIn(repo, "merge", "--quiet", "--ff-only", "task");
  for (const [file, content, subject] of later) commitFile(repo, file, content, subject);
  gitIn(worktree, "rebase", "--quiet", "main");
}

async function taskOf(): Promise<Task> {
  return { title: "Add a", request: "add a", settings: { branch: "main", merge: "auto", maxRounds: 3, review: false, models: {} }, ...(await taskGit(runner.run, worktree, "main")) };
}

function input(task: Task, extra: Partial<MergeInput> = {}): MergeInput {
  return { exec: runner.run, cleanup: runner.cleanup, root: worktree, round: 2, task, config: noGates, intent: () => undefined, ...extra };
}

function mergeData(outcome: MergeOutcome): MergeData {
  if (outcome.result.kind !== "merged") throw new Error(`the merge ended ${outcome.result.kind}: ${JSON.stringify(outcome.result)}`);
  return outcome.result.merge;
}

const subjects = (ref: string) => gitIn(repo, "log", "--format=%s", ref);

describe("follow-up on a merged task", () => {
  test("a done task's worktree that is gone is made again on its branch before a runner starts in it", async () => {
    setUp([["b.txt", "b\n", "L1"]]);
    const sessions = join(scratch, `sessions-${counter}`);
    mkdirSync(sessions);
    const own: TaskRecord = { id: "00000000-0000-0000-0000-000000000006", repo, worktree, branch: "task", title: "Add a", sessionId: "s6", sessionDir: sessions, createdAt: "2026-01-01T00:00:00Z", tag: "t", plan: null, kind: "task" };
    rmSync(worktree, { recursive: true, force: true });
    await restoreWorktree(own);
    expect(gitIn(worktree, "rev-parse", "--abbrev-ref", "HEAD")).toBe("task");
    expect(readFileSync(join(worktree, "a.txt"), "utf8")).toBe("one\n");
  });

  test("the change merges as a new commit with its own message; the merged commit and later ones stay as they are", async () => {
    setUp([["b.txt", "b\n", "L1"]]);
    const before = gitIn(repo, "rev-parse", "main");
    writeFileSync(join(worktree, "a.txt"), "one\nmore\n");
    const message = { title: "fix(a): add more", body: "- more" };
    const merge = mergeData(await mergeTask(input(await taskOf(), { message })));
    expect(merge).toEqual({ ok: true, commit: gitIn(repo, "rev-parse", "main"), error: null, depsSynced: false });
    expect(gitIn(repo, "rev-parse", "main~1")).toBe(before);
    expect(subjects("main")).toBe("fix(a): add more\nL1\nfeat: add a\nbase");
    expect(gitIn(repo, "rev-list", "main")).toContain(merged);
    expect(gitIn(repo, "show", "main:a.txt")).toBe("one\nmore");
  });
});
