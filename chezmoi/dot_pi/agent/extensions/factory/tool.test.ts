/**
 * The `factory` tool over real git repos in a temp dir and a fake `pi` on PATH (never a model, never the real
 * `agent-worktree`). The fake answers each `/factory` command with the entries the plugin would write.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { liveRunners, stopRunners } from "./launch.ts";
import { registerFactoryTool, runFactoryAction, type FactoryToolParams, type TaskView } from "./tool.ts";
import { lastFactoryState } from "./runner.ts";
import { listTasks, taskLogPath, writeTask, type TaskRecord } from "./tasks.ts";

const savedEnv = { ...process.env };
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "factory-tool-test-")));
const fakeBin = join(scratch, "bin");
const piLog = join(scratch, "fake-pi.log");

/** The fake `pi`: notes each prompt in `$FAKE_PI_LOG`, appends the `factory-state` entries of the command, ends on stdin EOF. */
mkdirSync(fakeBin);
writeFileSync(
  join(fakeBin, "pi"),
  `#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const dir = args[args.indexOf("--session-dir") + 1];
const id = args[args.indexOf("--session-id") + 1];
mkdirSync(dir, { recursive: true });
const file = join(dir, "2026-01-01T00-00-00-000Z_" + id + ".jsonl");
if (!existsSync(file)) writeFileSync(file, JSON.stringify({ type: "session", version: 3, id, cwd: process.cwd() }) + "\\n");
const state = (name, reason) =>
  appendFileSync(file, JSON.stringify({ type: "custom", customType: "factory-state", data: { state: name, round: 1, reason } }) + "\\n");
const lastState = () => readFileSync(file, "utf8").trim().split("\\n").map((line) => JSON.parse(line)).filter((e) => e.customType === "factory-state").at(-1)?.data.state;
const emit = (record) => process.stdout.write(JSON.stringify(record) + "\\n");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const forever = () => new Promise(() => {});
setInterval(() => {}, 1000);
let gotPrompt;
const prompt = new Promise((done) => (gotPrompt = done));
(async () => {
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffer += new TextDecoder().decode(chunk);
    if (buffer.includes("\\n")) gotPrompt(buffer.split("\\n")[0]);
  }
  process.exit(0);
})();
const message = JSON.parse(await prompt).message;
appendFileSync(process.env.FAKE_PI_LOG, "prompt " + message.split(" ").slice(0, 2).join(" ") + "\\n");
const answer = () => emit({ id: "1", type: "response", command: "prompt", success: true, data: { disposition: "handled" } });
if (message.startsWith("/factory start ")) {
  appendFileSync(file, JSON.stringify({ type: "custom", customType: "factory-task", data: { mainBranch: "main" } }) + "\\n");
  state("running", "start");
  answer();
  emit({ type: "agent_start" });
  if (process.env.FAKE_PI_HOLD === "1") await forever();
  await sleep(50);
  state(process.env.FAKE_PI_START_END ?? "waiting_approve", "passed");
  emit({ type: "agent_settled", aborted: false });
} else if (message === "/factory approve") {
  state("merging", "approved");
  answer();
  await sleep(50);
  state("done", "merged");
  emit({ type: "entry_appended" });
} else if (message === "/factory retry") {
  state("running", "retry");
  answer();
  emit({ type: "agent_start" });
  await sleep(50);
  state("blocked", "gates");
  emit({ type: "agent_settled", aborted: false });
} else if (message === "/factory cancel") {
  if (lastState() === "running") state("blocked", "interrupted");
  state("cancelled", "cancelled");
  answer();
}
await forever();
`,
);
chmodSync(join(fakeBin, "pi"), 0o755);

/** A PATH with the fake `pi` and without any directory that holds `agent-worktree`. */
const testPath = [
  fakeBin,
  ...(savedEnv.PATH ?? "").split(":").filter((dir) => dir !== "" && !existsSync(join(dir, "agent-worktree"))),
].join(":");

let caseDir: string;
let caseCount = 0;

