import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { messageTask, sendCommand, taskInboxPath } from "./launch.ts";
import { lastFactoryState } from "./runner.ts";
import { lockTask, taskLockPath, taskLogPath, unlockTask, type TaskRecord } from "./tasks.ts";

const savedEnv = { ...process.env };
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "factory-runner-test-")));
const RUNNER = join(import.meta.dir, "runner.ts");

/**
 * The fake `pi`: speaks the RPC lines the runner reads (prompt response, `agent_start`, `agent_settled`,
 * `entry_appended`), appends `factory-state` entries to `<session-dir>/<ts>_<session-id>.jsonl` and notes in
 * `$FAKE_PI_LOG` what happened, `eof <last state>` when its stdin closes.
 * A session file that exists already is appended to, as Pi does for a later command of the task.
 * FAKE_PI_MODE: `merge` (settled while merging, done 2.5 s later), `rest-before-settle` (blocked, settled 2.5 s
 * later), `early-exit` (exits before it answers), `stubborn` (ignores stdin EOF and SIGTERM), `approve` (answers with
 * no run, merging 2.5 s later, done 2.5 s after that), `cancel` (cancelled, then the answer), `retry` (answers, a run
 * starts 2.5 s later and ends blocked again), `refused` (a `factory:` error notify, then the answer, no entry),
 * `started` (the prompt went to the model: disposition `started`, a run, no entry), `dialog` (a confirm dialog that
 * waits for its response, then cancelled), `inbox` (a run that takes every follow-up prompt that comes in, noted as
 * `coder <text>`, until 1.5 s pass without one, then blocked), `plain` (as `inbox`, answered `started` and with the
 * `running` entry the plugin writes for a plain message). FAKE_PI_EXIT_DELAY: ms between stdin EOF and the exit. Every stdin line after the prompt is noted as
 * `stdin <line>`; a later prompt is answered `queued` during a run, else `started`.
 */
