/**
 * The core over real git repos in a temp dir and a fake `pi` on PATH (never a model, never the real
 * `agent-worktree`). The fake answers each `/factory` command with the entries the plugin would write.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { ACTIONS, callAction, FactoryError, type TaskView, type TimelineEntry } from "./core.ts";
import { liveRunners, stopRunners, taskInboxPath } from "./launch.ts";
import { lastFactoryState } from "./runner.ts";
import { listTasks, lockTask, taskLogPath, tasksDir, unlockTask, writeTask, type TaskRecord } from "./tasks.ts";

const savedEnv = { ...process.env };
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "factory-core-test-")));
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
if (process.env.FAKE_PI_ENV_LOG) appendFileSync(process.env.FAKE_PI_ENV_LOG, "secret " + (process.env.FACTORY_TEST_SECRET ?? "-") + "\\n");
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

/** A runner stand-in `pgrep` finds as the task's runner; it exits as soon as the task's inbox file appears. */
const exitingRunner = join(scratch, "fake-runner", "runner.ts");
mkdirSync(join(scratch, "fake-runner"));
writeFileSync(
  exitingRunner,
  `import { existsSync } from "node:fs";
const inbox = process.env.FAKE_INBOX;
while (!existsSync(inbox)) await Bun.sleep(1);
process.exit(0);
`,
);

/** A PATH with the fake `pi` and without any directory that holds `agent-worktree`. */
const testPath = [fakeBin, ...(savedEnv.PATH ?? "").split(":").filter((dir) => dir !== "" && !existsSync(join(dir, "agent-worktree")))].join(":");

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
  // Starting a task needs a factory models list; a test that wants none removes it.
  mkdirSync(join(caseDir, "agent", "factory"), { recursive: true });
  writeFileSync(modelsFile(), "- a/b\n- c/d\n");
});

function modelsFile(): string {
  return join(caseDir, "agent", "factory", "models.yaml");
}

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
function makeRepo(withConfig = true, name = "repo"): string {
  const repo = join(caseDir, name);
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

/** The record of a started task. */
async function recordOf(view: TaskView): Promise<TaskRecord> {
  const record = (await listTasks()).find((task) => task.id === view.id);
  if (!record) throw new Error(`no record ${view.id}`);
  return record;
}

async function startTask(repo: string, title = "Add b"): Promise<TaskRecord> {
  return recordOf((await callAction("tasks.start", { title, request: "add b.txt" }, { cwd: repo })) as TaskView);
}

/** Starts a task and waits for its runner to leave it at `state`. */
async function restingTask(repo: string, state: "waiting_approve" | "blocked"): Promise<TaskRecord> {
  if (state === "blocked") process.env.FAKE_PI_START_END = "blocked";
  const record = await startTask(repo);
  await until(async () => (await stateOf(record)) === state);
  await until(() => runnerEnded(record));
  return record;
}

/** The `FactoryError` `promise` rejects with. */
async function failure(promise: Promise<unknown>): Promise<FactoryError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof FactoryError)) throw new Error(`expected a FactoryError, got ${String(error)}`);
  return error;
}

async function expectError(promise: Promise<unknown>, code: FactoryError["code"], message: string): Promise<void> {
  const error = await failure(promise);
  expect(error.code).toBe(code);
  expect(error.message).toContain(message);
}

const ID_1 = "abc10000-0000-4000-8000-000000000001";
const ID_2 = "abc20000-0000-4000-8000-000000000002";
const ID_3 = "abc30000-0000-4000-8000-000000000003";

function fakeRecord(id: string, repo: string): TaskRecord {
  return {
    id,
    repo,
    worktree: join(caseDir, id),
    branch: id,
    title: `task ${id.slice(0, 8)}`,
    sessionId: `session-${id}`,
    sessionDir: join(caseDir, "sessions"),
    createdAt: `2026-01-01T00:00:0${id.at(-1)}.000Z`,
    tag: "team/a",
    plan: null,
    kind: "task",
  };
}

