/**
 * The `factory_new_task` tool as `index.ts` registers and gates it, against a fake `pi`/`ctx` on a throwaway repo.
 * `tasks.start` is replaced by a recorder: no task, runner or Pi starts.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { newTaskDeps } from "./followup.ts";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "factory-followup-tool-test-")));
process.env.PI_CODING_AGENT_DIR = join(scratch, "agent");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const started: { name: string; params: unknown }[] = [];
const realStart = newTaskDeps.callAction;
afterAll(() => {
  newTaskDeps.callAction = realStart;
});
newTaskDeps.callAction = (async (name: string, params: unknown) => {
  started.push({ name, params });
  return { id: `0000000${started.length}-0000-0000-0000-000000000000` };
}) as typeof realStart;
const { default: factory } = await import("./index.ts");

function gitIn(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

let counter = 0;
function repoWithTask(): { repo: string; worktree: string; merged: string } {
  counter += 1;
  const repo = join(scratch, `repo-${counter}`);
  mkdirSync(repo);
  gitIn(repo, "init", "--quiet", "--initial-branch", "main");
  gitIn(repo, "config", "user.name", "Factory Test");
  gitIn(repo, "config", "user.email", "factory@test.invalid");
  writeFileSync(join(repo, "factory.yaml"), "gates: []\n");
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "--quiet", "-m", "base");
  const worktree = join(scratch, `wt-${counter}`);
  gitIn(repo, "worktree", "add", "--quiet", "-b", "task", worktree);
  writeFileSync(join(worktree, "a.txt"), "a\n");
  gitIn(worktree, "add", "a.txt");
  gitIn(worktree, "commit", "--quiet", "-m", "feat: add a");
  gitIn(repo, "merge", "--quiet", "--ff-only", "task");
  return { repo, worktree, merged: gitIn(repo, "rev-parse", "main") };
}

interface Tool {
  name: string;
  execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<{ isError?: boolean; content: { text: string }[] }>;
}

function session(cwd: string, branch: { customType: string; data: unknown }[]) {
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const tools = new Map<string, Tool>();
  const entries: { customType: string; data: any }[] = [];
  const pi = {
    registerCommand: () => undefined,
    registerTool: (tool: Tool) => tools.set(tool.name, tool),
    on: (name: string, handler: (event: any, ctx: any) => unknown) => handlers.set(name, handler),
    appendEntry: (customType: string, data: unknown) => entries.push({ customType, data }),
    sendUserMessage: () => undefined,
    sendMessage: () => undefined,
    setModel: async () => true,
  };
  const ctx = {
    cwd,
    isIdle: () => true,
    abort: () => undefined,
    hasPendingMessages: () => false,
    ui: { setStatus: () => undefined, notify: () => undefined },
    model: undefined,
    modelRegistry: { find: () => undefined },
    sessionManager: { getSessionId: () => "tool-session", getBranch: () => branch.map((entry) => ({ type: "custom", ...entry })) },
  };
  factory(pi as unknown as ExtensionAPI);
  const emit = (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx);
  const sections: Record<string, string> = {};
  return {
    tools,
    entries,
    sections,
    emit,
    /** A user message that opens a run, as Pi sends it: `input`, then `before_agent_start`. */
    message: async () => {
      await emit("input", { text: "also do x", source: "rpc" });
      await emit("before_agent_start", { messageType: "user", systemPromptOptions: { sections } });
    },
    newTask: (params: unknown) => tools.get("factory_new_task")!.execute("call", params, undefined, undefined, ctx),
  };
}

const custom = (customType: string, data: unknown) => ({ customType, data });
const taskEntry = (mainBranch = "main", merge = "auto") =>
  custom("factory-task", { title: "Add a", request: "add a", settings: { branch: mainBranch, merge, maxRounds: 3, review: false, models: {} }, branch: "task", mainBranch, baseSha: "x" });
const mergedSession = (worktree: string, merged: string, mainBranch = "main", merge = "auto") =>
  session(worktree, [
    taskEntry(mainBranch, merge),
    custom("factory-round", { round: 1, trigger: "start" }),
    custom("factory-merge", { ok: true, commit: merged, error: null, depsSynced: false }),
    custom("factory-state", { state: "done", round: 1, reason: "merged" }),
  ]);

describe("factory_new_task", () => {
  test("is registered in a task session only", async () => {
    const plain = session(scratch, []);
    await plain.emit("session_start");
    expect([...plain.tools.keys()]).toEqual(["factory"]);
  });

  test("works in a follow-up run on a merged task, once per user message", async () => {
    const { repo, worktree, merged } = repoWithTask();
    const pi = mergedSession(worktree, merged);
    await pi.emit("session_start");
    expect([...pi.tools.keys()]).toEqual(["factory", "factory_new_task"]);
    expect((await pi.newTask({ title: "feat: x", handoff: "do x" })).isError).toBe(true);

    await pi.message();
    expect(pi.sections.factory_followup).toContain("factory_new_task");
    expect(pi.sections.factory_followup).toContain(`merged as ${merged.slice(0, 12)}. Your change merges as a new commit once it passes.`);
    expect((await pi.newTask({ title: "Do x", handoff: "do x" })).content[0].text).toContain("conventional commit title");
    const first = await pi.newTask({ title: "feat: x", handoff: "do x" });
    expect(first.isError).toBeUndefined();
    expect(started.at(-1)).toEqual({ name: "tasks.start", params: { repo, title: "feat: x", request: "do x", overrides: { branch: "main", merge: "auto" } } });
    expect(pi.entries.filter((entry) => entry.customType === "factory-spawn").map((entry) => entry.data.title)).toEqual(["feat: x"]);
    const second = await pi.newTask({ title: "feat: y", handoff: "do y" });
    expect(second).toMatchObject({ isError: true });
    expect(second.content[0].text).toContain("one per message");

    // The next user message, a follow-up queued during the run too, may start one more.
    await pi.emit("input", { text: "and y", source: "rpc", streamingBehavior: "followUp" });
    expect((await pi.newTask({ title: "feat: y", handoff: "do y" })).isError).toBeUndefined();
    expect(started.length).toBe(2);
  });

  test("the new task takes over the parent's target branch and merge mode", async () => {
    const { repo, worktree, merged } = repoWithTask();
    gitIn(repo, "branch", "dev", "main");
    const pi = mergedSession(worktree, merged, "dev", "review");
    await pi.emit("session_start");
    await pi.message();
    expect((await pi.newTask({ title: "feat: z", handoff: "do z" })).isError).toBeUndefined();
    expect(started.at(-1)).toEqual({ name: "tasks.start", params: { repo, title: "feat: z", request: "do z", overrides: { branch: "dev", merge: "review" } } });
  });

  test("is refused in a run on a task that is not merged", async () => {
    const { worktree } = repoWithTask();
    const pi = session(worktree, [taskEntry(), custom("factory-round", { round: 1, trigger: "start" }), custom("factory-state", { state: "blocked", round: 1, reason: "max_rounds: gates" })]);
    await pi.emit("session_start");
    await pi.message();
    const result = await pi.newTask({ title: "feat: x", handoff: "do x" });
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0].text).toContain("only a follow-up run on a merged task");
    expect(pi.sections.factory_followup).toBeUndefined();
  });
});