beforeEach(() => {
  caseDir = join(scratch, `case-${++caseCount}`);
  mkdirSync(caseDir);
  Object.assign(process.env, {
    PATH: testPath,
    HOME: scratch,
    PI_CODING_AGENT_DIR: join(caseDir, "agent"),
    FAKE_PI_LOG: piLog,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "test",
    GIT_COMMITTER_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_EMAIL: "test@example.com",
  });
  delete process.env.FAKE_PI_HOLD;
  delete process.env.FAKE_PI_START_END;
  rmSync(piLog, { force: true });
});

afterEach(async () => {
  for (const record of await listTasks()) await stopRunners(record);
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A repo on `main` with one commit, `factory.yaml` in it unless `withConfig` is false. */
function makeRepo(withConfig = true): string {
  const repo = join(caseDir, "repo");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "a\n");
  if (withConfig) writeFileSync(join(repo, "factory.yaml"), "gates: []\n");
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "init");
  return repo;
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(50);
  }
}

const stateOf = async (record: TaskRecord) => (await lastFactoryState(record.sessionDir, record.sessionId))?.state;
const runnerEnded = async (record: TaskRecord) => (await liveRunners(record)).length === 0;
const prompts = () => (existsSync(piLog) ? readFileSync(piLog, "utf8").trim().split("\n") : []);

async function startTask(repo: string, title = "Add b"): Promise<TaskRecord> {
  const answer = await runFactoryAction({ action: "start", title, request: "add b.txt" }, repo);
  return (answer.details as TaskView).record;
}

describe("start", () => {
  test("caller errors: no title, no request, not a repo, no factory.yaml", async () => {
    const repo = makeRepo(false);
    await expect(runFactoryAction({ action: "start", request: "r" }, repo)).rejects.toThrow("start needs a title");
    await expect(runFactoryAction({ action: "start", title: "t", request: " " }, repo)).rejects.toThrow("start needs a request");
    await expect(runFactoryAction({ action: "start", title: "t", request: "r" }, caseDir)).rejects.toThrow(`${caseDir} is not inside a git repository`);
    await expect(runFactoryAction({ action: "start", title: "t", request: "r" }, repo)).rejects.toThrow("branch main has no factory.yaml");
    await expect(runFactoryAction({ action: "start", title: "t", request: "r", overrides: { maxRounds: 21 } }, repo)).rejects.toThrow(
      "overrides.maxRounds must be an integer from 1 to 20",
    );
    expect(await listTasks()).toEqual([]);
  });

  test("returns once the runner is spawned; status, approve, then remove", async () => {
    const repo = makeRepo();
    const started = await runFactoryAction({ action: "start", title: "Add b", request: "add b.txt", repo: "." }, repo);
    const record = (started.details as TaskView).record;
    expect(started.text).toBe(`Started task ${record.id.slice(0, 8)} "Add b" in ${record.worktree}; check it with action "status".`);
    expect(record.repo).toBe(repo);
    expect(git(record.worktree, "rev-parse", "--abbrev-ref", "HEAD")).toBe(record.branch);
    await until(async () => (await stateOf(record)) === "waiting_approve");
    await until(() => runnerEnded(record));

    const status = await runFactoryAction({ action: "status", id: record.id.slice(0, 6) }, caseDir);
    expect(status.text).toBe(`Task ${record.id.slice(0, 8)} "Add b": waiting_approve (round 1, passed).`);
    expect(status.details).toEqual({ record, state: { state: "waiting_approve", round: 1, reason: "passed" }, interrupted: false });
    await expect(runFactoryAction({ action: "retry", id: record.id }, repo)).rejects.toThrow("retry needs blocked, cancelled or interrupted");

    await runFactoryAction({ action: "approve", id: record.id }, repo);
    await until(async () => (await stateOf(record)) === "done");
    await until(() => runnerEnded(record));
    expect(prompts()).toEqual(["prompt /factory start", "prompt /factory approve"]);

    const removed = await runFactoryAction({ action: "remove", id: record.id }, repo);
    expect(removed.text).toBe(`Removed task ${record.id.slice(0, 8)}: its record, log, worktree and branch ${record.branch}.`);
    expect(existsSync(record.worktree)).toBe(false);
    expect(git(repo, "branch", "--list", record.branch)).toBe("");
    expect(existsSync(taskLogPath(record.id))).toBe(false);
    expect(await listTasks()).toEqual([]);
  }, 30_000);
});

