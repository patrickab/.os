/**
 * The detached process that runs one command of a factory task in its Pi session, then lets Pi end.
 *
 * `bun runner.ts <worktree> <sessionDir> <sessionId> <message>`
 *
 * - Spawns `pi --mode rpc --session-dir <sessionDir> --session-id <sessionId>` in the worktree (Pi loads the
 *   factory plugin from its extensions dir by itself) and sends `message` as the prompt
 * - Closes Pi's stdin once Pi answered the prompt, no agent run is active (`agent_start` .. `agent_settled`) and the task
 *   rests (`RESTING_STATES`). `/factory approve` and `/factory retry` start at rest, so for them the task must first
 *   have left that rest: a `factory-state` entry written after the runner started. A `factory: ...` error notify before
 *   the answer means the command refused and changed nothing: stdin closes once no run is active. The merge runs after
 *   the settle, so the check repeats on every event and every `CHECK_INTERVAL_MS`
 * - A prompt Pi did not handle as a command (disposition other than `handled`: the factory plugin is not loaded, so the
 *   text went to the model) is refused: the runner sends `abort`, closes stdin and exits 1
 * - A dialog an extension opens (`select`, `confirm`, `input`, `editor`) is answered as cancelled: nobody is there
 * - `FACTORY_TASK_LOCK`: the task lock (`tasks.ts`) handed to this runner, removed when it exits if it still names it
 * - SIGTERM/SIGINT: closes Pi's stdin and kills Pi after `KILL_GRACE_MS`. Exit code = Pi's; 1 when Pi exited before it
 *   answered the prompt or refused it
 * - Imports nothing outside node built-ins and the plain plugin modules: the deployed plugin has no `node_modules`
 */
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { RESTING_STATES, type StateData } from "./state.ts";
import { errorText, isRecord } from "./util.ts";

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
const CHECK_INTERVAL_MS = 2000;
const KILL_GRACE_MS = 3000;
const PROMPT_ID = "1";

