/**
 * The `factory` tool: its schema comes from `ACTIONS`, a call goes through `callAction`, a failure is an `isError`
 * result. The actions themselves are tested in `core.test.ts`.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ACTIONS } from "./core.ts";
import { TASK_SESSION_ENV } from "./runner.ts";
import { agentActions, factoryToolParameters, isTaskSession, registerFactoryTool } from "./tool.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "factory-tool-test-")));
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;

beforeEach(() => {
  process.env.PI_CODING_AGENT_DIR = join(scratch, "agent");
});

afterEach(() => {
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The tool call context: `branch` = the session's entries. */
function ctx(branch: { type: string; customType?: string; data?: unknown }[] = []) {
  return { cwd: scratch, sessionManager: { getBranch: () => branch } };
}

function registered() {
  let tool: any;
  registerFactoryTool({ registerTool: (definition: unknown) => (tool = definition) } as unknown as ExtensionAPI);
  return tool;
}

describe("factoryToolParameters", () => {
  test("action is the enum of the ACTIONS that are not hostOnly, every param of those is a property", () => {
    const parameters = factoryToolParameters();
    expect(parameters.required).toEqual(["action"]);
    const offered = Object.keys(ACTIONS).filter((name) => name !== "tasks.import");
    expect(parameters.properties.action.enum).toEqual(offered);
    expect(String(parameters.properties.action.description)).not.toContain("tasks.import");
    expect(parameters.properties.record).toBeUndefined();
    for (const name of offered) {
      for (const key of Object.keys(ACTIONS[name as keyof typeof ACTIONS].params.properties)) expect(parameters.properties[key]).toBeDefined();
    }
    expect(parameters.properties.force.type).toBe("boolean");
    expect(parameters.properties.overrides.properties).toBeDefined();
  });

  test("a param several actions share names them; one with different meanings names each", () => {
    const { properties } = factoryToolParameters();
    expect(String(properties.id.description)).toContain("tasks.get, ");
    expect(String(properties.text.description)).toContain("config.write: The factory.yaml text");
    expect(String(properties.text.description)).toContain("tasks.message: The message");
  });
});

describe("registerFactoryTool", () => {
  test("the tool factory, sequential, with the parameters from ACTIONS", () => {
    const tool = registered();
    expect(tool.name).toBe("factory");
    expect(tool.parameters).toEqual(factoryToolParameters());
    expect(tool.executionMode).toBe("sequential");
  });

  test("a result is JSON text and details", async () => {
    const result = await registered().execute("call-1", { action: "repos.list" }, undefined, undefined, ctx());
    expect(result).toEqual({ content: [{ type: "text", text: JSON.stringify({ repos: [] }, null, 2) }], details: { repos: [] } });
  });

  test("a caller error is an isError result of one sentence, not a throw", async () => {
    const tool = registered();
    const result = await tool.execute("call-2", { action: "tasks.get", id: "nothing" }, undefined, undefined, ctx());
    expect(result).toEqual({ content: [{ type: "text", text: 'factory: no task has an id starting with "nothing"' }], details: undefined, isError: true });
    const unknown = await tool.execute("call-3", { action: "status" }, undefined, undefined, ctx());
    expect(unknown.content[0].text).toBe('factory: unknown action "status"');
  });

  test("models.get and models.set reach the core through the tool; models is an array of strings", async () => {
    const tool = registered();
    expect(tool.parameters.properties.models.type).toBe("array");
    const set = await tool.execute("call-5", { action: "models.set", models: ["a/b", "a/b"] }, undefined, undefined, ctx());
    expect(set.details).toEqual({ models: ["a/b"] });
    const get = await tool.execute("call-6", { action: "models.get" }, undefined, undefined, ctx());
    expect(get.details).toEqual({ models: ["a/b"] });
    const bad = await tool.execute("call-7", { action: "models.set", models: ["bare"] }, undefined, undefined, ctx());
    expect(bad).toEqual({ content: [{ type: "text", text: 'factory: models.set: "bare" is not a provider/model id' }], details: undefined, isError: true });
  });

  test("a hostOnly action is unknown to the agent", async () => {
    const record = { id: "11111111-2222-3333-4444-555555555555", repo: "/r", worktree: "/w", branch: "b", title: "t", sessionId: "s", sessionDir: "/d", createdAt: "x" };
    const result = await registered().execute("call-4", { action: "tasks.import", record }, undefined, undefined, ctx());
    expect(result).toEqual({ content: [{ type: "text", text: 'factory: unknown action "tasks.import"' }], details: undefined, isError: true });
  });
});

describe("the factory tool in a task session", () => {
  const taskBranch = [{ type: "custom", customType: "factory-task", data: {} }];
  const readOnly = (Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]).filter((name) => !ACTIONS[name].mutates && !ACTIONS[name].hostOnly);

  test("a session holding a factory-task entry, or Pi started by the runner, is a task session", () => {
    expect(isTaskSession([])).toBe(false);
    expect(isTaskSession(taskBranch)).toBe(true);
    process.env[TASK_SESSION_ENV] = "1";
    try {
      expect(isTaskSession([])).toBe(true);
    } finally {
      delete process.env[TASK_SESSION_ENV];
    }
  });

  test("offers only the actions with mutates: false", () => {
    expect(agentActions(true)).toEqual(readOnly);
    expect(factoryToolParameters(true).properties.action.enum).toEqual(readOnly);
    expect(readOnly).toContain("tasks.get");
    expect(readOnly).not.toContain("tasks.start");
  });

  test("Pi started by the runner registers the tool with the read-only actions", () => {
    process.env[TASK_SESSION_ENV] = "1";
    try {
      expect(registered().parameters.properties.action.enum).toEqual(readOnly);
    } finally {
      delete process.env[TASK_SESSION_ENV];
    }
  });

  test("a mutating action answers as unknown, a reading one works", async () => {
    const tool = registered();
    for (const action of ["tasks.start", "models.set", "tasks.message"]) {
      const result = await tool.execute("call-8", { action, repo: scratch, title: "t", request: "r", models: ["a/b"] }, undefined, undefined, ctx(taskBranch));
      expect(result).toEqual({ content: [{ type: "text", text: `factory: unknown action "${action}"` }], details: undefined, isError: true });
    }
    const list = await tool.execute("call-9", { action: "repos.list" }, undefined, undefined, ctx(taskBranch));
    expect(list.isError).toBeUndefined();
  });
});