describe("retry and cancel", () => {
  test("retry from blocked sends /factory retry, the runner ends with the task blocked again", async () => {
    process.env.FAKE_PI_START_END = "blocked";
    const repo = makeRepo();
    const record = await startTask(repo);
    await until(async () => (await stateOf(record)) === "blocked");
    await until(() => runnerEnded(record));
    await expect(runFactoryAction({ action: "approve", id: record.id }, repo)).rejects.toThrow("approve needs waiting_approve");
    await runFactoryAction({ action: "retry", id: record.id }, repo);
    await until(() => prompts().includes("prompt /factory retry"));
    await until(async () => (await lastFactoryState(record.sessionDir, record.sessionId))?.reason === "gates");
    await until(() => runnerEnded(record));
  }, 30_000);

  test("cancel of a running task stops its runner first; remove refuses while it runs", async () => {
    process.env.FAKE_PI_HOLD = "1";
    const repo = makeRepo();
    const record = await startTask(repo);
    await until(async () => (await stateOf(record)) === "running");
    expect(await liveRunners(record)).toHaveLength(1);
    await expect(runFactoryAction({ action: "remove", id: record.id }, repo)).rejects.toThrow(`task ${record.id.slice(0, 8)} is running, cancel it first`);
    const answer = await runFactoryAction({ action: "cancel", id: record.id }, repo);
    expect(answer.text).toBe(`Cancelling task ${record.id.slice(0, 8)}.`);
    await until(async () => (await stateOf(record)) === "cancelled");
    await until(() => runnerEnded(record));
    await expect(runFactoryAction({ action: "cancel", id: record.id }, repo)).rejects.toThrow("is cancelled already");
  }, 30_000);
});

describe("ids and list", () => {
  const record = (id: string, repo: string): TaskRecord => ({
    id,
    repo,
    worktree: join(caseDir, id),
    branch: id,
    title: `task ${id.slice(0, 8)}`,
    sessionId: `session-${id}`,
    sessionDir: join(caseDir, "sessions"),
    createdAt: `2026-01-01T00:00:0${id.at(-1)}.000Z`,
  });
  const ID_1 = "abc10000-0000-4000-8000-000000000001";
  const ID_2 = "abc20000-0000-4000-8000-000000000002";

  test("an unknown id, an ambiguous prefix and a missing id are errors", async () => {
    await writeTask(record(ID_1, "/r"));
    await writeTask(record(ID_2, "/r"));
    await expect(runFactoryAction({ action: "status", id: "zz" }, caseDir)).rejects.toThrow('no task has an id starting with "zz"');
    await expect(runFactoryAction({ action: "status", id: "abc" }, caseDir)).rejects.toThrow(`"abc" matches 2 tasks (${ID_1}, ${ID_2}), give more of the id`);
    await expect(runFactoryAction({ action: "approve" }, caseDir)).rejects.toThrow("approve needs the id of a task");
    expect((await runFactoryAction({ action: "status", id: "abc1" }, caseDir)).text).toBe('Task abc10000 "task abc10000": starting.');
  });

  test("list: the tasks of the repo", async () => {
    const repo = makeRepo();
    await writeTask(record(ID_1, repo));
    await writeTask(record(ID_2, "/elsewhere"));
    const answer = await runFactoryAction({ action: "list" }, repo);
    expect(answer.text).toBe('abc10000 "task abc10000": starting');
    expect(answer.details).toEqual({ tasks: [{ record: record(ID_1, repo), state: null, interrupted: false }] });
  });
});

