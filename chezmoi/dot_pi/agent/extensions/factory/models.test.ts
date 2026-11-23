/**
 * The factory models list in a scratch agent dir, and `/factory models` over a fake command context (no Pi, no model).
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadModels, modelsCommand, modelsPath, requireModels, saveModels, type ModelsCommandContext } from "./models.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "factory-models-test-")));
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
let caseCount = 0;

beforeEach(() => {
  process.env.PI_CODING_AGENT_DIR = join(scratch, `case-${++caseCount}`, "agent");
});

afterEach(() => {
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const NO_MODELS = "no factory models are set (set them with /factory models)";

function writeModelsFile(text: string): void {
  mkdirSync(dirname(modelsPath()), { recursive: true });
  writeFileSync(modelsPath(), text);
}

// Pi's command context must fit what modelsCommand takes (compile-time check for index.ts).
const piContextFits: (ctx: ExtensionCommandContext) => Promise<void> = (ctx) => modelsCommand("", ctx);

interface FakeContext extends ModelsCommandContext {
  notes: { message: string; type: string | undefined }[];
  selects: { title: string; options: string[] }[];
}

function fakeContext(mode: string, pick?: (options: string[]) => string | undefined, scoped: string[] = []): FakeContext {
  const ctx: FakeContext = {
    mode,
    notes: [],
    selects: [],
    ui: {
      notify: (message, type) => ctx.notes.push({ message, type }),
      select: async (title, options) => {
        ctx.selects.push({ title, options });
        return pick?.(options);
      },
    },
    modelRegistry: {
      getAvailable: () => [
        { provider: "openai", id: "gpt" },
        { provider: "anthropic", id: "sonnet" },
        { provider: "anthropic", id: "opus" },
      ],
    },
    scopedModels: scoped.map((id) => ({ model: { provider: id.split("/")[0], id: id.split("/")[1] } })),
  };
  return ctx;
}

describe("modelsPath, loadModels, saveModels", () => {
  test("the list is <factoryHome>/models.yaml; missing or empty reads as []", async () => {
    expect(modelsPath()).toBe(join(process.env.PI_CODING_AGENT_DIR!, "factory", "models.yaml"));
    expect(await loadModels()).toEqual([]);
    writeModelsFile("");
    expect(await loadModels()).toEqual([]);
  });

  test("saveModels writes a YAML list, deduplicated in order, atomically (no temp file left)", async () => {
    await saveModels(["a/b", "c/d-1:x", "a/b"]);
    expect(await loadModels()).toEqual(["a/b", "c/d-1:x"]);
    expect(Bun.YAML.parse(readFileSync(modelsPath(), "utf8"))).toEqual(["a/b", "c/d-1:x"]);
    expect(readdirSync(dirname(modelsPath()))).toEqual(["models.yaml"]);
    await saveModels([]);
    expect(await loadModels()).toEqual([]);
  });

  test.each([["sonnet"], ["/b"], ["a/"], ["a b/c"], ["a/b c"], [""]])("saveModels refuses %p and keeps the old list", async (id) => {
    await saveModels(["a/b"]);
    await expect(saveModels([id])).rejects.toThrow(`${JSON.stringify(id)} is not a provider/model id`);
    expect(await loadModels()).toEqual(["a/b"]);
  });

  test("an invalid file throws naming it", async () => {
    writeModelsFile("models: a/b\n");
    await expect(loadModels()).rejects.toThrow(`${modelsPath()}: models must be a list of provider/model ids`);
    writeModelsFile("- a/b\n- bare\n");
    await expect(loadModels()).rejects.toThrow('"bare" is not a provider/model id');
  });
});

describe("requireModels", () => {
  test("an empty list is an error naming /factory models, even without a model to check", async () => {
    await expect(requireModels({})).rejects.toThrow(NO_MODELS);
    await expect(requireModels({ coder: "a/b" })).rejects.toThrow(NO_MODELS);
  });

  test("passes models on the list and unset roles; names a model not on it", async () => {
    await saveModels(["a/b", "c/d"]);
    await requireModels({});
    await requireModels({ coder: "a/b", reviewer: "c/d" });
    await requireModels({ coder: undefined, reviewer: "c/d" });
    await expect(requireModels({ coder: "a/b", reviewer: "x/y" })).rejects.toThrow("the reviewer model x/y is not a factory model (add it with /factory models add x/y)");
  });
});

describe("modelsCommand", () => {
  test("no args lists the models, or says none are set", async () => {
    const ctx = fakeContext("print");
    await modelsCommand("  ", ctx);
    await saveModels(["a/b", "c/d"]);
    await modelsCommand("", ctx);
    expect(ctx.notes).toEqual([
      { message: NO_MODELS, type: "warning" },
      { message: "factory models: a/b, c/d", type: "info" },
    ]);
  });

  test("add, remove and set work without a UI", async () => {
    const ctx = fakeContext("rpc");
    await modelsCommand("add a/b", ctx);
    await modelsCommand("add c/d", ctx);
    await modelsCommand("add a/b", ctx);
    expect(await loadModels()).toEqual(["a/b", "c/d"]);
    await modelsCommand("remove a/b", ctx);
    expect(await loadModels()).toEqual(["c/d"]);
    await modelsCommand("set x/y  z/w x/y", ctx);
    expect(await loadModels()).toEqual(["x/y", "z/w"]);
    await modelsCommand("remove x/y", ctx);
    await modelsCommand("remove z/w", ctx);
    expect(await loadModels()).toEqual([]);
    expect(ctx.notes.map((note) => note.message)).toEqual([
      "factory models: a/b",
      "factory models: a/b, c/d",
      "factory models: a/b, c/d",
      "factory models: c/d",
      "factory models: x/y, z/w",
      "factory models: z/w",
      NO_MODELS,
    ]);
    expect(ctx.selects).toEqual([]);
  });

  test("wrong input is an error notify and changes nothing", async () => {
    await saveModels(["a/b"]);
    const ctx = fakeContext("rpc");
    await modelsCommand("add sonnet", ctx);
    await modelsCommand("remove x/y", ctx);
    await modelsCommand("add", ctx);
    await modelsCommand("set", ctx);
    await modelsCommand("fly a/b", ctx);
    expect(await loadModels()).toEqual(["a/b"]);
    expect(ctx.notes.map((note) => note.type)).toEqual(["error", "error", "error", "error", "error"]);
    expect(ctx.notes[0].message).toBe('factory: "sonnet" is not a provider/model id');
    expect(ctx.notes[1].message).toBe("factory: x/y is not a factory model");
    expect(ctx.notes[2].message).toStartWith("factory: usage: /factory models");
  });

  test("in the TUI, add without an id offers Pi's available models not on the list; the pick is added", async () => {
    await saveModels(["openai/gpt"]);
    const ctx = fakeContext("tui", (options) => options[0]);
    await modelsCommand("add", ctx);
    expect(ctx.selects).toEqual([{ title: "Add a factory model", options: ["anthropic/opus", "anthropic/sonnet"] }]);
    expect(await loadModels()).toEqual(["openai/gpt", "anthropic/opus"]);
  });

  test("in the TUI, the session's scoped models are offered instead; a cancelled pick changes nothing", async () => {
    const ctx = fakeContext("tui", () => undefined, ["anthropic/sonnet"]);
    await modelsCommand("add", ctx);
    expect(ctx.selects[0].options).toEqual(["anthropic/sonnet"]);
    expect(await loadModels()).toEqual([]);
    expect(ctx.notes).toEqual([]);
  });

  test("in the TUI, nothing left to offer is a warning", async () => {
    await saveModels(["anthropic/sonnet"]);
    const ctx = fakeContext("tui", undefined, ["anthropic/sonnet"]);
    await modelsCommand("add", ctx);
    expect(ctx.selects).toEqual([]);
    expect(ctx.notes).toEqual([{ message: "factory: Pi offers no model that is not on the list", type: "warning" }]);
  });
});
