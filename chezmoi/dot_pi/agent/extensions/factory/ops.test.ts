/**
 * The task operations of `ops.ts` over a fake `OpsDeps`: each expected failure is `{ ok: false }`, each operation has
 * one success. Commands that need git run real git in throwaway repos in a temp dir.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTaskFiles } from "./config.ts";
import {
  approveTask,
  cancelTask,
  initConfig,
  newTaskSession,
  pipelineSteps,
  record,
  resumeTask,
  retryTask,
  startTask,
  type CoderMessage,
  type OpsDeps,
} from "./ops.ts";
import { CommandRunner } from "./run.ts";
import { RETRY_PROMPT, type Settings, type State, type Task } from "./state.ts";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "factory-ops-test-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function gitIn(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const settings: Settings = { branch: "main", merge: "auto", maxRounds: 3, review: false, models: {} };
const payload = (overrides: Partial<Settings> = {}) => JSON.stringify({ request: "Add task.txt", title: "Add task file", settings: { ...settings, ...overrides } });

let counter = 0;
let dir: string;
let repo: string;

/** `dir`: a plain directory. `repo`: a fresh repo on `main` with a `factory.yaml`. */
beforeEach(() => {
  counter += 1;
  dir = join(scratch, `dir-${counter}`);
  mkdirSync(dir);
  repo = join(scratch, `repo-${counter}`);
  mkdirSync(repo);
  gitIn(repo, "init", "--quiet", "--initial-branch", "main");
  gitIn(repo, "config", "user.name", "Factory Test");
  gitIn(repo, "config", "user.email", "factory@test.invalid");
  writeFileSync(join(repo, "factory.yaml"), "gates: []\n");
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "--quiet", "-m", "base");
});

function addTaskWorktree(): string {
  const worktree = join(scratch, `wt-${counter}`);
  gitIn(repo, "worktree", "add", "--quiet", "-b", "task", worktree, "main");
  return worktree;
}

/** An `OpsDeps` in `cwd` that records what Pi would get. */
function fake(cwd: string) {
  const entries: { customType: string; data: any }[] = [];
  const userMessages: string[] = [];
  const coderMessages: { message: CoderMessage; triggerTurn: boolean }[] = [];
  const flags = { idle: true, aborts: 0, modelAvailable: true };
  const deps: OpsDeps = {
    session: newTaskSession(),
    cwd,
    appendEntry: (customType, data) => entries.push({ customType, data }),
    sendUserMessage: (text) => userMessages.push(text),
    sendMessage: (message, { triggerTurn }) => coderMessages.push({ message, triggerTurn }),
    setStatus: () => undefined,
    isIdle: () => flags.idle,
    abort: () => {
      flags.aborts += 1;
    },
    setModel: async () => flags.modelAvailable,
    hasPendingMessages: () => false,
    followUps: () => [],
    sessionModel: () => null,
    sessionId: () => "ops-test",
  };
  const states = () => entries.filter((entry) => entry.customType === "factory-state").map((entry) => `${entry.data.state}/${entry.data.reason}`);
  /** Puts a task in `state` into the session, as its entries would. */
  const holdTask = (state: State) => {
    const task: Task = { title: "t", request: "r", settings, branch: "task", mainBranch: "main", baseSha: "0".repeat(40), protocol: 2 };
    record(deps, "factory-task", task);
    record(deps, "factory-state", { state, round: 1, reason: "test" });
  };
  return { deps, entries, userMessages, coderMessages, flags, states, holdTask };
}

describe("pipelineSteps.askCommitMessage", () => {
  test("a conventional task title is the message, until the task merged: a follow-up asks for its own; the merge clears the last one", async () => {
    const pi = fake(dir);
    pi.holdTask("running");
    const task = { ...pi.deps.session.snapshot!.task, title: "feat: add t" };
    const files = { config: {}, prompts: {} } as never;
    expect(pipelineSteps(pi.deps, task, files, false).askCommitMessage!()).toBe(false);
    record(pi.deps, "factory-commit-message", { title: "feat: t", body: "- t" });
    record(pi.deps, "factory-merge", { ok: true, commit: "a".repeat(40), error: null, depsSynced: false });
    expect(pi.deps.session.snapshot!.commitMessage).toBeNull();
    expect(pipelineSteps(pi.deps, task, files, false).askCommitMessage!()).toBe(true);
  });
});