function writeSession(record: TaskRecord, entries: object[]): string {
  mkdirSync(record.sessionDir, { recursive: true });
  const path = join(record.sessionDir, `2026-01-01T00-00-00-000Z_${record.sessionId}.jsonl`);
  writeFileSync(path, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
  return path;
}

describe("callAction", () => {
  test("ACTIONS names every action of the contract", () => {
    expect(Object.keys(ACTIONS).sort()).toEqual(
      [
        "models.get",
        "models.set",
        "repos.list",
        "repos.add",
        "repos.remove",
        "branches.list",
        "settings.get",
        "settings.set",
        "config.get",
        "config.write",
        "tasks.list",
        "tasks.get",
        "tasks.import",
        "tasks.timeline",
        "tasks.diff",
        "tasks.start",
        "tasks.approve",
        "tasks.retry",
        "tasks.cancel",
        "tasks.remove",
        "tasks.message",
        "tasks.wait",
      ].sort(),
    );
    expect(ACTIONS["tasks.get"].mutates).toBe(false);
    expect(ACTIONS["tasks.start"].params.required).toEqual(["repo", "title", "request"]);
  });

  test("invalid: an unknown action, a missing or mistyped param, an ambiguous id", async () => {
    await expectError(callAction("tasks.fly", {}), "invalid", 'unknown action "tasks.fly"');
    await expectError(callAction("tasks.get", {}), "invalid", "tasks.get needs id");
    await expectError(callAction("tasks.timeline", { id: "x", since: "1" }), "invalid", "since must be an integer");
    await expectError(callAction("settings.get", {}), "invalid", "settings.get needs repo");
    await writeTask(fakeRecord(ID_1, "/r"));
    await writeTask(fakeRecord(ID_2, "/r"));
    await expectError(callAction("tasks.get", { id: "abc" }), "invalid", `"abc" matches 2 tasks (${ID_1}, ${ID_2}), give more of the id`);
  });

  test("not_found: an unknown id, a path outside git", async () => {
    await expectError(callAction("tasks.get", { id: "zz" }), "not_found", 'no task has an id starting with "zz"');
    await expectError(callAction("branches.list", {}, { cwd: caseDir }), "not_found", `${caseDir} is not inside a git repository`);
  });

  test("failed: a stored settings file that does not parse", async () => {
    const repo = makeRepo();
    await callAction("repos.add", { repo });
    writeFileSync(join(caseDir, "agent", "factory", "repos", `${encodeURIComponent(repo)}.yaml`), "merge: [\n");
    const error = await failure(callAction("settings.get", { repo }));
    expect(error.code).toBe("failed");
    expect(error.message).not.toContain("\n");
  });
});

describe("repos", () => {
  test("add registers the primary checkout, list names it, remove unregisters", async () => {
    const repo = makeRepo();
    git(repo, "worktree", "add", "--quiet", "-b", "side", join(caseDir, "side"));
    expect(await callAction("repos.list", {})).toEqual({ repos: [] });
    expect(await callAction("repos.add", { repo: "side" }, { cwd: caseDir })).toEqual({ repo, repos: [repo] });
    expect(await callAction("repos.add", {}, { cwd: repo })).toEqual({ repo, repos: [repo] });
    expect(await callAction("repos.list", {})).toEqual({ repos: [repo] });
    expect(await callAction("repos.remove", { repo })).toEqual({ repos: [] });
    await expectError(callAction("repos.remove", { repo }), "not_found", `${repo} is not registered`);
  });

  test("remove takes a registered path whose repository is gone", async () => {
    const repo = makeRepo();
    await callAction("repos.add", { repo });
    rmSync(repo, { recursive: true, force: true });
    expect(await callAction("repos.remove", { repo })).toEqual({ repos: [] });
  });

  test("core.ts and what it imports load without node_modules", () => {
    const copy = join(caseDir, "plugin");
    mkdirSync(copy);
    for (const name of readdirSync(import.meta.dir)) {
      if ((name.endsWith(".ts") && !name.endsWith(".test.ts")) || name === "factory.template.yaml") copyFileSync(join(import.meta.dir, name), join(copy, name));
    }
    expect(existsSync(join(copy, "node_modules"))).toBe(false);
    const repo = makeRepo();
    mkdirSync(join(caseDir, "agent", "factory", "repos"), { recursive: true });
    writeFileSync(join(caseDir, "agent", "factory", "repos", `${encodeURIComponent(repo)}.yaml`), "{}\n");
    const output = execFileSync("bun", ["-e", 'const { callAction } = await import("./core.ts"); console.log(JSON.stringify(await callAction("repos.list", {})));'], {
      cwd: copy,
      encoding: "utf8",
      env: process.env,
    });
    expect(JSON.parse(output.trim())).toEqual({ repos: [repo] });
  });
});

describe("models", () => {
  test("models.get reads the list, models.set replaces it deduplicated; an empty list reads as []", async () => {
    expect(await callAction("models.get", {})).toEqual({ models: ["a/b", "c/d"] });
    expect(await callAction("models.set", { models: ["x/y", "a/b", "x/y"] })).toEqual({ models: ["x/y", "a/b"] });
    expect(await callAction("models.get", {})).toEqual({ models: ["x/y", "a/b"] });
    expect(await callAction("models.set", { models: [] })).toEqual({ models: [] });
    rmSync(modelsFile());
    expect(await callAction("models.get", {})).toEqual({ models: [] });
    expect(ACTIONS["models.get"].mutates).toBe(false);
    expect(ACTIONS["models.set"].mutates).toBe(true);
  });

  test("models.set refuses a missing, mistyped or malformed list and keeps the old one", async () => {
    await expectError(callAction("models.set", {}), "invalid", "models.set needs models");
    await expectError(callAction("models.set", { models: "a/b" }), "invalid", "models.set: models must be an array");
    await expectError(callAction("models.set", { models: ["sonnet"] }), "invalid", 'models.set: "sonnet" is not a provider/model id');
    await expectError(callAction("models.set", { models: [4] }), "invalid", "models.set: 4 is not a provider/model id");
    expect(await callAction("models.get", {})).toEqual({ models: ["a/b", "c/d"] });
  });

  test("an empty list: settings.set and tasks.start are refused naming /factory models, reads still work", async () => {
    const repo = makeRepo();
    rmSync(modelsFile());
    const noModels = "no factory models are set (set them with /factory models)";
    await expectError(callAction("settings.set", { repo, settings: { merge: "review" } }), "refused", noModels);
    await expectError(callAction("tasks.start", { title: "t", request: "r" }, { cwd: repo }), "refused", noModels);
    expect(((await callAction("settings.get", { repo })) as { stored: object }).stored).toEqual({});
    expect(await callAction("tasks.list", {})).toEqual({ tasks: [] });
    expect(await callAction("repos.add", { repo })).toEqual({ repo, repos: [repo] });
    expect(await listTasks()).toEqual([]);
  });

  test("a model not on the list: settings.set and tasks.start (stored or override) are refused naming it", async () => {
    const repo = makeRepo();
    await expectError(callAction("settings.set", { repo, settings: { models: { coder: "a/b", reviewer: "z/z" } } }), "refused", "the reviewer model z/z is not a factory model");
    await expectError(
      callAction("tasks.start", { title: "t", request: "r", overrides: { models: { coder: "q/q" } } }, { cwd: repo }),
      "refused",
      "the coder model q/q is not a factory model (add it with /factory models add q/q)",
    );
    await callAction("settings.set", { repo, settings: { models: { coder: "c/d" } } });
    await callAction("models.set", { models: ["a/b"] });
    await expectError(callAction("tasks.start", { title: "t", request: "r" }, { cwd: repo }), "refused", "the coder model c/d is not a factory model");
    expect(await listTasks()).toEqual([]);
  });
});

describe("branches, settings, config", () => {
  test("branches.list: name, default, hasConfig", async () => {
    const repo = makeRepo();
    git(repo, "checkout", "--quiet", "-b", "bare");
    git(repo, "rm", "--quiet", "factory.yaml");
    git(repo, "commit", "--quiet", "-m", "no config");
    git(repo, "checkout", "--quiet", "main");
    expect(await callAction("branches.list", { repo })).toEqual({
      branches: [
        { name: "bare", default: false, hasConfig: false },
        { name: "main", default: true, hasConfig: true },
      ],
    });
  });

  test("settings.get and settings.set: stored, resolved, defaults; preview passes through; invalid values refused", async () => {
    const repo = makeRepo();
    const defaults = { branch: "main", merge: "auto", maxRounds: 2, review: false, models: {}, preview: false };
    expect(await callAction("settings.get", { repo })).toEqual({ stored: {}, resolved: defaults, defaults });
    const set = await callAction("settings.set", { repo, settings: { merge: "review", preview: true, models: { coder: "a/b" } } });
    expect(set).toEqual({
      stored: { merge: "review", preview: true, models: { coder: "a/b" } },
      resolved: { ...defaults, merge: "review", preview: true, models: { coder: "a/b" } },
      defaults,
    });
    await expectError(callAction("settings.set", { repo, settings: { preview: "yes" } }), "invalid", "settings.preview must be a boolean");
    await expectError(callAction("settings.set", { repo, settings: { maxRounds: 30 } }), "invalid", "settings.maxRounds");
    expect(((await callAction("settings.get", { repo })) as { stored: object }).stored).toEqual({ merge: "review", preview: true, models: { coder: "a/b" } });
    expect(await callAction("repos.list", {})).toEqual({ repos: [repo] });
  });

  test("config.get: the working copy, a branch's committed file, a draft when there is none", async () => {
    const repo = makeRepo();
    expect(await callAction("config.get", { repo })).toEqual({ exists: true, text: "gates: []\n", draft: null, source: [] });
    writeFileSync(join(repo, "factory.yaml"), "gates: [[make, lint]]\n");
    expect(((await callAction("config.get", { repo, branch: "main" })) as { text: string }).text).toBe("gates: []\n");
    await expectError(callAction("config.get", { repo, branch: "nope" }), "not_found", "has no local branch nope");
    rmSync(join(repo, "factory.yaml"));
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { lint: "eslint ." } }));
    const drafted = (await callAction("config.get", { repo })) as { exists: boolean; text: null; draft: string; source: string[] };
    expect(drafted.exists).toBe(false);
    expect(drafted.text).toBeNull();
    expect(drafted.draft).toContain("gates:");
    expect(drafted.source).toEqual(["package.json"]);
  });

  test("config.write needs a registered repo and overwrite: true to replace a file", async () => {
    const repo = makeRepo(false);
    await expectError(callAction("config.write", { repo, text: "gates: []\n" }), "not_found", `${repo} is not registered`);
    expect(existsSync(join(repo, "factory.yaml"))).toBe(false);
    await callAction("repos.add", { repo });
    expect(await callAction("config.write", { repo, text: "gates: []\n" })).toEqual({ path: join(repo, "factory.yaml") });
    await expectError(callAction("config.write", { repo, text: "gates: [[x]]\n" }), "refused", "exists, give overwrite: true to replace it");
    expect(readFileSync(join(repo, "factory.yaml"), "utf8")).toBe("gates: []\n");
  });

  test("config.write checks the text, writes factory.yaml, commits nothing", async () => {
    const repo = makeRepo();
    await callAction("repos.add", { repo });
    await expectError(callAction("config.write", { repo, text: "gates: 3\n", overwrite: true }), "invalid", "factory.yaml: gates must be a list of argv lists");
    expect(await callAction("config.write", { repo, text: "gates: [[make, lint]]\n", overwrite: true })).toEqual({ path: join(repo, "factory.yaml") });
    expect(readFileSync(join(repo, "factory.yaml"), "utf8")).toBe("gates: [[make, lint]]\n");
    expect(git(repo, "status", "--porcelain")).toBe("M factory.yaml");
  });
});

