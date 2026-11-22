/**
 * Per-repository task settings the plugin owns, so a task can start without a caller supplying them.
 *
 * - Provides `factoryHome` (the plugin's data directory under Pi's agent dir, found without Pi: `PI_CODING_AGENT_DIR`,
 *   else `~/.pi/agent`, as Pi's `getAgentDir` does)
 * - Provides the settings of a repository, one YAML file per repository named after its URI-encoded path, read and
 *   written (`loadSettings`, `saveSettings`) with the checks a `/factory start` payload has (`parseSettingsFields`)
 *   plus `preview`, a boolean the plugin stores for its clients and never acts on. The file is the repository's
 *   registration (`registeredRepos`, `unregisterRepo`)
 * - Provides `resolveSettings`: defaults < stored < overrides, models merged per role
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseSettingsFields, ROLES, type Settings } from "./state.ts";
import { errorText, isRecord } from "./util.ts";

/** `Settings` as stored: every key optional, `branch` absent = the repository's default branch. */
export type StoredSettings = Partial<Omit<Settings, "models">> & { models?: Partial<Settings["models"]>; preview?: boolean };

/** The settings a repository's task gets, with `preview` (absent = `false`), which only clients read. */
export type ResolvedSettings = Settings & { preview: boolean };

export const DEFAULT_SETTINGS: Readonly<Omit<ResolvedSettings, "branch">> = { merge: "auto", maxRounds: 2, review: false, models: {}, preview: false };

/** Pi's agent dir: `PI_CODING_AGENT_DIR` (a leading `~` expanded), else `~/.pi/agent`. Read on every call. */
function agentDir(): string {
  const dir = process.env.PI_CODING_AGENT_DIR;
  if (dir === undefined || dir === "") return join(homedir(), ".pi", "agent");
  if (dir === "~") return homedir();
  return dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir;
}

export function factoryHome(): string {
  return join(agentDir(), "factory");
}

function reposDir(): string {
  return join(factoryHome(), "repos");
}

/** `repo` is the primary checkout's absolute path. Encoded, so no two paths share a file. */
function settingsPath(repo: string): string {
  return join(reposDir(), `${encodeURIComponent(repo)}.yaml`);
}

/** Checks a stored settings value, drops unknown keys. Throws an `Error` naming the first wrong key. */
export function parseStoredSettings(raw: unknown): StoredSettings {
  if (raw === null || raw === undefined) return {};
  if (!isRecord(raw)) throw new Error("settings must be a mapping");
  const settings: StoredSettings = parseSettingsFields(raw);
  if (raw.preview !== undefined) {
    if (typeof raw.preview !== "boolean") throw new Error("preview must be a boolean");
    settings.preview = raw.preview;
  }
  return settings;
}

/** The repositories that have a settings file, sorted. */
export async function registeredRepos(): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(reposDir());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => decodeURIComponent(name.slice(0, -".yaml".length)))
    .sort();
}

/** Removes the repository's settings file; `false` when it had none. */
export async function unregisterRepo(repo: string): Promise<boolean> {
  try {
    await rm(settingsPath(repo));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
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

/** `resolveSettings` with the stored `preview`. */
export function resolveRepoSettings(stored: StoredSettings, overrides: StoredSettings, branch: string): ResolvedSettings {
  return { ...resolveSettings(stored, overrides, branch), preview: stored.preview ?? DEFAULT_SETTINGS.preview };
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
