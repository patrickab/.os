import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostLiveness, joinQueue, leaveQueue, procAlive, queueAhead, signalAlive, type Liveness } from "./queue.ts";

const scratch = mkdtempSync(join(tmpdir(), "factory-queue-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The pid of a process that ran and has exited. */
async function deadPid(): Promise<number> {
  const child = Bun.spawn(["true"]);
  await child.exited;
  return child.pid;
}

const HAS_PROC = existsSync("/proc/self/stat");
const ownStart = () => readFileSync(`/proc/${process.pid}/stat`, "utf8").split(") ")[1]!.split(" ")[19]!;

describe("signalAlive (no /proc)", () => {
  test("a running process is alive, an exited one and an invalid pid are not", async () => {
    expect(await signalAlive(process.pid)).toBe(true);
    expect(await signalAlive(await deadPid())).toBe(false);
    expect(await signalAlive(Number.NaN)).toBe(false);
    expect(await signalAlive(0)).toBe(false);
  });
});

describe.if(HAS_PROC)("procAlive (/proc)", () => {
  test("alive only when the pid runs with the ticket's start time: a reused pid is dead", async () => {
    expect(await procAlive(process.pid, ownStart())).toBe(true);
    expect(await procAlive(process.pid, "1")).toBe(false);
    expect(await procAlive(await deadPid(), ownStart())).toBe(false);
  });

  test("is the host's liveness where /proc exists", () => {
    expect(hostLiveness).toBe(procAlive);
  });
});

describe("queueAhead", () => {
  test("a ticket of this process names its pid, and the host liveness keeps it", async () => {
    const gitDir = mkdtempSync(join(scratch, "own-"));
    const first = await joinQueue(gitDir);
    await Bun.sleep(2);
    const second = await joinQueue(gitDir);
    expect(first.name.split("-")[1]).toBe(String(process.pid));
    expect(await queueAhead(second)).toBe(1);
    await leaveQueue(first);
    expect(await queueAhead(second)).toBe(0);
  });

  test("a dead holder's ticket is dropped, a live one counts, with the liveness passed in", async () => {
    const gitDir = mkdtempSync(join(scratch, "injected-"));
    const dir = join(gitDir, "factory-merge-queue");
    const mine = await joinQueue(gitDir);
    writeFileSync(join(dir, "000000000000001-111-0-dead"), "");
    writeFileSync(join(dir, "000000000000002-222-0-live"), "");
    const asked: [number, string][] = [];
    const alive: Liveness = async (pid, start) => {
      asked.push([pid, start]);
      return pid === 222;
    };

    expect(await queueAhead(mine, alive)).toBe(1);
    expect(asked).toEqual([
      [111, "0"],
      [222, "0"],
    ]);
    expect(readdirSync(dir).sort()).toEqual(["000000000000002-222-0-live", mine.name]);
  });

  test("signalAlive as the liveness drops the ticket of an exited process", async () => {
    const gitDir = mkdtempSync(join(scratch, "signal-"));
    const dir = join(gitDir, "factory-merge-queue");
    const mine = await joinQueue(gitDir);
    const dead = `000000000000001-${await deadPid()}-0-dead`;
    const live = `000000000000002-${process.pid}-0-live`;
    writeFileSync(join(dir, dead), "");
    writeFileSync(join(dir, live), "");

    expect(await queueAhead(mine, signalAlive)).toBe(1);
    expect(readdirSync(dir)).not.toContain(dead);
    expect(readdirSync(dir)).toContain(live);
  });
});