describe("task reads", () => {
  const sessionEntries = [
    { type: "session", version: 3, id: "s" },
    { type: "custom", customType: "factory-task", timestamp: "t1", data: { mainBranch: "main", settings: { branch: "main", merge: "auto", maxRounds: 2, review: true, models: {} } } },
    { type: "message", timestamp: "t2", message: { role: "user", content: "add b.txt" } },
    { type: "custom", customType: "factory-round", timestamp: "t3", data: { round: 1, trigger: "start" } },
    {
      type: "message",
      timestamp: "t4",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "done" }], usage: { input: 10, output: 5, cost: { total: 0.5 } } },
    },
    { type: "message", timestamp: "t5", message: { role: "assistant", content: [{ type: "toolCall" }], usage: { input: 1, output: 1, cost: { total: 0.25 } } } },
    { type: "custom", customType: "factory-review", timestamp: "t6", data: { round: 1, usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 1 } } },
    { type: "custom", customType: "factory-merge-intent", timestamp: "t7", data: { commit: "c", before: "b" } },
    { type: "custom_message", customType: "factory-feedback", content: "fix", timestamp: "t8" },
    { type: "message", timestamp: "t9", message: { role: "user", content: [{ type: "text", text: "/factory retry" }] } },
    { type: "custom", customType: "factory-state", timestamp: "t10", data: { state: "blocked", round: 1, reason: "gates" } },
  ];

  test("tasks.get: state, settings and usage from the session file", async () => {
    const record = fakeRecord(ID_1, "/r");
    await writeTask(record);
    const path = writeSession(record, sessionEntries);
    expect(await callAction("tasks.get", { id: "abc1" })).toEqual({
      id: ID_1,
      repo: "/r",
      worktree: record.worktree,
      branch: record.branch,
      title: record.title,
      createdAt: record.createdAt,
      tag: "team/a",
      plan: null,
      kind: "task",
      sessionId: record.sessionId,
      sessionPath: path,
      state: "blocked",
      round: 1,
      reason: "gates",
      at: "t10",
      question: null,
      running: false,
      interrupted: false,
      settings: { branch: "main", merge: "auto", maxRounds: 2, review: true, models: {} },
      usage: { input: 111, output: 56, cost: 1.75 },
      actions: ["tasks.retry", "tasks.cancel", "tasks.remove", "tasks.message"],
    });
  });

  test("tasks.get before the session file exists: nulls", async () => {
    await writeTask(fakeRecord(ID_1, "/r"));
    const view = (await callAction("tasks.get", { id: ID_1 })) as TaskView;
    expect([view.sessionPath, view.state, view.round, view.at, view.settings, view.usage, view.running, view.interrupted]).toEqual([null, null, null, null, null, null, false, false]);
    expect(view.actions).toEqual(["tasks.cancel", "tasks.remove"]);
  });

  test("tasks.timeline: the kinds in order, a cursor that skips what was read and a torn last line", async () => {
    const record = fakeRecord(ID_1, "/r");
    await writeTask(record);
    expect(await callAction("tasks.timeline", { id: ID_1 })).toEqual({ entries: [], next: 0 });
    const path = writeSession(record, sessionEntries);
    const first = (await callAction("tasks.timeline", { id: ID_1 })) as { entries: TimelineEntry[]; next: number };
    expect(first.entries.map((entry) => [entry.at, entry.kind])).toEqual([
      ["t1", "task"],
      ["t2", "user"],
      ["t3", "round"],
      ["t4", "coder"],
      ["t6", "review"],
      ["t10", "state"],
    ]);
    expect(first.entries[3].data).toEqual({ text: "done" });
    expect(first.entries[5].data).toEqual({ state: "blocked", round: 1, reason: "gates" });
    expect(first.next).toBe(readFileSync(path).length);
    const more = { type: "custom", customType: "factory-merge", timestamp: "t11", data: { ok: true, commit: "c", error: null, depsSynced: false } };
    writeFileSync(path, `${readFileSync(path, "utf8")}${JSON.stringify(more)}\n{"type":"cus`);
    const second = (await callAction("tasks.timeline", { id: ID_1, since: first.next })) as { entries: TimelineEntry[]; next: number };
    expect(second.entries).toEqual([{ at: "t11", kind: "merge", data: more.data }]);
    expect(await callAction("tasks.timeline", { id: ID_1, since: second.next })).toEqual({ entries: [], next: second.next });
    await expectError(callAction("tasks.timeline", { id: ID_1, since: 1_000_000 }), "invalid", "past the end");
  });

  test("tasks.list: every task, or the repository's", async () => {
    const repo = makeRepo();
    await writeTask(fakeRecord(ID_1, repo));
    await writeTask(fakeRecord(ID_2, "/elsewhere"));
    const ids = (result: unknown) => (result as { tasks: TaskView[] }).tasks.map((view) => view.id);
    expect(ids(await callAction("tasks.list", { repo }))).toEqual([ID_1]);
    expect(ids(await callAction("tasks.list", {}, { cwd: repo }))).toEqual([ID_1, ID_2]);
  });
});

