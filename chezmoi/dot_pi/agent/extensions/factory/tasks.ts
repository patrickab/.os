/**
 * The factory's own list of tasks, kept outside any Pi session.
 *
 * - Provides `TaskRecord`, one JSON file per task in `<factoryHome>/tasks/<id>.json`, written atomically
 *   (`writeTask`), read back (`listTasks`) and removed with its runner log and lock (`removeTask`). Only a file named
 *   after the task id in it, of the shape `crypto.randomUUID` makes, counts as a task
 * - Provides the task lock `<id>.lock` (`lockTask`, `handTaskLock`, `unlockTask`): whoever checks a task's state and
 *   then acts on it (spawns a runner, deletes the task) holds it, and a spawned runner holds it until it exits. The
 *   file holds `<pid> <start time>` of its holder; a holder that no longer runs (`hostLiveness`) leaves a stale lock
 *   the next `lockTask` takes over
 */
import { link, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hostLiveness, procStart } from "./queue.ts";
import { factoryHome } from "./settings.ts";
import { errorText, isRecord } from "./util.ts";

export interface TaskRecord {
  id: string;
  /** The primary checkout's absolute path. */
  repo: string;
  worktree: string;
  /** The task's own branch, checked out in `worktree`. */
  branch: string;
  title: string;
  /** Pi's `--session-id`: the session file in `sessionDir` has it in its name. */
  sessionId: string;
  sessionDir: string;
  /** ISO timestamp. */
  createdAt: string;
}

const RECORD_KEYS = ["id", "repo", "worktree", "branch", "title", "sessionId", "sessionDir", "createdAt"] as const;
/** The shape of `crypto.randomUUID()`: a task id never holds a path separator. */
const TASK_ID = /^[0-9a-f-]{36}$/;

export function tasksDir(): string {
  return join(factoryHome(), "tasks");
}

function taskPath(id: string): string {
  return join(tasksDir(), `${id}.json`);
}

/** Where the detached runner of a task writes its stdout and stderr. */
export function taskLogPath(id: string): string {
  return join(tasksDir(), `${id}.log`);
}

export function taskLockPath(id: string): string {
  return join(tasksDir(), `${id}.lock`);
}

function parseTaskRecord(raw: unknown, id: string): TaskRecord {
  if (!isRecord(raw)) throw new Error("the record is not an object");
  for (const key of RECORD_KEYS) {
    if (typeof raw[key] !== "string" || raw[key] === "") throw new Error(`${key} must be a non-empty string`);
  }
  if (raw.id !== id) throw new Error(`id ${String(raw.id)} is not the file's name`);
  const record = {} as Record<(typeof RECORD_KEYS)[number], string>;
  for (const key of RECORD_KEYS) record[key] = raw[key] as string;
  return record;
}

/** Temp file in the same directory + rename: a reader sees the old record or the new one, never half of one. */
export async function writeTask(record: TaskRecord): Promise<void> {
  await mkdir(tasksDir(), { recursive: true });
  const path = taskPath(record.id);
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** The record in `<id>.json`. Throws an `Error` naming the file when `id` is no task id or the file is invalid. */
async function readTask(id: string): Promise<TaskRecord> {
  const path = taskPath(id);
  if (!TASK_ID.test(id)) throw new Error(`${path}: ${id} is not a task id`);
  try {
    return parseTaskRecord(JSON.parse(await readFile(path, "utf8")), id);
  } catch (error) {
    throw new Error(`${path}: ${errorText(error)}`);
  }
}

/** Every task, oldest first; only those of `repo` when given. Files that are no valid task record are skipped. */
export async function listTasks(repo?: string): Promise<TaskRecord[]> {
  let names: string[];
  try {
    names = await readdir(tasksDir());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: TaskRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const record = await readTask(name.slice(0, -".json".length)).catch(() => undefined);
    if (record !== undefined && (repo === undefined || record.repo === repo)) records.push(record);
  }
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Removes the record, its runner log and its lock. The worktree, branch and session file stay. */
export async function removeTask(id: string): Promise<void> {
  await rm(taskPath(id), { force: true });
  await rm(taskLogPath(id), { force: true });
  await rm(taskLockPath(id), { force: true });
}

async function lockOwner(pid: number): Promise<string> {
  return `${pid} ${(await procStart(pid)) ?? "0"}\n`;
}

/** Whether the lock file's holder still runs; a missing or unreadable file has none. */
async function lockHeld(path: string): Promise<boolean> {
  const text = await readFile(path, "utf8").catch(() => "");
  const [pid = "", start = ""] = text.trim().split(" ");
  return pid !== "" && (await hostLiveness(Number(pid), start));
}

/** Takes the task's lock for this process. Throws an `Error` of one sentence while a live process holds it. */
export async function lockTask(id: string): Promise<void> {
  await mkdir(tasksDir(), { recursive: true });
  const path = taskLockPath(id);
  // Written in full first, then linked: `link` fails on an existing lock, and no reader sees a half-written one.
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, await lockOwner(process.pid), "utf8");
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await link(temp, path);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if (await lockHeld(path)) break;
      await rm(path, { force: true });
    }
  } finally {
    await rm(temp, { force: true });
  }
  throw new Error(`task ${id.slice(0, 8)} is busy: another factory action or its runner holds it, try again once it has ended`);
}

/** Passes the lock this process holds to the process `pid` (a runner it spawned), which removes it when it exits. */
export async function handTaskLock(id: string, pid: number): Promise<void> {
  const path = taskLockPath(id);
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temp, await lockOwner(pid), "utf8");
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** Removes the task's lock if this process holds it; a lock handed to a runner stays. */
export async function unlockTask(id: string): Promise<void> {
  const path = taskLockPath(id);
  const text = await readFile(path, "utf8").catch(() => "");
  if (text.split(" ")[0] === String(process.pid)) await rm(path, { force: true });
}