describe("startTask", () => {
  test("expected failures are results and write nothing", async () => {
    const held = fake(dir);
    held.holdTask("running");
    expect(await startTask(held.deps, payload())).toEqual({ ok: false, error: "this session already holds a task" });
    const busy = fake(dir);
    busy.flags.idle = false;
    expect(await startTask(busy.deps, payload())).toEqual({ ok: false, error: "the session is busy" });
    const invalid = fake(dir);
    expect(await startTask(invalid.deps, "{not json")).toEqual({ ok: false, error: "payload is not JSON" });
    const outside = await startTask(fake(dir).deps, payload());
    expect(outside.ok).toBe(false);
    const primary = await startTask(fake(repo).deps, payload());
    expect(primary).toMatchObject({ ok: false, error: expect.stringContaining("is the repository's main checkout") });
    const noModel = fake(addTaskWorktree());
    noModel.flags.modelAvailable = false;
    expect(await startTask(noModel.deps, payload({ models: { coder: "nobody/nothing" } }))).toEqual({ ok: false, error: "model nobody/nothing is not available" });
    expect([...busy.entries, ...invalid.entries, ...noModel.entries, ...noModel.userMessages]).toEqual([]);
    expect(noModel.deps.session.starting).toBe(false);
  });

  test("records the task and prompts the coder", async () => {
    const pi = fake(addTaskWorktree());
    expect(await startTask(pi.deps, payload())).toEqual({ ok: true });
    expect(pi.entries.map((entry) => entry.customType)).toEqual(["factory-task", "factory-round", "factory-state"]);
    expect(pi.userMessages).toEqual(["Add task.txt"]);
    expect(pi.deps.session.snapshot?.state).toBe("running");
  });
});

describe("approveTask", () => {
  test("expected failures", async () => {
    expect(await approveTask(fake(dir).deps)).toEqual({ ok: false, error: "this session holds no task" });
    const running = fake(dir);
    running.holdTask("running");
    expect(await approveTask(running.deps)).toEqual({ ok: false, error: "the task is not waiting for approve" });
    const busy = fake(dir);
    busy.holdTask("waiting_approve");
    busy.flags.idle = false;
    expect(await approveTask(busy.deps)).toEqual({ ok: false, error: "the session is busy" });
    expect(busy.states()).toEqual(["waiting_approve/test"]);
  });

  test("answers at once with merging, the merge then ends the task", async () => {
    const pi = fake(dir);
    pi.holdTask("waiting_approve");
    expect(await approveTask(pi.deps)).toEqual({ ok: true });
    expect(pi.states()).toEqual(["waiting_approve/test", "merging/approved"]);
    // Not a repo: the merge cannot read its rules and ends blocked.
    while (pi.states().length < 3) await Bun.sleep(10);
    expect(pi.states()[2]).toStartWith("blocked/pipeline_error: ");
  });
});

describe("approveTask before any await", () => {
  test("merging is recorded before the call returns: a runner can never see the task still waiting once Pi answers", async () => {
    const pi = fake(dir);
    pi.holdTask("waiting_approve");
    const answer = approveTask(pi.deps);
    expect(pi.states()).toEqual(["waiting_approve/test", "merging/approved"]);
    expect(pi.deps.session.snapshot?.state).toBe("merging");
    expect(await answer).toEqual({ ok: true });
    while (pi.states().length < 3) await Bun.sleep(10);
  });
});