describe("review fixes", () => {
  test("two approves at once: one runs, the other is refused, one runner", async () => {
    const repo = makeRepo();
    const record = await startTask(repo);
    await until(async () => (await stateOf(record)) === "waiting_approve");
    await until(() => runnerEnded(record));
    const results = await Promise.allSettled([
      runFactoryAction({ action: "approve", id: record.id }, repo),
      runFactoryAction({ action: "approve", id: record.id }, repo),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(String(refused.reason)).toMatch(new RegExp(`task ${record.id.slice(0, 8)} is (busy|done)`));
    await until(async () => (await stateOf(record)) === "done");
    await until(() => runnerEnded(record));
    expect(prompts().filter((line) => line === "prompt /factory approve")).toHaveLength(1);
  }, 30_000);

  test("remove refuses unmerged commits and uncommitted changes unless force, which names what it dropped", async () => {
    const repo = makeRepo();
    const record = await startTask(repo);
    const short = record.id.slice(0, 8);
    await until(async () => (await stateOf(record)) === "waiting_approve");
    await until(() => runnerEnded(record));
    writeFileSync(join(record.worktree, "b.txt"), "b\n");
    git(record.worktree, "add", "-A");
    git(record.worktree, "commit", "--quiet", "-m", "b");
    writeFileSync(join(record.worktree, "c.txt"), "c\n");
    await expect(runFactoryAction({ action: "remove", id: record.id }, repo)).rejects.toThrow(
      `task ${short} has 1 unmerged commit (not on main) and uncommitted changes in its worktree, give force: true to remove it anyway`,
    );
    expect(existsSync(record.worktree)).toBe(true);
    const removed = await runFactoryAction({ action: "remove", id: record.id, force: true }, repo);
    expect(removed.text).toBe(`Removed task ${short}: its record, log, worktree and branch ${record.branch}, dropping 1 unmerged commit (not on main) and uncommitted changes.`);
    expect(existsSync(record.worktree)).toBe(false);
    expect(git(repo, "branch", "--list", record.branch)).toBe("");
  }, 30_000);

  test("a running task whose runner is gone is interrupted: status and list say so, retry runs it", async () => {
    process.env.FAKE_PI_HOLD = "1";
    const repo = makeRepo();
    const record = await startTask(repo);
    const short = record.id.slice(0, 8);
    await until(async () => (await stateOf(record)) === "running");
    await stopRunners(record);
    const status = await runFactoryAction({ action: "status", id: record.id }, repo);
    expect(status.text).toBe(`Task ${short} "Add b": interrupted (running when its runner ended, round 1, start).`);
    expect((status.details as TaskView).interrupted).toBe(true);
    expect((await runFactoryAction({ action: "list" }, repo)).text).toBe(`${short} "Add b": interrupted (running when its runner ended, round 1, start)`);
    delete process.env.FAKE_PI_HOLD;
    await runFactoryAction({ action: "retry", id: record.id }, repo);
    await until(() => prompts().includes("prompt /factory retry"));
    await until(async () => (await lastFactoryState(record.sessionDir, record.sessionId))?.reason === "gates");
    await until(() => runnerEnded(record));
  }, 30_000);
});

describe("registerFactoryTool", () => {
  function registered() {
    let tool: any;
    registerFactoryTool({ registerTool: (definition: unknown) => (tool = definition) } as unknown as ExtensionAPI);
    return tool;
  }

  test("the tool factory with the action enum", () => {
    const tool = registered();
    expect(tool.name).toBe("factory");
    expect(tool.parameters.required).toEqual(["action"]);
    expect(tool.parameters.properties.action.enum).toEqual(["start", "status", "list", "approve", "retry", "cancel", "remove"]);
    expect(tool.parameters.properties.force.type).toBe("boolean");
    expect(tool.executionMode).toBe("sequential");
  });

  test("a caller error is an isError result of one sentence, not a throw", async () => {
    const tool = registered();
    const params: FactoryToolParams = { action: "status", id: "nothing" };
    const result = await tool.execute("call-1", params, undefined, undefined, { cwd: caseDir });
    expect(result).toEqual({ content: [{ type: "text", text: 'factory: no task has an id starting with "nothing"' }], details: undefined, isError: true });
    const list = await tool.execute("call-2", { action: "list" }, undefined, undefined, { cwd: makeRepo() });
    expect(list.isError).toBeUndefined();
    expect(list.details).toEqual({ tasks: [] });
  });
});