const fakeBin = join(scratch, "bin");
mkdirSync(fakeBin);
writeFileSync(
  join(fakeBin, "pi"),
  `#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const log = process.env.FAKE_PI_LOG;
const mode = process.env.FAKE_PI_MODE ?? "merge";
const note = (text) => appendFileSync(log, text + "\\n");
writeFileSync(log + ".pid", String(process.pid));
writeFileSync(log + ".env", process.env.FACTORY_TASK_SESSION ?? "");
note("argv " + JSON.stringify(args));
note("cwd " + process.cwd());
if (mode === "early-exit") process.exit(0);
if (mode === "stubborn") process.on("SIGTERM", () => note("sigterm ignored"));
const dir = args[args.indexOf("--session-dir") + 1];
const id = args[args.indexOf("--session-id") + 1];
mkdirSync(dir, { recursive: true });
const file = join(dir, "2026-01-01T00-00-00-000Z_" + id + ".jsonl");
if (!existsSync(file)) writeFileSync(file, JSON.stringify({ type: "session", version: 3, id, cwd: process.cwd() }) + "\\n");
let current = "none";
const state = (name) => {
  current = name;
  appendFileSync(file, JSON.stringify({ type: "custom", customType: "factory-state", data: { state: name, round: 1, reason: "r" } }) + "\\n");
  note("state " + name);
};
let agentRunning = false;
const emit = (record) => {
  if (record.type === "agent_start") agentRunning = true;
  if (record.type === "agent_settled") agentRunning = false;
  process.stdout.write(JSON.stringify(record) + "\\n");
};
const followUps = [];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let gotPrompt;
const prompt = new Promise((done) => (gotPrompt = done));
setInterval(() => {}, 1000);
const laterLines = [];
const nextLine = async () => {
  while (laterLines.length === 0) await sleep(20);
  return laterLines.shift();
};
(async () => {
  let buffer = "";
  let first = true;
  for await (const chunk of Bun.stdin.stream()) {
    buffer += new TextDecoder().decode(chunk);
    let newline;
    while ((newline = buffer.indexOf("\\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (first) gotPrompt(line);
      else {
        note("stdin " + line);
        laterLines.push(line);
        const command = JSON.parse(line);
        if (command.type === "prompt") {
          emit({ id: command.id, type: "response", command: "prompt", success: true, data: { disposition: agentRunning ? "queued" : "started" } });
          followUps.push(command.message);
        }
      }
      first = false;
    }
  }
  note("eof " + current);
  if (process.env.FAKE_PI_EXIT_DELAY) await sleep(Number(process.env.FAKE_PI_EXIT_DELAY));
  if (mode !== "stubborn") process.exit(0);
})();
note("prompt " + (await prompt));
const answer = () => emit({ id: "1", type: "response", command: "prompt", success: true, data: { disposition: "handled" } });
if (mode === "approve") {
  answer();
  await sleep(2500);
  state("merging");
  emit({ type: "entry_appended" });
  await sleep(2500);
  state("done");
  emit({ type: "entry_appended" });
  await new Promise(() => {});
}
if (mode === "cancel") {
  state("cancelled");
  answer();
  await new Promise(() => {});
}
if (mode === "refused") {
  emit({ type: "extension_ui_request", id: "n1", method: "notify", message: "factory: the task is not waiting for approve", notifyType: "error" });
  answer();
  await new Promise(() => {});
}
if (mode === "started") {
  emit({ id: "1", type: "response", command: "prompt", success: true, data: { disposition: "started" } });
  emit({ type: "agent_start" });
  await sleep(100);
  emit({ type: "agent_settled", aborted: false });
  await new Promise(() => {});
}
if (mode === "dialog") {
  emit({ type: "extension_ui_request", id: "d1", method: "confirm", title: "Really?", message: "sure" });
  await nextLine();
  state("cancelled");
  answer();
  await new Promise(() => {});
}
/** The run takes follow-ups until 1.5 s pass without one. */
const takeFollowUps = async () => {
  let quiet = 0;
  while (quiet < 15) {
    await sleep(100);
    if (followUps.length > 0) {
      note("coder " + followUps.shift());
      quiet = 0;
    } else quiet += 1;
  }
};
if (mode === "inbox" || mode === "plain") {
  if (mode === "plain") emit({ id: "1", type: "response", command: "prompt", success: true, data: { disposition: "started" } });
  else answer();
  emit({ type: "agent_start" });
  state("running");
  await takeFollowUps();
  state("blocked");
  note("settled");
  emit({ type: "agent_settled", aborted: false });
  await new Promise(() => {});
}
if (mode === "retry") {
  answer();
  await sleep(2500);
  emit({ type: "agent_start" });
  state("running");
  await sleep(100);
  state("blocked");
  note("settled");
  emit({ type: "agent_settled", aborted: false });
  await new Promise(() => {});
}
answer();
emit({ type: "agent_start" });
state("running");
await sleep(100);
if (mode === "rest-before-settle") {
  state("blocked");
  emit({ type: "entry_appended" });
  await sleep(2500);
  note("settled");
  emit({ type: "agent_settled", aborted: false });
} else {
  state("merging");
  note("settled");
  emit({ type: "agent_settled", aborted: false });
  await sleep(2500);
  state("done");
  emit({ type: "entry_appended" });
}
`,
);
chmodSync(join(fakeBin, "pi"), 0o755);

let caseCount = 0;
function newCase() {
  const dir = join(scratch, `case-${++caseCount}`);
  const worktree = join(dir, "worktree");
  mkdirSync(worktree, { recursive: true });
  return { dir, worktree, sessionDir: join(dir, "sessions"), sessionId: `session-${caseCount}`, inbox: join(dir, "task.inbox"), log: join(dir, "fake-pi.log") };
}

function startRunner(c: ReturnType<typeof newCase>, mode: string, message = "/factory start {}") {
  return Bun.spawn(["bun", RUNNER, c.worktree, c.sessionDir, c.sessionId, c.inbox, message], {
    env: { ...process.env, PATH: `${fakeBin}:${savedEnv.PATH}`, FAKE_PI_LOG: c.log, FAKE_PI_MODE: mode },
    stdout: "pipe",
    stderr: "pipe",
  });
}