describe("task actions", () => {
  test("tasks.start refusals: no title, not a repo, no factory.yaml, bad overrides", async () => {
    const repo = makeRepo(false);
    await expectError(callAction("tasks.start", { title: " ", request: "r" }, { cwd: repo }), "invalid", "needs a title");
    await expectError(callAction("tasks.start", { title: "t", request: "r" }, { cwd: caseDir }), "not_found", "is not inside a git repository");
    await expectError(callAction("tasks.start", { title: "t", request: "r" }, { cwd: repo }), "refused", "branch main has no factory.yaml");
    await expectError(callAction("tasks.start", { title: "t", request: "r", overrides: { branch: "nope" } }, { cwd: repo }), "refused", "branch nope does not exist locally");
    await expectError(callAction("tasks.start", { title: "t", request: "r", overrides: { maxRounds: 21 } }, { cwd: repo }), "invalid", "overrides.maxRounds must be an integer from 1 to 20");
    expect(await listTasks()).toEqual([]);
  });

  test("start returns once the runner is spawned; get, approve, then remove", async () => {
    const repo = makeRepo();
    const started = (await callAction("tasks.start", { title: "Add b", request: "add b.txt", repo: "." }, { cwd: repo })) as TaskView;
    expect(started.repo).toBe(repo);
    expect(git(started.worktree, "rev-parse", "--abbrev-ref", "HEAD")).toBe(started.branch);
    const record = await recordOf(started);
    await until(async () => (await stateOf(record)) === "waiting_approve");
    await until(() => runnerEnded(record));
    const view = (await callAction("tasks.get", { id: record.id.slice(0, 6) })) as TaskView;
    expect([view.state, view.round, view.reason, view.running]).toEqual(["waiting_approve", 1, "passed", false]);
    expect(view.actions).toEqual(["tasks.approve", "tasks.cancel", "tasks.remove", "tasks.message"]);
    await expectError(callAction("tasks.retry", { id: record.id }), "refused", "retry needs blocked, cancelled or interrupted");

    await callAction("tasks.approve", { id: record.id });
    await until(async () => (await stateOf(record)) === "done");
    await until(() => runnerEnded(record));
    expect(prompts()).toEqual(["prompt /factory start", "prompt /factory approve"]);

    expect(await callAction("tasks.remove", { id: record.id })).toEqual({ removed: record.id, dropped: null });
    expect(existsSync(record.worktree)).toBe(false);
    expect(git(repo, "branch", "--list", record.branch)).toBe("");
    expect(existsSync(taskLogPath(record.id))).toBe(false);
    expect(await listTasks()).toEqual([]);
  }, 30_000);

  test("busy: an action while another process holds the task lock", async () => {
    const repo = makeRepo();
    const record = await restingTask(repo, "waiting_approve");
    await lockTask(record.id);
    try {
      await expectError(callAction("tasks.approve", { id: record.id }), "busy", "is busy");
    } finally {
      await unlockTask(record.id);
    }
  }, 30_000);

  test("tasks.diff: base, patch and per-file counts of the worktree, uncommitted files included", async () => {
    const repo = makeRepo();
    const record = await restingTask(repo, "waiting_approve");
    writeFileSync(join(record.worktree, "a.txt"), "a\nmore\n");
    git(record.worktree, "commit", "--quiet", "-am", "more");
    writeFileSync(join(record.worktree, "b.txt"), "b\nc\n");
    const diff = (await callAction("tasks.diff", { id: record.id })) as { base: string; diff: string; files: object[] };
    expect(diff.base).toBe(git(repo, "rev-parse", "main"));
    expect(diff.files).toEqual([
      { path: "a.txt", added: 1, removed: 0 },
      { path: "b.txt", added: 2, removed: 0 },
    ]);
    expect(diff.diff).toContain("+more");
    expect(diff.diff).toContain("b/b.txt");
  }, 30_000);

  test("retry from blocked sends /factory retry, the runner ends with the task blocked again", async () => {
    const repo = makeRepo();
    const record = await restingTask(repo, "blocked");
    await expectError(callAction("tasks.approve", { id: record.id }), "refused", "approve needs waiting_approve");
    const view = (await callAction("tasks.retry", { id: record.id })) as TaskView;
    expect(view.id).toBe(record.id);
    await until(() => prompts().includes("prompt /factory retry"));
    await until(async () => (await lastFactoryState(record.sessionDir, record.sessionId))?.reason === "gates");
    await until(() => runnerEnded(record));
  }, 30_000);

  test("cancel of a running task stops its runner first; remove refuses while it runs", async () => {
    process.env.FAKE_PI_HOLD = "1";
    const repo = makeRepo();
    const record = await startTask(repo);
    await until(async () => (await stateOf(record)) === "running");
    const running = (await callAction("tasks.get", { id: record.id })) as TaskView;
    expect([running.running, running.actions]).toEqual([true, ["tasks.cancel", "tasks.message"]]);
    const refusal = await failure(callAction("tasks.remove", { id: record.id, force: true }));
    expect([refusal.code, refusal.message, refusal.detail]).toEqual(["refused", `task ${record.id.slice(0, 8)} is running, cancel it first`, undefined]);
    await callAction("tasks.cancel", { id: record.id });
    await until(async () => (await stateOf(record)) === "cancelled");
    await until(() => runnerEnded(record));
    await expectError(callAction("tasks.cancel", { id: record.id }), "refused", "is cancelled already");
  }, 30_000);

  test("remove refuses unmerged commits and uncommitted changes unless force, and names what it dropped", async () => {
    const repo = makeRepo();
    const record = await restingTask(repo, "waiting_approve");
    const short = record.id.slice(0, 8);
    writeFileSync(join(record.worktree, "b.txt"), "b\n");
    git(record.worktree, "add", "-A");
    git(record.worktree, "commit", "--quiet", "-m", "b");
    writeFileSync(join(record.worktree, "c.txt"), "c\n");
    const refusal = await failure(callAction("tasks.remove", { id: record.id }));
    expect([refusal.code, refusal.message, refusal.detail]).toEqual([
      "refused",
      `task ${short} has 1 unmerged commit (not on main) and uncommitted changes in its worktree, give force: true to remove it anyway`,
      { force: true },
    ]);
    expect(existsSync(record.worktree)).toBe(true);
    expect(await callAction("tasks.remove", { id: record.id, force: true })).toEqual({ removed: record.id, dropped: "1 unmerged commit (not on main) and uncommitted changes" });
    expect(existsSync(record.worktree)).toBe(false);
  }, 30_000);

  test("a running task whose runner is gone is interrupted; retry runs it", async () => {
    process.env.FAKE_PI_HOLD = "1";
    const repo = makeRepo();
    const record = await startTask(repo);
    await until(async () => (await stateOf(record)) === "running");
    await stopRunners(record);
    const view = (await callAction("tasks.get", { id: record.id })) as TaskView;
    expect([view.state, view.running, view.interrupted]).toEqual(["running", false, true]);
    expect(view.actions).toEqual(["tasks.retry", "tasks.cancel", "tasks.remove", "tasks.message"]);
    delete process.env.FAKE_PI_HOLD;
    await callAction("tasks.retry", { id: record.id });
    await until(() => prompts().includes("prompt /factory retry"));
    await until(async () => (await lastFactoryState(record.sessionDir, record.sessionId))?.reason === "gates");
    await until(() => runnerEnded(record));
  }, 30_000);
});

