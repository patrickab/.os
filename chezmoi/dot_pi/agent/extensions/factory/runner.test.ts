import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendCommand } from "./launch.ts";
import { lastFactoryState } from "./runner.ts";
import { lockTask, taskLockPath, taskLogPath, type TaskRecord } from "./tasks.ts";

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
 * waits for its response, then cancelled). Every stdin line after the prompt is noted as `stdin <line>`.
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
const emit = (record) => process.stdout.write(JSON.stringify(record) + "\\n");
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
      }
      first = false;
    }
  }
  note("eof " + current);
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
  return { dir, worktree, sessionDir: join(dir, "sessions"), sessionId: `session-${caseCount}`, log: join(dir, "fake-pi.log") };
}

function startRunner(c: ReturnType<typeof newCase>, mode: string, message = "/factory start {}") {
  return Bun.spawn(["bun", RUNNER, c.worktree, c.sessionDir, c.sessionId, message], {
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
