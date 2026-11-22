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
import { factoryToolParameters, registerFactoryTool } from "./tool.ts";

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
    const result = await registered().execute("call-1", { action: "repos.list" }, undefined, undefined, { cwd: scratch });
    expect(result).toEqual({ content: [{ type: "text", text: JSON.stringify({ repos: [] }, null, 2) }], details: { repos: [] } });
  });

  test("a caller error is an isError result of one sentence, not a throw", async () => {
    const tool = registered();
    const result = await tool.execute("call-2", { action: "tasks.get", id: "nothing" }, undefined, undefined, { cwd: scratch });
    expect(result).toEqual({ content: [{ type: "text", text: 'factory: no task has an id starting with "nothing"' }], details: undefined, isError: true });
    const unknown = await tool.execute("call-3", { action: "status" }, undefined, undefined, { cwd: scratch });
    expect(unknown.content[0].text).toBe('factory: unknown action "status"');
  });

  test("a hostOnly action is unknown to the agent", async () => {
    const record = { id: "11111111-2222-3333-4444-555555555555", repo: "/r", worktree: "/w", branch: "b", title: "t", sessionId: "s", sessionDir: "/d", createdAt: "x" };
    const result = await registered().execute("call-4", { action: "tasks.import", record }, undefined, undefined, { cwd: scratch });
    expect(result).toEqual({ content: [{ type: "text", text: 'factory: unknown action "tasks.import"' }], details: undefined, isError: true });
  });
});
