/**
 * Per-repository task settings the plugin owns, so a task can start without a caller supplying them.
 *
 * - Provides `factoryHome` (the plugin's data directory under Pi's agent dir)
 * - Provides the settings of a repository, one YAML file per repository named after its URI-encoded path, read and
 *   written (`loadSettings`, `saveSettings`) with the checks a `/factory start` payload has (`parseSettingsFields`)
 * - Provides `resolveSettings`: defaults < stored < overrides, models merged per role
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parseSettingsFields, ROLES, type Settings } from "./state.ts";
import { errorText, isRecord } from "./util.ts";

/** `Settings` as stored: every key optional, `branch` absent = the repository's default branch. */
export type StoredSettings = Partial<Omit<Settings, "models">> & { models?: Partial<Settings["models"]> };

const DEFAULT_SETTINGS: Readonly<Omit<Settings, "branch">> = { merge: "auto", maxRounds: 2, review: false, models: {} };

/** Honours `PI_CODING_AGENT_DIR`, read on every call. */
export function factoryHome(): string {
  return join(getAgentDir(), "factory");
}

/** `repo` is the primary checkout's absolute path. Encoded, so no two paths share a file. */
function settingsPath(repo: string): string {
  return join(factoryHome(), "repos", `${encodeURIComponent(repo)}.yaml`);
}

/** Checks a stored settings value, drops unknown keys. Throws an `Error` naming the first wrong key. */
function parseStoredSettings(raw: unknown): StoredSettings {
  if (raw === null || raw === undefined) return {};
  if (!isRecord(raw)) throw new Error("settings must be a mapping");
  return parseSettingsFields(raw);
}

/** A missing file is `{}`. An invalid file throws an `Error` naming the file and the wrong key. */
export async function loadSettings(repo: string): Promise<StoredSettings> {
  const path = settingsPath(repo);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  try {
    return parseStoredSettings(Bun.YAML.parse(text));
  } catch (error) {
    throw new Error(`${path}: ${errorText(error)}`);
  }
}

/** Checks `settings` like `loadSettings`, drops unknown keys, writes atomically (temp file in the same dir + rename). */
export async function saveSettings(repo: string, settings: StoredSettings): Promise<void> {
  const path = settingsPath(repo);
  let checked: StoredSettings;
  try {
    checked = parseStoredSettings(settings);
  } catch (error) {
    throw new Error(`${path}: ${errorText(error)}`);
  }
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${Bun.YAML.stringify(checked, null, 2).trimEnd()}\n`, "utf8");
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** Defaults < stored < overrides, models merged per role. `branch` is used when neither sets one. Mutates nothing. */
export function resolveSettings(stored: StoredSettings, overrides: StoredSettings, branch: string): Settings {
  return {
    branch: overrides.branch ?? stored.branch ?? branch,
    merge: overrides.merge ?? stored.merge ?? DEFAULT_SETTINGS.merge,
    maxRounds: overrides.maxRounds ?? stored.maxRounds ?? DEFAULT_SETTINGS.maxRounds,
    review: overrides.review ?? stored.review ?? DEFAULT_SETTINGS.review,
    models: { ...DEFAULT_SETTINGS.models, ...definedModels(stored.models), ...definedModels(overrides.models) },
  };
}

/** Drops roles set to `undefined`, so they do not erase a lower layer's model. */
function definedModels(models: StoredSettings["models"]): Settings["models"] {
  const result: Settings["models"] = {};
  for (const role of ROLES) {
    const model = models?.[role];
    if (model !== undefined) result[role] = model;
  }
  return result;
}
