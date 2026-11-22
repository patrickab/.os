import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { factoryHome, loadSettings, resolveSettings, saveSettings, type StoredSettings } from "./settings.ts";

const REPO = "/home/someone/git/project";
const REPO_FILE = "%2Fhome%2Fsomeone%2Fgit%2Fproject.yaml";
const DEFAULTS = { merge: "auto", maxRounds: 2, review: false, models: {} } as const;
let agentDir: string;
let previousAgentDir: string | undefined;

beforeEach(async () => {
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  agentDir = await mkdtemp(join(tmpdir(), "factory-settings-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

/** The settings file of `REPO`: its path, URI-encoded, as the file name. */
function settingsPath(): string {
  return join(agentDir, "factory", "repos", REPO_FILE);
}

async function writeSettingsFile(text: string): Promise<string> {
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  return path;
}

describe("paths", () => {
  test("factoryHome follows PI_CODING_AGENT_DIR, the settings file is <factoryHome>/repos/<encoded path>.yaml", async () => {
    expect(factoryHome()).toBe(join(agentDir, "factory"));
    await saveSettings(REPO, { review: true });
    expect(await readdir(join(agentDir, "factory", "repos"))).toEqual([REPO_FILE]);
  });

  test("two repos whose paths differ only in / and - have their own settings", async () => {
    await saveSettings("/a/b-c", { merge: "review" });
    expect(await loadSettings("/a-b/c")).toEqual({});
    expect(await loadSettings("/a/b-c")).toEqual({ merge: "review" });
  });
});

describe("loadSettings", () => {
  test("a missing file is empty settings", async () => {
    expect(await loadSettings(REPO)).toEqual({});
  });

  test("an empty file is empty settings", async () => {
    await writeSettingsFile("");
    expect(await loadSettings(REPO)).toEqual({});
  });

  test("drops unknown keys and unknown roles", async () => {
    await writeSettingsFile("merge: review\nextra: 1\nmodels:\n  coder: a/b\n  planner: c/d\n");
    expect(await loadSettings(REPO)).toEqual({ merge: "review", models: { coder: "a/b" } });
  });

  const invalid: [string, string, string][] = [
    ["not a mapping", "- 1\n", "settings must be a mapping"],
    ["branch empty", 'branch: ""\n', "branch"],
    ["branch not a string", "branch: 3\n", "branch"],
    ["merge", "merge: later\n", "merge"],
    ["maxRounds zero", "maxRounds: 0\n", "maxRounds"],
    ["maxRounds above 20", "maxRounds: 21\n", "maxRounds"],
    ["maxRounds fraction", "maxRounds: 1.5\n", "maxRounds"],
    ["maxRounds string", "maxRounds: two\n", "maxRounds"],
    ["review", "review: yes please\n", "review"],
    ["models not a mapping", "models: a/b\n", "models"],
    ["coder model without provider", "models:\n  coder: sonnet\n", "models.coder"],
    ["reviewer model not a string", "models:\n  reviewer: 4\n", "models.reviewer"],
  ];
  for (const [name, text, key] of invalid) {
    test(`an invalid file throws naming the file and the key: ${name}`, async () => {
      const path = await writeSettingsFile(text);
      const error = await loadSettings(REPO).then(() => undefined, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toStartWith(`${path}: `);
      expect((error as Error).message).toContain(key);
    });
  }

  test("an unparsable file throws naming the file", async () => {
    const path = await writeSettingsFile("merge: [\n");
    await expect(loadSettings(REPO)).rejects.toThrow(path);
  });
});

describe("saveSettings", () => {
  test("round trips, creating directories and leaving no temp file", async () => {
    const settings: StoredSettings = { branch: "develop", merge: "review", maxRounds: 5, review: true, models: { coder: "anthropic/x", reviewer: "openai/y" } };
    await saveSettings(REPO, settings);
    expect(await loadSettings(REPO)).toEqual(settings);
    expect(await readdir(dirname(settingsPath()))).toEqual([REPO_FILE]);
  });

  test("drops unknown keys before writing", async () => {
    await saveSettings(REPO, { review: true, extra: "x" } as StoredSettings);
    expect(await readFile(settingsPath(), "utf8")).not.toContain("extra");
    expect(await loadSettings(REPO)).toEqual({ review: true });
  });

  test("refuses invalid settings and writes nothing", async () => {
    await expect(saveSettings(REPO, { maxRounds: 30 })).rejects.toThrow(`${settingsPath()}: maxRounds`);
    await expect(saveSettings(REPO, { models: { coder: "bare" } })).rejects.toThrow("models.coder");
    expect(await loadSettings(REPO)).toEqual({});
  });

  test("two concurrent saves leave one valid file", async () => {
    const first: StoredSettings = { merge: "review", maxRounds: 3, models: { coder: "a/one" } };
    const second: StoredSettings = { merge: "auto", maxRounds: 7, review: true, models: { reviewer: "b/two" } };
    await Promise.all([saveSettings(REPO, first), saveSettings(REPO, second)]);
    expect([first, second]).toContainEqual(await loadSettings(REPO));
    expect(await readdir(dirname(settingsPath()))).toEqual([REPO_FILE]);
  });
});

describe("resolveSettings", () => {
  test("defaults when nothing is stored or overridden", () => {
    expect(resolveSettings({}, {}, "main")).toEqual({ ...DEFAULTS, branch: "main" });
  });

  test("defaults < stored < overrides, models merged per role", () => {
    const stored: StoredSettings = { branch: "develop", merge: "review", maxRounds: 4, models: { coder: "s/coder", reviewer: "s/reviewer" } };
    const overrides: StoredSettings = { maxRounds: 9, review: true, models: { reviewer: "o/reviewer", coder: undefined } };
    const storedCopy = structuredClone(stored);
    const overridesCopy = structuredClone(overrides);
    expect(resolveSettings(stored, overrides, "main")).toEqual({
      branch: "develop",
      merge: "review",
      maxRounds: 9,
      review: true,
      models: { coder: "s/coder", reviewer: "o/reviewer" },
    });
    expect(resolveSettings(stored, { branch: "release" }, "main").branch).toBe("release");
    expect(stored).toEqual(storedCopy);
    expect(overrides).toEqual(overridesCopy);
  });

  test("the result does not share the models object of an input", () => {
    const stored: StoredSettings = { models: { coder: "s/coder" } };
    const resolved = resolveSettings(stored, {}, "main");
    resolved.models.reviewer = "x/y";
    expect(stored.models).toEqual({ coder: "s/coder" });
    expect(resolveSettings({}, {}, "main").models).toEqual({});
  });
});
