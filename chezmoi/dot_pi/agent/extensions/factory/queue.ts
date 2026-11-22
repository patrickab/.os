/**
 * The merge queue of a repository: who may run the merge gates and move the target next. Shared by every task of the
 * repository, each in its own Pi process, through files in its git directory (`<git common dir>/factory-merge-queue`).
 *
 * - `joinQueue` writes a ticket named `<time>-<pid>-<start time>-<random>`: first come, first served. The start time
 *   is `0` where there is no `/proc`
 * - `queueAhead` is how many live tickets are older than one's own. 0 means it is the ticket's turn. A ticket whose
 *   owner process no longer runs (a crashed session) is removed on the way. With `/proc` the pid and its start time
 *   must match, which also catches a reused pid (`procAlive`); without it (macOS) the pid must answer signal 0
 *   (`signalAlive`)
 * - `leaveQueue` removes a ticket. A merge leaves when it merged, failed, conflicted or was cancelled
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const QUEUE_DIR = "factory-merge-queue";

export interface Ticket {
  path: string;
  name: string;
}

/** Whether the process `pid`, started at `start` (as its ticket names it), still runs. */
export type Liveness = (pid: number, start: string) => Promise<boolean>;

/** Start time of the running process `pid` from `/proc/<pid>/stat`, which a reused pid never repeats; null when it does not run. */
export async function procStart(pid: number): Promise<string | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    // The fields after the name in parentheses (which may hold spaces), start time is the 20th of them.
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

/** Liveness from `/proc`: the pid runs and its start time is the ticket's. */
export async function procAlive(pid: number, start: string): Promise<boolean> {
  return (await procStart(pid)) === start;
}

/** Liveness without `/proc`: the pid answers signal 0. Alive unless the pid does not exist (`EPERM` is someone else's process). */
export async function signalAlive(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

const HAS_PROC = existsSync("/proc/self/stat");

/** `procAlive` where `/proc` exists, else `signalAlive`. */
export const hostLiveness: Liveness = HAS_PROC ? procAlive : signalAlive;

/** A ticket of this process in the queue of the repository whose git common dir is `gitDir`. */
export async function joinQueue(gitDir: string): Promise<Ticket> {
  const dir = join(gitDir, QUEUE_DIR);
  await mkdir(dir, { recursive: true });
  const owner = `${process.pid}-${(await procStart(process.pid)) ?? "0"}`;
  const name = `${String(Date.now()).padStart(15, "0")}-${owner}-${randomUUID().slice(0, 8)}`;
  await writeFile(join(dir, name), "");
  return { path: join(dir, name), name };
}

/** How many live tickets are ahead of `ticket`, removing those whose owner no longer runs. */
export async function queueAhead(ticket: Ticket, alive: Liveness = hostLiveness): Promise<number> {
  const dir = join(ticket.path, "..");
  let ahead = 0;
  for (const name of (await readdir(dir)).sort()) {
    if (name >= ticket.name) continue;
    const [, pid = "", start = ""] = name.split("-");
    if (!(await alive(Number(pid), start))) {
      await rm(join(dir, name), { force: true });
      continue;
    }
    ahead += 1;
  }
  return ahead;
}

export async function leaveQueue(ticket: Ticket): Promise<void> {
  await rm(ticket.path, { force: true });
}