describe("tasks.message", () => {
  test("a resting task gets the message through a new runner", async () => {
    const repo = makeRepo();
    const record = await restingTask(repo, "blocked");
    const view = (await callAction("tasks.message", { id: record.id, text: "please fix it" })) as TaskView;
    expect(view.id).toBe(record.id);
    await until(() => prompts().includes("prompt please fix"));
    expect(existsSync(taskInboxPath(record.id))).toBe(false);
  }, 30_000);

  test("a running task's live runner gets an inbox line; no state and merging are refused", async () => {
    await writeTask(fakeRecord(ID_1, "/r"));
    await expectError(callAction("tasks.message", { id: ID_1, text: "hi" }), "refused", "has not started yet");
    process.env.FAKE_PI_HOLD = "1";
    const repo = makeRepo();
    const record = await startTask(repo);
    await until(async () => (await stateOf(record)) === "running");
    const view = (await callAction("tasks.message", { id: record.id, text: "also do c" })) as TaskView;
    expect(view.running).toBe(true);
    expect(readFileSync(taskInboxPath(record.id), "utf8")).toBe('{"text":"also do c"}\n');
    expect(prompts()).toEqual(["prompt /factory start"]);

    const merging = fakeRecord(ID_2, "/r");
    await writeTask(merging);
    writeSession(merging, [{ type: "custom", customType: "factory-state", data: { state: "merging", round: 1, reason: "approved" } }]);
    await expectError(callAction("tasks.message", { id: ID_2, text: "hi" }), "refused", "is merging");
  }, 30_000);

  test("a runner that ends as the line is appended: the line is taken back and a new runner delivers it", async () => {
    const repo = makeRepo();
    const record = await restingTask(repo, "blocked");
    writeSession(record, [
      { type: "custom", customType: "factory-task", data: { mainBranch: "main" } },
      { type: "custom", customType: "factory-state", data: { state: "running", round: 2, reason: "message" } },
    ]);
    const runner = Bun.spawn(["bun", exitingRunner, record.worktree, record.sessionDir, record.sessionId, "x"], {
      env: { ...process.env, FAKE_INBOX: taskInboxPath(record.id) },
    });
    await until(async () => (await liveRunners(record)).length === 1);
    await callAction("tasks.message", { id: record.id, text: "late note" });
    await runner.exited;
    await until(() => prompts().includes("prompt late note"));
    expect(readFileSync(taskInboxPath(record.id), "utf8")).toBe("");
  }, 30_000);
});