describe("factory.yaml lockfiles", () => {
  /** A task worktree whose repo's factory.yaml names `Cargo.lock` as its only lockfile. */
  function cargoTask() {
    writeFileSync(join(repo, "factory.yaml"), 'lockfiles: ["Cargo.lock"]\n');
    gitIn(repo, "commit", "--quiet", "-am", "cargo lockfile");
    const worktree = addTaskWorktree();
    const pi = fake(worktree);
    pi.holdTask("running");
    return { worktree, pi };
  }

  test("the review's patch puts the configured lockfiles last", async () => {
    const { worktree, pi } = cargoTask();
    writeFileSync(join(worktree, "Cargo.lock"), "lock\n");
    writeFileSync(join(worktree, "a.txt"), "source\n");
    const files = await loadTaskFiles(new CommandRunner().run, worktree, gitIn(worktree, "rev-parse", "HEAD"));
    const { patch } = await pipelineSteps(pi.deps, pi.deps.session.snapshot!.task, files, false).diff();
    expect(patch.indexOf("b/a.txt")).toBeGreaterThan(-1);
    expect(patch.indexOf("b/Cargo.lock")).toBeGreaterThan(patch.indexOf("b/a.txt"));
  });

  test("a merge that landed while the session was down: a changed configured lockfile means after_merge did not run", async () => {
    const { worktree, pi } = cargoTask();
    writeFileSync(join(worktree, "Cargo.lock"), "lock\n");
    gitIn(worktree, "add", "-A");
    gitIn(worktree, "commit", "--quiet", "-m", "lock");
    const before = gitIn(repo, "rev-parse", "main");
    const commit = gitIn(worktree, "rev-parse", "HEAD");
    gitIn(repo, "update-ref", "refs/heads/main", commit, before);
    record(pi.deps, "factory-state", { state: "merging", round: 1, reason: "passed" });
    record(pi.deps, "factory-merge-intent", { commit, before });
    await resumeTask(pi.deps, pi.deps.session.snapshot!);
    expect(pi.entries.find((entry) => entry.customType === "factory-merge")?.data.error).toBe("after_merge did not run: the session ended during the merge");
    expect(pi.states().at(-1)).toBe("done/merged, after_merge failed");
  });
});

describe("retryTask", () => {
  test("expected failures", async () => {
    expect(await retryTask(fake(dir).deps)).toEqual({ ok: false, error: "this session holds no task" });
    const done = fake(dir);
    done.holdTask("done");
    expect(await retryTask(done.deps)).toEqual({ ok: false, error: "retry needs a blocked or cancelled task" });
    const busy = fake(dir);
    busy.holdTask("blocked");
    busy.flags.idle = false;
    expect(await retryTask(busy.deps)).toEqual({ ok: false, error: "the session is busy" });
    const outside = fake(dir);
    outside.holdTask("blocked");
    expect((await retryTask(outside.deps)).ok).toBe(false);
    expect(outside.userMessages).toEqual([]);
  });

  test("opens a retry round and prompts the coder", async () => {
    const pi = fake(addTaskWorktree());
    await startTask(pi.deps, payload());
    record(pi.deps, "factory-state", { state: "blocked", round: 1, reason: "agent_error" });
    expect(await retryTask(pi.deps)).toEqual({ ok: true });
    expect(pi.entries.at(-2)).toEqual({ customType: "factory-round", data: { round: 2, trigger: "retry" } });
    expect(pi.states().at(-1)).toBe("running/retry");
    expect(pi.userMessages.at(-1)).toBe(RETRY_PROMPT);
  });
});

describe("cancelTask", () => {
  test("expected failures", async () => {
    expect(await cancelTask(fake(dir).deps)).toEqual({ ok: false, error: "this session holds no task" });
    for (const state of ["done", "cancelled"] as const) {
      const pi = fake(dir);
      pi.holdTask(state);
      expect(await cancelTask(pi.deps)).toEqual({ ok: false, error: "the task is not active" });
    }
  });

  test("an idle task ends cancelled, a busy one is aborted", async () => {
    const idle = fake(dir);
    idle.holdTask("blocked");
    expect(await cancelTask(idle.deps)).toEqual({ ok: true });
    expect(idle.states().at(-1)).toBe("cancelled/cancelled");
    expect(idle.deps.session.runner.cancelled).toBe(false);
    const busy = fake(dir);
    busy.holdTask("running");
    busy.flags.idle = false;
    expect(await cancelTask(busy.deps)).toEqual({ ok: true });
    expect(busy.flags.aborts).toBe(1);
    expect(busy.states()).toEqual(["running/test"]);
  });
});

describe("initConfig", () => {
  test("expected failures: not a repo, factory.yaml exists already", async () => {
    expect((await initConfig(fake(dir).deps)).ok).toBe(false);
    expect(await initConfig(fake(repo).deps)).toEqual({ ok: false, error: `${join(repo, "factory.yaml")} exists already, init does not overwrite it` });
  });

  test("writes the draft and says where", async () => {
    rmSync(join(repo, "factory.yaml"));
    expect(await initConfig(fake(repo).deps)).toEqual({ ok: true, message: `wrote ${join(repo, "factory.yaml")} (nothing detected, fill the gates in). Review it, then commit it.` });
    expect(readFileSync(join(repo, "factory.yaml"), "utf8")).toContain("gates");
  });
});