/** The session file Pi writes for `sessionId` in `sessionDir` (`<timestamp>_<sessionId>.jsonl`), if it exists yet. */
export async function sessionFilePath(sessionDir: string, sessionId: string): Promise<string | undefined> {
  let names: string[];
  try {
    names = await readdir(sessionDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const name = names.find((file) => file.endsWith(".jsonl") && file.includes(sessionId));
  return name === undefined ? undefined : join(sessionDir, name);
}

function isStateData(value: unknown): value is StateData {
  return isRecord(value) && typeof value.state === "string" && typeof value.round === "number" && typeof value.reason === "string";
}

/** The `factory-state` entries of a session file so far: how many, and the data of the last one. */
export interface FactoryStates {
  count: number;
  last: StateData | undefined;
}

/** The data of the session file's `custom` entries of `customType`, in order, none before the file exists. A torn line is skipped. */
async function customEntryData(sessionDir: string, sessionId: string, customType: string): Promise<unknown[]> {
  const path = await sessionFilePath(sessionDir, sessionId);
  if (path === undefined) return [];
  const data: unknown[] = [];
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    if (!line.includes(`"${customType}"`)) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (isRecord(entry) && entry.type === "custom" && entry.customType === customType) data.push(entry.data);
  }
  return data;
}

/** The `factory-state` entries of the session file, none before the file exists. */
export async function readFactoryStates(sessionDir: string, sessionId: string): Promise<FactoryStates> {
  const states = (await customEntryData(sessionDir, sessionId, "factory-state")).filter(isStateData);
  return { count: states.length, last: states.at(-1) };
}

/** `mainBranch` of the session's `factory-task` entry: the branch the task merges into. `undefined` before it is written. */
export async function taskMainBranch(sessionDir: string, sessionId: string): Promise<string | undefined> {
  const task = (await customEntryData(sessionDir, sessionId, "factory-task")).find((data) => isRecord(data) && typeof data.mainBranch === "string");
  return isRecord(task) ? (task.mainBranch as string) : undefined;
}

/** The data of the last `factory-state` entry of the session file, `undefined` before the first. */
export async function lastFactoryState(sessionDir: string, sessionId: string): Promise<StateData | undefined> {
  return (await readFactoryStates(sessionDir, sessionId)).last;
}

/** The commands that start from a resting state and must leave it before the runner may end. */
const LEAVES_REST = /^\/factory\s+(approve|retry)(\s|$)/;

/** Runs the command to the task's rest and resolves with the runner's exit code. */
export async function runTaskCommand(worktree: string, sessionDir: string, sessionId: string, message: string): Promise<number> {
  const startCount = (await readFactoryStates(sessionDir, sessionId)).count;
  const mustLeave = LEAVES_REST.test(message.trim());
  const pi = Bun.spawn(["pi", "--mode", "rpc", "--session-dir", sessionDir, "--session-id", sessionId], {
    cwd: worktree,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  let answered = false;
  let refused = false;
  /** The factory command reported an error before Pi answered: it changed nothing and starts no run. */
  let commandFailed = false;
  let runActive = false;
  let stdinClosed = false;
  let checking = false;

  const send = (record: Record<string, unknown>) => {
    if (stdinClosed) return;
    try {
      pi.stdin.write(`${JSON.stringify(record)}\n`);
      void pi.stdin.flush();
    } catch {
      // Pi is already gone
    }
  };
  const closeStdin = () => {
    if (stdinClosed) return;
    stdinClosed = true;
    try {
      void pi.stdin.end();
    } catch {
      // Pi is already gone
    }
  };
  const checkRest = async () => {
    if (!answered || runActive || stdinClosed || checking) return;
    checking = true;
    try {
      if (commandFailed) return closeStdin();
      const { count, last } = await readFactoryStates(sessionDir, sessionId);
      const resting = last !== undefined && RESTING_STATES.includes(last.state);
      const left = !mustLeave || count > startCount;
      if (!runActive && resting && left) closeStdin();
    } catch (error) {
      console.error(`runner: reading the session state: ${errorText(error)}`);
    } finally {
      checking = false;
    }
  };
  const onRecord = (record: unknown) => {
    if (!isRecord(record)) return;
    if (record.type === "response" && record.id === PROMPT_ID) {
      answered = true;
      const disposition = isRecord(record.data) ? record.data.disposition : undefined;
      if (record.success !== true) {
        refused = true;
        console.error(`runner: pi refused the prompt: ${String(record.error)}`);
        closeStdin();
      } else if (disposition !== "handled") {
        refused = true;
        console.error(`runner: pi did not run the prompt as a command (disposition ${String(disposition)}): is the factory plugin in its extensions dir?`);
        send({ type: "abort" });
        closeStdin();
      }
    } else if (record.type === "agent_start") {
      runActive = true;
    } else if (record.type === "agent_settled") {
      runActive = false;
    } else if (record.type === "extension_ui_request" && typeof record.method === "string" && DIALOG_METHODS.has(record.method)) {
      send({ type: "extension_ui_response", id: record.id, cancelled: true });
    } else if (!answered && record.type === "extension_ui_request" && record.method === "notify" && record.notifyType === "error") {
      const text = String(record.message);
      console.error(`runner: ${text}`);
      if (text.startsWith("factory: ")) commandFailed = true;
    }
    void checkRest();
  };

  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = (signal: NodeJS.Signals) => {
    console.error(`runner: ${signal}, stopping pi`);
    closeStdin();
    killTimer ??= setTimeout(() => pi.kill("SIGKILL"), KILL_GRACE_MS);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const tick = setInterval(() => void checkRest(), CHECK_INTERVAL_MS);

  send({ id: PROMPT_ID, type: "prompt", message });

  // Records are split on LF only: a JSON string may hold U+2028/U+2029.
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of pi.stdout) {
    pending += decoder.decode(chunk, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
      if (line.trim() === "") continue;
      try {
        onRecord(JSON.parse(line));
      } catch {
        console.error(`runner: not a protocol record: ${line.slice(0, 200)}`);
      }
    }
  }
  const exitCode = await pi.exited;
  clearInterval(tick);
  clearTimeout(killTimer);
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
  if (!answered) {
    console.error(`runner: pi exited (${exitCode}) before it answered the prompt`);
    return exitCode === 0 ? 1 : exitCode;
  }
  if (refused && exitCode === 0) return 1;
  return exitCode;
}

/** Removes the task lock handed to this runner, unless it names another holder by now. */
async function releaseTaskLock(): Promise<void> {
  const path = process.env.FACTORY_TASK_LOCK;
  if (path === undefined || path === "") return;
  const text = await readFile(path, "utf8").catch(() => "");
  if (text.split(" ")[0] === String(process.pid)) await rm(path, { force: true });
}

if (import.meta.main) {
  const [worktree, sessionDir, sessionId, message] = process.argv.slice(2);
  if (!worktree || !sessionDir || !sessionId || message === undefined) {
    console.error("usage: bun runner.ts <worktree> <sessionDir> <sessionId> <message>");
    process.exit(2);
  }
  runTaskCommand(worktree, sessionDir, sessionId, message)
    .catch((error: unknown) => {
      console.error(`runner: ${errorText(error)}`);
      return 1;
    })
    .then(async (code) => {
      await releaseTaskLock().catch((error: unknown) => console.error(`runner: releasing the task lock: ${errorText(error)}`));
      process.exit(code);
    });
}