describe("tasks.import", () => {
  const ID = "11111111-2222-3333-4444-555555555555";

  test("hostOnly: tasks.import only", () => {
    expect(Object.entries(ACTIONS).filter(([, spec]) => spec.hostOnly).map(([name]) => name)).toEqual(["tasks.import"]);
  });

  test("writes a record of a linked worktree on its branch once, keeps an existing one, refuses a wrong shape", async () => {
    const repo = makeRepo();
    const worktree = join(caseDir, "task-wt");
    git(repo, "worktree", "add", "--quiet", "-b", "task", worktree);
    const record = { id: ID, repo, worktree, branch: "task", title: "first", sessionId: "s", sessionDir: join(caseDir, "sessions"), createdAt: "2026-01-01T00:00:00.000Z" };
    expect(await callAction("tasks.import", { record })).toMatchObject({ id: ID, title: "first", state: null });
    expect(await callAction("tasks.import", { record: { ...record, title: "second" } })).toMatchObject({ title: "first" });
    await expect(callAction("tasks.import", { record: { ...record, id: "abc" } })).rejects.toMatchObject({ code: "invalid" });
    await expect(callAction("tasks.import", { record: { ...record, id: ID.replace("1", "9"), title: "" } })).rejects.toMatchObject({ code: "invalid" });
    await expect(callAction("tasks.import", { record: { ...record, id: ID.replace("1", "9"), worktree: "task-wt" } })).rejects.toMatchObject({ code: "invalid" });
    expect((await listTasks()).map((task) => task.id)).toEqual([ID]);
  });

  test("refuses a record that would let tasks.remove delete a checkout or branch the task does not own", async () => {
    const repo = makeRepo();
    const victim = join(caseDir, "victim-wt");
    git(repo, "worktree", "add", "--quiet", "-b", "precious", victim);
    const other = makeRepo(true, "other");
    const base = { id: ID, repo, worktree: victim, branch: "precious", title: "t", sessionId: "s", sessionDir: join(caseDir, "sessions"), createdAt: "2026-01-01T00:00:00.000Z" };
    const refused = async (change: object, message: string) => expectError(callAction("tasks.import", { record: { ...base, ...change } }), "refused", message);
    await refused({ worktree: repo, branch: "main" }, `${repo} is not a linked worktree of ${repo}`);
    await refused({ branch: "main" }, `${victim} does not have branch main checked out`);
    await refused({ repo: victim }, `${victim} is not the primary checkout of its repository`);
    await refused({ repo: other }, `${victim} is not a linked worktree of ${other}`);
    await refused({ repo: join(caseDir, "nothing") }, "is not a git repository");
    expect(await listTasks()).toEqual([]);
    expect(existsSync(victim)).toBe(true);
  });
});

describe("D review fixes", () => {
  test("a relative repo without cwd is invalid", async () => {
    await expectError(callAction("settings.get", { repo: "some/repo" }), "invalid", "repo some/repo must be an absolute path (the call has no cwd)");
  });

  test("env: the runners an action starts get the caller's environment, not the host's", async () => {
    const repo = makeRepo();
    const envLog = join(caseDir, "env.log");
    process.env.FAKE_PI_START_END = "blocked";
    const env = { ...(process.env as Record<string, string>), FAKE_PI_ENV_LOG: envLog };
    process.env.FACTORY_TEST_SECRET = "leak";
    const record = await recordOf((await callAction("tasks.start", { title: "t", request: "r" }, { cwd: repo, env })) as TaskView);
    await until(async () => (await stateOf(record)) === "blocked");
    await until(() => runnerEnded(record));
    await callAction("tasks.message", { id: record.id, text: "more" }, { env });
    await until(() => existsSync(envLog) && readFileSync(envLog, "utf8").split("\n").length === 3);
    expect(readFileSync(envLog, "utf8")).toBe("secret -\nsecret -\n");
  }, 30_000);

  test("an interrupted task without unmerged work is removed without force", async () => {
    process.env.FAKE_PI_HOLD = "1";
    const repo = makeRepo();
    const record = await startTask(repo);
    await until(async () => (await stateOf(record)) === "running");
    await stopRunners(record);
    expect(await callAction("tasks.remove", { id: record.id })).toEqual({ removed: record.id, dropped: null });
    expect(existsSync(record.worktree)).toBe(false);
  }, 30_000);

  test("an interrupted task with unmerged work: refused with detail force, removed with force", async () => {
    process.env.FAKE_PI_HOLD = "1";
    const repo = makeRepo();
    const record = await startTask(repo);
    await until(async () => (await stateOf(record)) === "running");
    await stopRunners(record);
    writeFileSync(join(record.worktree, "c.txt"), "c\n");
    const refusal = await failure(callAction("tasks.remove", { id: record.id }));
    expect([refusal.code, refusal.detail]).toEqual(["refused", { force: true }]);
    expect(await callAction("tasks.remove", { id: record.id, force: true })).toEqual({ removed: record.id, dropped: "0 unmerged commits (not on main) and uncommitted changes" });
  }, 30_000);

  test("cancel and retry of an interrupted task whose runner cannot start: failed", async () => {
    process.env.FAKE_PI_HOLD = "1";
    const repo = makeRepo();
    const record = await startTask(repo);
    await until(async () => (await stateOf(record)) === "running");
    await stopRunners(record);
    rmSync(record.worktree, { recursive: true, force: true });
    await expectError(callAction("tasks.cancel", { id: record.id }), "failed", `the runner of task ${record.id.slice(0, 8)} ended before it ran`);
    await expectError(callAction("tasks.retry", { id: record.id }), "failed", `the runner of task ${record.id.slice(0, 8)} ended before it ran`);
    expect(await callAction("tasks.remove", { id: record.id })).toEqual({ removed: record.id, dropped: null });
  }, 30_000);

  test("tasks.message: a runner that cannot start is failed, not refused", async () => {
    const repo = makeRepo();
    const record = await restingTask(repo, "blocked");
    process.env.PATH = testPath
      .split(":")
      .filter((dir) => !existsSync(join(dir, "bun")))
      .join(":");
    await expectError(callAction("tasks.message", { id: record.id, text: "hi" }), "failed", "bun is not on PATH");
  }, 30_000);

  test("tasks.timeline reads the session file from since on, not all of it", async () => {
    const record = fakeRecord(ID_1, "/r");
    await writeTask(record);
    const path = writeSession(record, []);
    // Sparse and larger than a Buffer can hold: reading the whole file fails.
    truncateSync(path, 2 ** 32 + 16);
    const since = statSync(path).size;
    const entry = { type: "custom", customType: "factory-state", timestamp: "t1", data: { state: "blocked", round: 1, reason: "gates" } };
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
    try {
      expect(await callAction("tasks.timeline", { id: ID_1, since })).toEqual({ entries: [{ at: "t1", kind: "state", data: entry.data }], next: statSync(path).size });
    } finally {
      rmSync(path, { force: true });
    }
  });
});

