import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { factoryHome } from "./settings.ts";
import { listTasks, lockTask, removeTask, TaskBusyError, taskLockPath, taskLogPath, tasksDir, unlockTask, writeTask, type TaskRecord } from "./tasks.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "factory-tasks-test-")));
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(scratch, "agent");

afterAll(() => {
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  rmSync(scratch, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(scratch, "agent"), { recursive: true, force: true });
});

/** A task id of the shape `crypto.randomUUID` makes, `n` in its last digits. */
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
const ONE = uuid(1);

function record(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    repo: "/repo/a",
    worktree: `/worktrees/a/${id}`,
    branch: `task-${id}`,
    title: `Task ${id}`,
    sessionId: `session-${id}`,
    sessionDir: join(scratch, "sessions"),
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("task records", () => {
  test("live in <factoryHome>/tasks/<id>.json under PI_CODING_AGENT_DIR", async () => {
    await writeTask(record(ONE));
    expect(factoryHome()).toBe(join(scratch, "agent", "factory"));
    expect(readdirSync(tasksDir())).toEqual([`${ONE}.json`]);
    expect(await listTasks()).toEqual([record(ONE)]);
  });

  test("a rewrite replaces the record and leaves no temp file", async () => {
    await writeTask(record(ONE));
    await writeTask(record(ONE, { title: "Renamed" }));
    expect((await listTasks()).map((task) => task.title)).toEqual(["Renamed"]);
    expect(readdirSync(tasksDir())).toEqual([`${ONE}.json`]);
  });

  test("listTasks: oldest first, filtered by repo, skips invalid and temp files", async () => {
    expect(await listTasks()).toEqual([]);
    const [late, early, other] = [uuid(2), uuid(3), uuid(4)];
    await writeTask(record(late, { createdAt: "2026-03-01T00:00:00.000Z" }));
    await writeTask(record(early, { createdAt: "2026-02-01T00:00:00.000Z" }));
    await writeTask(record(other, { repo: "/repo/b" }));
    writeFileSync(join(tasksDir(), `${uuid(5)}.json`), "{");
    writeFileSync(join(tasksDir(), `${uuid(6)}.json`), JSON.stringify({ id: uuid(6) }));
    writeFileSync(join(tasksDir(), "x.json.1.tmp"), "{}");
    expect((await listTasks()).map((task) => task.id)).toEqual([other, early, late]);
    expect((await listTasks("/repo/a")).map((task) => task.id)).toEqual([early, late]);
  });

  test("listTasks skips a record whose id is not a task id or not its file name", async () => {
    mkdirSync(tasksDir(), { recursive: true });
    const write = (name: string, id: string) => writeFileSync(join(tasksDir(), `${name}.json`), JSON.stringify(record(id)));
    write(uuid(7), "../../x");
    write(uuid(8), uuid(9));
    write("one", "one");
    await writeTask(record(ONE));
    expect((await listTasks()).map((task) => task.id)).toEqual([ONE]);
  });

  test("removeTask removes the record, its log and its lock, and tolerates a missing one", async () => {
    await writeTask(record(ONE));
    writeFileSync(taskLogPath(ONE), "log");
    await lockTask(ONE);
    await removeTask(ONE);
    expect(readdirSync(tasksDir())).toEqual([]);
    await removeTask(ONE);
  });
});

describe("task lock", () => {
  test("one holder at a time; this process holds it until it unlocks", async () => {
    await lockTask(ONE);
    expect(readFileSync(taskLockPath(ONE), "utf8")).toStartWith(`${process.pid} `);
    await expect(lockTask(ONE)).rejects.toThrow(`task ${ONE.slice(0, 8)} is busy`);
    await expect(lockTask(ONE)).rejects.toBeInstanceOf(TaskBusyError);
    await unlockTask(ONE);
    expect(existsSync(taskLockPath(ONE))).toBe(false);
    await lockTask(ONE);
    await unlockTask(ONE);
  });

  test("a lock whose holder no longer runs is taken over; unlock leaves another holder's lock alone", async () => {
    mkdirSync(tasksDir(), { recursive: true });
    writeFileSync(taskLockPath(ONE), "2147483646 0\n");
    await lockTask(ONE);
    writeFileSync(taskLockPath(ONE), "1 0\n");
    await unlockTask(ONE);
    expect(readFileSync(taskLockPath(ONE), "utf8")).toBe("1 0\n");
  });
});