/** A session file in which the task rests in `state`, as an earlier command left it. */
function restingIn(c: ReturnType<typeof newCase>, state: string) {
  mkdirSync(c.sessionDir, { recursive: true });
  const header = JSON.stringify({ type: "session", version: 3, id: c.sessionId, cwd: c.worktree });
  const entry = JSON.stringify({ type: "custom", customType: "factory-state", data: { state, round: 1, reason: "earlier" } });
  writeFileSync(join(c.sessionDir, `2026-01-01T00-00-00-000Z_${c.sessionId}.jsonl`), `${header}\n${entry}\n`);
}

function noted(c: ReturnType<typeof newCase>): string[] {
  return existsSync(c.log) ? readFileSync(c.log, "utf8").trim().split("\n") : [];
}

async function until(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(50);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runnersOf(dir: string): string {
  try {
    return execFileSync("pgrep", ["-f", dir], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("runner", () => {
  test("spawns pi in rpc mode in the worktree, no -e, and sends the message as prompt 1", async () => {
    const c = newCase();
    expect(await startRunner(c, "merge").exited).toBe(0);
    const lines = noted(c);
    expect(lines[0]).toBe(`argv ${JSON.stringify(["--mode", "rpc", "--session-dir", c.sessionDir, "--session-id", c.sessionId])}`);
    expect(lines[1]).toBe(`cwd ${c.worktree}`);
    expect(lines[2]).toBe(`prompt ${JSON.stringify({ id: "1", type: "prompt", message: "/factory start {}" })}`);
    // The factory tool in that Pi offers only the actions that change nothing (`tool.ts`).
    expect(readFileSync(`${c.log}.env`, "utf8")).toBe("1");
  }, 15_000);

  test("keeps stdin open while the settled task is merging, closes it once it is done", async () => {
    const c = newCase();
    expect(await startRunner(c, "merge").exited).toBe(0);
    expect(noted(c).slice(3)).toEqual(["state running", "state merging", "settled", "state done", "eof done"]);
    expect(await lastFactoryState(c.sessionDir, c.sessionId)).toEqual({ state: "done", round: 1, reason: "r" });
  }, 15_000);

  test("a resting state alone does not close stdin: only after agent_settled", async () => {
    const c = newCase();
    expect(await startRunner(c, "rest-before-settle").exited).toBe(0);
    expect(noted(c).slice(3)).toEqual(["state running", "state blocked", "settled", "eof blocked"]);
  }, 15_000);

  test("approve from waiting_approve: stays open while waiting_approve and merging, closes on done", async () => {
    const c = newCase();
    restingIn(c, "waiting_approve");
    expect(await startRunner(c, "approve", "/factory approve").exited).toBe(0);
    expect(noted(c).slice(3)).toEqual(["state merging", "state done", "eof done"]);
  }, 15_000);

  test("cancel: closes on cancelled", async () => {
    const c = newCase();
    restingIn(c, "waiting_approve");
    expect(await startRunner(c, "cancel", "/factory cancel").exited).toBe(0);
    expect(noted(c).slice(3)).toEqual(["state cancelled", "eof cancelled"]);
  }, 15_000);

  test("retry from blocked: stays open until the task has left blocked, closes when its run ends blocked again", async () => {
    const c = newCase();
    restingIn(c, "blocked");
    expect(await startRunner(c, "retry", "/factory retry").exited).toBe(0);
    expect(noted(c).slice(3)).toEqual(["state running", "state blocked", "settled", "eof blocked"]);
  }, 15_000);

  test("a factory command that reports an error: closes, the state untouched", async () => {
    const c = newCase();
    restingIn(c, "blocked");
    expect(await startRunner(c, "refused", "/factory approve").exited).toBe(0);
    expect(noted(c).slice(3)).toEqual(["eof none"]);
    expect(await lastFactoryState(c.sessionDir, c.sessionId)).toEqual({ state: "blocked", round: 1, reason: "earlier" });
  }, 15_000);

  test("a prompt pi did not handle as a command (no factory plugin): aborts, closes and exits 1", async () => {
    const c = newCase();
    const runner = startRunner(c, "started");
    expect(await runner.exited).toBe(1);
    expect(noted(c).slice(3)).toEqual(['stdin {"type":"abort"}', "eof none"]);
    expect(await new Response(runner.stderr).text()).toContain("disposition started");
  }, 15_000);

  test("a dialog of an extension is answered as cancelled", async () => {
    const c = newCase();
    restingIn(c, "waiting_approve");
    expect(await startRunner(c, "dialog", "/factory cancel").exited).toBe(0);
    expect(noted(c).slice(3)).toEqual(['stdin {"type":"extension_ui_response","id":"d1","cancelled":true}', "state cancelled", "eof cancelled"]);
  }, 15_000);

  test("pi exiting before it answers the prompt: non-zero exit", async () => {
    const c = newCase();
    const runner = startRunner(c, "early-exit");
    expect(await runner.exited).toBe(1);
    expect(await new Response(runner.stderr).text()).toContain("before it answered the prompt");
  }, 15_000);

  test("a plain message to a resting task: sent as a follow-up prompt, ends when the run it opened rests", async () => {
    const c = newCase();
    restingIn(c, "blocked");
    expect(await startRunner(c, "plain", "please also add tests").exited).toBe(0);
    const lines = noted(c);
    expect(lines[2]).toBe(`prompt ${JSON.stringify({ id: "1", type: "prompt", message: "please also add tests", streamingBehavior: "followUp" })}`);
    expect(lines.slice(3)).toEqual(["state running", "state blocked", "settled", "eof blocked"]);
  }, 15_000);

  test("a plain message pi runs without the factory plugin (no factory-state entry): aborts, closes and exits 1", async () => {
    const c = newCase();
    restingIn(c, "blocked");
    const runner = startRunner(c, "started", "hello");
    expect(await runner.exited).toBe(1);
    expect(noted(c).slice(3)).toEqual(['stdin {"type":"abort"}', "eof none"]);
    expect(await new Response(runner.stderr).text()).toContain("without the factory plugin");
  }, 15_000);

  test("an inbox line appended during the run: sent once as a follow-up, the runner ends after that run settles", async () => {
    const c = newCase();
    const runner = startRunner(c, "inbox");
    await until(() => noted(c).includes("state running"));
    appendFileSync(c.inbox, `${JSON.stringify({ text: "use tabs" })}\n`);
    expect(await runner.exited).toBe(0);
    const followUp = `stdin ${JSON.stringify({ id: "inbox-1", type: "prompt", message: "use tabs", streamingBehavior: "followUp" })}`;
    expect(noted(c).slice(3)).toEqual(["state running", followUp, "coder use tabs", "state blocked", "settled", "eof blocked"]);
    expect(readFileSync(`${c.inbox}.read`, "utf8").trim()).toBe(String(readFileSync(c.inbox).length));
  }, 15_000);

  test("an inbox line left after the runner ended: the next runner sends it, and only it", async () => {
    const c = newCase();
    const first = startRunner(c, "inbox");
    await until(() => noted(c).includes("state running"));
    appendFileSync(c.inbox, `${JSON.stringify({ text: "one" })}\n`);
    expect(await first.exited).toBe(0);
    appendFileSync(c.inbox, `${JSON.stringify({ text: "two" })}\n`);
    const next = { ...c, log: `${c.log}.next` };
    expect(await startRunner(next, "plain", "go on").exited).toBe(0);
    const stdin = noted(next).filter((line) => line.startsWith("stdin "));
    expect(stdin).toEqual([`stdin ${JSON.stringify({ id: "inbox-1", type: "prompt", message: "two", streamingBehavior: "followUp" })}`]);
    expect(noted(next).slice(3)).toEqual(["state running", stdin[0], "coder two", "state blocked", "settled", "eof blocked"]);
  }, 20_000);

  test("an inbox line that came after stdin closed: once pi exited at rest, a successor runner sends it and takes the lock", async () => {
    const c = newCase();
    const lock = join(c.dir, "task.lock");
    const runner = Bun.spawn(["bun", RUNNER, c.worktree, c.sessionDir, c.sessionId, c.inbox, "/factory start {}"], {
      env: { ...process.env, PATH: `${fakeBin}:${savedEnv.PATH}`, FAKE_PI_LOG: c.log, FAKE_PI_MODE: "merge", FAKE_PI_EXIT_DELAY: "1500", FACTORY_TASK_LOCK: lock },
    });
    writeFileSync(lock, `${runner.pid} 0\n`);
    await until(() => noted(c).includes("eof done"));
    appendFileSync(c.inbox, `${JSON.stringify({ text: "late" })}\n`);
    expect(await runner.exited).toBe(0);
    const prompt = `prompt ${JSON.stringify({ id: "1", type: "prompt", message: "late", streamingBehavior: "followUp" })}`;
    await until(() => noted(c).includes(prompt));
    const holder = Number(readFileSync(lock, "utf8").split(" ")[0]);
    expect(holder).not.toBe(runner.pid);
    expect(readFileSync(`${c.inbox}.read`, "utf8").trim()).toBe(String(readFileSync(c.inbox).length));
    await until(() => runnersOf(c.dir) === "", 15_000);
    expect(existsSync(lock)).toBe(false);
    expect(noted(c).filter((line) => line.startsWith("eof "))).toEqual(["eof done", "eof done"]);
  }, 30_000);

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    test(`${signal}: closes stdin, kills a pi that does not end, leaves no pi behind`, async () => {
      const c = newCase();
      const runner = startRunner(c, "stubborn");
      await until(() => noted(c).includes("state running"));
      const piPid = Number(readFileSync(`${c.log}.pid`, "utf8"));
      expect(alive(piPid)).toBe(true);
      runner.kill(signal);
      expect(await runner.exited).not.toBe(0);
      expect(noted(c)).toContain("eof running");
      await until(() => !alive(piPid), 2000);
    }, 15_000);
  }
});

describe("sendCommand", () => {
  test("starts the runner detached, its output in the task's log, hands it the task lock, and it ends with the task", async () => {
    const c = newCase();
    process.env.PI_CODING_AGENT_DIR = join(c.dir, "agent");
    process.env.PATH = `${fakeBin}:${savedEnv.PATH}`;
    process.env.FAKE_PI_LOG = c.log;
    process.env.FAKE_PI_MODE = "merge";
    const record: TaskRecord = {
      id: "00000000-0000-4000-8000-000000000001",
      repo: c.dir,
      worktree: c.worktree,
      branch: "t",
      title: "t",
      sessionId: c.sessionId,
      sessionDir: c.sessionDir,
      createdAt: new Date().toISOString(),
    };
    await lockTask(record.id);
    await sendCommand(record, "/factory approve");
    expect(existsSync(taskLogPath(record.id))).toBe(true);
    expect(readFileSync(taskLockPath(record.id), "utf8")).not.toStartWith(`${process.pid} `);
    await until(() => noted(c).includes("eof done"));
    expect(noted(c)[2]).toBe(`prompt ${JSON.stringify({ id: "1", type: "prompt", message: "/factory approve" })}`);
    await until(() => runnersOf(c.dir) === "");
    expect(existsSync(taskLockPath(record.id))).toBe(false);
  }, 15_000);
});

describe("messageTask", () => {
  function taskOf(c: ReturnType<typeof newCase>, mode: string): TaskRecord {
    process.env.PI_CODING_AGENT_DIR = join(c.dir, "agent");
    process.env.PATH = `${fakeBin}:${savedEnv.PATH}`;
    process.env.FAKE_PI_LOG = c.log;
    process.env.FAKE_PI_MODE = mode;
    return {
      id: `00000000-0000-4000-8000-${String(caseCount).padStart(12, "0")}`,
      repo: c.dir,
      worktree: c.worktree,
      branch: "t",
      title: "t",
      sessionId: c.sessionId,
      sessionDir: c.sessionDir,
      createdAt: new Date().toISOString(),
    };
  }

  test("a resting task: a new runner with the text as a plain prompt, the lock handed to it and gone when it ends", async () => {
    const c = newCase();
    restingIn(c, "blocked");
    const record = taskOf(c, "plain");
    await messageTask(record, "rename the flag");
    expect(readFileSync(taskLockPath(record.id), "utf8")).not.toStartWith(`${process.pid} `);
    await until(() => noted(c).includes("eof blocked"));
    expect(noted(c)[2]).toBe(`prompt ${JSON.stringify({ id: "1", type: "prompt", message: "rename the flag", streamingBehavior: "followUp" })}`);
    await until(() => runnersOf(c.dir) === "");
    expect(existsSync(taskLockPath(record.id))).toBe(false);
  }, 15_000);

  test("a running task: one inbox line, which its live runner sends as a follow-up", async () => {
    const c = newCase();
    const record = taskOf(c, "inbox");
    await lockTask(record.id);
    await sendCommand(record, "/factory start {}");
    await until(() => noted(c).includes("state running"));
    await messageTask(record, "keep it short");
    expect(readFileSync(taskInboxPath(record.id), "utf8")).toBe(`${JSON.stringify({ text: "keep it short" })}\n`);
    await until(() => noted(c).includes("eof blocked"));
    expect(noted(c).filter((line) => line.startsWith("coder "))).toEqual(["coder keep it short"]);
    await until(() => runnersOf(c.dir) === "");
  }, 15_000);

  test("a task whose lock another holds: refused as busy, no runner", async () => {
    const c = newCase();
    restingIn(c, "blocked");
    const record = taskOf(c, "plain");
    await lockTask(record.id);
    await expect(messageTask(record, "hi")).rejects.toThrow(`task ${record.id.slice(0, 8)} is busy`);
    expect(existsSync(c.log)).toBe(false);
    await unlockTask(record.id);
  });

  test("a merging task and a task without a state: refused, nothing written", async () => {
    const merging = newCase();
    restingIn(merging, "merging");
    const record = taskOf(merging, "plain");
    await expect(messageTask(record, "hi")).rejects.toThrow("is merging, send the message when the merge has ended");
    const fresh = taskOf(newCase(), "plain");
    await expect(messageTask(fresh, "hi")).rejects.toThrow("has not started yet");
    expect(existsSync(taskInboxPath(record.id))).toBe(false);
    expect(existsSync(taskLockPath(record.id))).toBe(false);
  });
});

describe("lastFactoryState", () => {
  const stateLine = (state: string, round: number, reason: string) => JSON.stringify({ type: "custom", customType: "factory-state", data: { state, round, reason } });

  test("the last factory-state entry of the session file whose name holds the session id", async () => {
    const sessionDir = join(scratch, "sessions-a");
    expect(await lastFactoryState(sessionDir, "session-s1")).toBeUndefined();
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "2026-01-01T00-00-00-000Z_session-other.jsonl"), `${stateLine("blocked", 9, "other")}\n`);
    writeFileSync(join(sessionDir, "2026-01-01T00-00-00-000Z_session-s1.jsonl"), `${JSON.stringify({ type: "session", version: 3, id: "session-s1" })}\n`);
    expect(await lastFactoryState(sessionDir, "session-s1")).toBeUndefined();
    const lines = [
      JSON.stringify({ type: "session", version: 3, id: "session-s1" }),
      stateLine("running", 1, "start"),
      JSON.stringify({ type: "custom", customType: "factory-round", data: { round: 1 } }),
      stateLine("merging", 1, "passed"),
      stateLine("done", 1, "merged"),
      '{"type":"custom","customType":"factory-state","data":{"state":"bl',
    ];
    writeFileSync(join(sessionDir, "2026-01-01T00-00-00-000Z_session-s1.jsonl"), lines.join("\n"));
    expect(await lastFactoryState(sessionDir, "session-s1")).toEqual({ state: "done", round: 1, reason: "merged" });
  });
});