describe("task tags", () => {
  test("tasks.start: tag defaults to the system user, plan to null, kind is task; given ones are stored", async () => {
    const repo = makeRepo();
    const plain = (await callAction("tasks.start", { title: "Add b", request: "add b.txt" }, { cwd: repo })) as TaskView;
    expect([plain.tag, plain.plan, plain.kind]).toEqual([userInfo().username, null, "task"]);
    const tagged = (await callAction("tasks.start", { title: "Add c", request: "add c.txt", tag: "plugin/m1/w1", plan: "plan/plugin/m1/w1.md", kind: "task" }, { cwd: repo })) as TaskView;
    expect([tagged.tag, tagged.plan, tagged.kind]).toEqual(["plugin/m1/w1", "plan/plugin/m1/w1.md", "task"]);
    const stored = await recordOf(tagged);
    expect([stored.tag, stored.plan, stored.kind]).toEqual(["plugin/m1/w1", "plan/plugin/m1/w1.md", "task"]);
  }, 30_000);

  test("tasks.start refuses a malformed tag, an empty plan and an unknown kind before any worktree", async () => {
    const repo = makeRepo();
    for (const tag of ["", "a//b", "/a", "a/", "a b", "ä"]) {
      await expectError(callAction("tasks.start", { title: "t", request: "r", tag }, { cwd: repo }), "invalid", "is not segments of");
    }
    await expectError(callAction("tasks.start", { title: "t", request: "r", plan: " " }, { cwd: repo }), "invalid", "plan must not be empty");
    await expectError(callAction("tasks.start", { title: "t", request: "r", kind: "epic" }, { cwd: repo }), "invalid", 'kind "epic" is not "task" or "merge_request"');
    expect(await listTasks()).toEqual([]);
    expect(git(repo, "worktree", "list").split("\n")).toHaveLength(1);
  });

  test("a record written without tag, plan and kind still lists, with the defaults", async () => {
    const { tag: _tag, plan: _plan, kind: _kind, ...old } = fakeRecord(ID_1, "/r");
    mkdirSync(tasksDir(), { recursive: true });
    writeFileSync(join(tasksDir(), `${ID_1}.json`), JSON.stringify(old));
    const views = ((await callAction("tasks.list", {})) as { tasks: TaskView[] }).tasks;
    expect(views.map((view) => [view.id, view.tag, view.plan, view.kind])).toEqual([[ID_1, userInfo().username, null, "task"]]);
  });

  test("tasks.list tag: the tag itself and the tags under it, not a longer segment", async () => {
    await writeTask({ ...fakeRecord(ID_1, "/r"), tag: "a" });
    await writeTask({ ...fakeRecord(ID_2, "/r"), tag: "a/b" });
    await writeTask({ ...fakeRecord(ID_3, "/r"), tag: "ab" });
    const ids = async (tag: string) => ((await callAction("tasks.list", { tag })) as { tasks: TaskView[] }).tasks.map((view) => view.id);
    expect(await ids("a")).toEqual([ID_1, ID_2]);
    expect(await ids("a/b")).toEqual([ID_2]);
    expect(await ids("ab")).toEqual([ID_3]);
    expect(await ids("a/b/c")).toEqual([]);
    await expectError(callAction("tasks.list", { tag: "a/" }), "invalid", "is not segments of");
  });
});

describe("tasks.wait", () => {
  const stateEntry = (state: string) => ({ type: "custom", customType: "factory-state", timestamp: "t", data: { state, round: 1, reason: "r" } });

  /** A task tagged `tag`: resting in `state`, or starting (no session file) without one. */
  async function waitTask(id: string, tag: string, state?: string): Promise<TaskRecord> {
    const record = { ...fakeRecord(id, "/r"), tag };
    await writeTask(record);
    if (state !== undefined) writeSession(record, [stateEntry(state)]);
    return record;
  }

  type WaitResult = { tasks: TaskView[]; attention: string[]; timedOut: boolean };
  const wait = async (params: object) => (await callAction("tasks.wait", params)) as WaitResult;

  test("returns at once when every watched task rests; done needs no attention", async () => {
    await waitTask(ID_1, "w", "done");
    await waitTask(ID_2, "w", "cancelled");
    const started = Date.now();
    const result = await wait({ ids: [ID_1, ID_2.slice(0, 6)] });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect([result.tasks.map((view) => view.id), result.attention, result.timedOut]).toEqual([[ID_1, ID_2], [ID_2], false]);
    const done = await wait({ ids: [ID_1] });
    expect([done.attention, done.timedOut]).toEqual([[], false]);
  });

  test("returns when one task blocks while another has not finished", async () => {
    await waitTask(ID_1, "w");
    const blocking = await waitTask(ID_2, "w");
    setTimeout(() => writeSession(blocking, [stateEntry("blocked")]), 300);
    const result = await wait({ tag: "w", timeoutMs: 10_000 });
    expect(result.attention).toEqual([ID_2]);
    expect(result.timedOut).toBe(false);
    expect(result.tasks.map((view) => [view.id, view.state])).toEqual([
      [ID_1, null],
      [ID_2, "blocked"],
    ]);
  });

  test("tag: a task started during the wait is watched too", async () => {
    await waitTask(ID_1, "w/x");
    setTimeout(() => void waitTask(ID_2, "w/y", "waiting_approve"), 300);
    const result = await wait({ tag: "w", timeoutMs: 10_000 });
    expect([result.attention, result.timedOut]).toEqual([[ID_2], false]);
  });

  test("ignore leaves a task out of the watched ones", async () => {
    await waitTask(ID_1, "w");
    await waitTask(ID_2, "w", "done");
    const result = await wait({ tag: "w", ignore: [ID_1] });
    expect([result.tasks.map((view) => view.id), result.attention, result.timedOut]).toEqual([[ID_2], [], false]);
  });

  test("times out after timeoutMs while a task has not rested; no watched task answers at once", async () => {
    await waitTask(ID_1, "w");
    const started = Date.now();
    const result = await wait({ ids: [ID_1], timeoutMs: 1_000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_000);
    expect([result.tasks.map((view) => view.id), result.attention, result.timedOut]).toEqual([[ID_1], [], true]);
    expect(await wait({ tag: "nobody" })).toEqual({ tasks: [], attention: [], timedOut: false });
  });

  test("an abort ends the wait", async () => {
    await waitTask(ID_1, "w");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    await expectError(callAction("tasks.wait", { ids: [ID_1] }, { signal: controller.signal }), "failed", "tasks.wait was aborted");
  });

  test("invalid: ids and tag both or neither, empty ids, a timeout out of bounds", async () => {
    await waitTask(ID_1, "w", "done");
    await expectError(wait({}), "invalid", "tasks.wait needs exactly one of ids and tag");
    await expectError(wait({ ids: [ID_1], tag: "w" }), "invalid", "tasks.wait needs exactly one of ids and tag");
    await expectError(wait({ ids: [""] }), "invalid", "ids must hold non-empty strings");
    await expectError(wait({ ids: [ID_1], timeoutMs: 999 }), "invalid", "timeoutMs must be at least 1000");
    await expectError(wait({ ids: [ID_1], timeoutMs: 3_600_001 }), "invalid", "timeoutMs must be at most 3600000");
    expect(ACTIONS["tasks.wait"].mutates).toBe(false);
  });
});

describe("waiting_answer", () => {
  test("TaskView: the open question, actions message and cancel; timeline kind question; remove refused; tasks.wait needs attention", async () => {
    const record = fakeRecord(ID_1, "/r");
    await writeTask(record);
    const asked = [
      { type: "custom", customType: "factory-round", timestamp: "t1", data: { round: 1, trigger: "start" } },
      { type: "custom", customType: "factory-question", timestamp: "t2", data: { text: "Which table?" } },
      { type: "custom", customType: "factory-state", timestamp: "t3", data: { state: "waiting_answer", round: 1, reason: "question" } },
    ];
    const path = writeSession(record, asked);
    const view = (await callAction("tasks.get", { id: ID_1 })) as TaskView;
    expect([view.state, view.question, view.running, view.interrupted, view.actions]).toEqual(["waiting_answer", "Which table?", false, false, ["tasks.cancel", "tasks.message"]]);
    const timeline = (await callAction("tasks.timeline", { id: ID_1 })) as { entries: TimelineEntry[] };
    expect(timeline.entries[1]).toEqual({ at: "t2", kind: "question", data: { text: "Which table?" } });
    await expectError(callAction("tasks.remove", { id: ID_1, force: true }), "refused", "waits for the answer to its question");
    expect(await callAction("tasks.wait", { ids: [ID_1] })).toMatchObject({ attention: [ID_1], timedOut: false });

    appendFileSync(path, `${JSON.stringify({ type: "custom", customType: "factory-state", timestamp: "t4", data: { state: "blocked", round: 1, reason: "gates" } })}\n`);
    const answered = (await callAction("tasks.get", { id: ID_1 })) as TaskView;
    expect([answered.state, answered.question]).toEqual(["blocked", null]);
  });
});

describe("merge requests", () => {
  /** A repo with a branch `wave` one commit ahead of main, checked out nowhere. */
  function waveRepo(): string {
    const repo = makeRepo();
    git(repo, "checkout", "--quiet", "-b", "wave");
    writeFileSync(join(repo, "w.txt"), "w\n");
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "wave");
    git(repo, "checkout", "--quiet", "main");
    return repo;
  }
  const mergeRequest = (repo: string, more: Record<string, unknown> = {}) =>
    callAction("tasks.start", { title: "Merge wave", request: "Read plan/w.md", kind: "merge_request", source: "wave", overrides: { branch: "main" }, ...more }, { cwd: repo });

  test("tasks.start refuses a merge request without source, source on a task, source = target, a source checked out or missing, before any worktree", async () => {
    const repo = waveRepo();
    await expectError(mergeRequest(repo, { source: undefined }), "invalid", "a merge_request needs a source branch");
    await expectError(callAction("tasks.start", { title: "t", request: "r", source: "wave" }, { cwd: repo }), "invalid", "source is for a merge_request only");
    await expectError(mergeRequest(repo, { source: "main" }), "refused", "the source branch main is the target branch itself");
    await expectError(mergeRequest(repo, { source: "gone" }), "refused", "the source branch gone does not exist locally");
    const holder = join(caseDir, "holder");
    git(repo, "worktree", "add", "--quiet", holder, "wave");
    await expectError(mergeRequest(repo), "refused", `the source branch wave is checked out in ${holder}`);
    expect(await listTasks()).toEqual([]);
    expect(git(repo, "worktree", "list").split("\n")).toHaveLength(2);
  });

  test("a merge request's worktree checks the source out; message is refused and never offered; remove keeps the source branch", async () => {
    const repo = waveRepo();
    const wave = git(repo, "rev-parse", "wave");
    const view = (await mergeRequest(repo, { tag: "plugin/w2" })) as TaskView;
    expect([view.kind, view.branch, view.tag]).toEqual(["merge_request", "wave", "plugin/w2"]);
    const record = await recordOf(view);
    expect(git(record.worktree, "symbolic-ref", "--short", "HEAD")).toBe("wave");
    await until(async () => (await stateOf(record)) === "waiting_approve");
    await until(() => runnerEnded(record));
    expect(prompts()).toEqual(["prompt /factory start"]);

    const resting = (await callAction("tasks.get", { id: record.id })) as TaskView;
    expect(resting.actions).toEqual(["tasks.approve", "tasks.cancel", "tasks.remove"]);
    await expectError(callAction("tasks.message", { id: record.id, text: "hi" }), "refused", "is a merge request: it has no coder to message");
    expect(prompts()).toEqual(["prompt /factory start"]);

    // The wave's commit is not on main, yet removing drops nothing: the source branch stays.
    expect(await callAction("tasks.remove", { id: record.id })).toEqual({ removed: record.id, dropped: null });
    expect(existsSync(record.worktree)).toBe(false);
    expect(git(repo, "rev-parse", "wave")).toBe(wave);
    expect(await listTasks()).toEqual([]);
  });
});
