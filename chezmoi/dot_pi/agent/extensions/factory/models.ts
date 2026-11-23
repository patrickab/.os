/**
 * The factory's models: one user-level list of `provider/model` ids every task and repository picks from.
 *
 * - Provides `modelsPath` (`<factoryHome>/models.yaml`, a YAML list), `loadModels`, `saveModels` (atomic, deduplicated)
 * - Provides `requireModels`: the check `tasks.start` and `settings.set` make on the models they would use. An empty
 *   list is an error naming `/factory models`
 * - Provides `modelsCommand`, the `/factory models` command: list, `add`, `remove`, `set`; in the TUI `add` without an
 *   id offers Pi's available models
 * - Imports no npm package (core.ts imports this file; the deployed plugin has no `node_modules`)
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { factoryHome } from "./settings.ts";
import type { ROLES } from "./state.ts";
import { errorText } from "./util.ts";

type Role = (typeof ROLES)[number];

const MODEL_ID = /^[^/\s]+\/\S+$/;

const NO_MODELS_MESSAGE = "no factory models are set (set them with /factory models)";

const USAGE = "usage: /factory models [add <provider/model> | remove <provider/model> | set <provider/model> ...]";

export function modelsPath(): string {
  return join(factoryHome(), "models.yaml");
}

function checkModels(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error("models must be a list of provider/model ids");
  for (const model of raw) {
    if (typeof model !== "string" || !MODEL_ID.test(model)) throw new Error(`${JSON.stringify(model)} is not a provider/model id`);
  }
  return [...new Set(raw as string[])];
}

/** A missing or empty file is `[]`. An invalid file throws an `Error` naming the file. */
export async function loadModels(): Promise<string[]> {
  const path = modelsPath();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  try {
    const raw: unknown = Bun.YAML.parse(text);
    return raw === null || raw === undefined ? [] : checkModels(raw);
  } catch (error) {
    throw new Error(`${path}: ${errorText(error)}`);
  }
}

/** Checks each id (`provider/model`), drops repeats (first one kept), writes atomically (temp file + rename). */
export async function saveModels(models: string[]): Promise<void> {
  const checked = checkModels(models);
  const path = modelsPath();
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

/** Throws one sentence when the list is empty or a given model is not on it. A role without a model passes. */
export async function requireModels(models: Partial<Record<Role, string>>): Promise<void> {
  const allowed = await loadModels();
  if (allowed.length === 0) throw new Error(NO_MODELS_MESSAGE);
  for (const [role, model] of Object.entries(models)) {
    if (model !== undefined && !allowed.includes(model)) {
      throw new Error(`the ${role} model ${model} is not a factory model (add it with /factory models add ${model})`);
    }
  }
}

/** What `modelsCommand` uses of Pi's command context (`ExtensionCommandContext` fits it). */
export interface ModelsCommandContext {
  mode: string;
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    select(title: string, options: string[]): Promise<string | undefined>;
  };
  modelRegistry: { getAvailable(): readonly { provider: string; id: string }[] };
  scopedModels: readonly { model: { provider: string; id: string } }[];
}

/** The models Pi offers in its own picker: the session's scoped ones, else every available one; listed ones left out. */
function offeredModels(ctx: ModelsCommandContext, listed: string[]): string[] {
  const models = ctx.scopedModels.length > 0 ? ctx.scopedModels.map((scoped) => scoped.model) : ctx.modelRegistry.getAvailable();
  const ids = models.map((model) => `${model.provider}/${model.id}`).filter((id) => !listed.includes(id));
  return [...new Set(ids)].sort();
}

function listText(models: string[]): string {
  return models.length === 0 ? NO_MODELS_MESSAGE : `factory models: ${models.join(", ")}`;
}

/** `/factory models [add <id> | remove <id> | set <id> ...]`; no args lists them. Reports through `ctx.ui.notify`. */
export async function modelsCommand(args: string, ctx: ModelsCommandContext): Promise<void> {
  const [verb, ...ids] = args.trim().split(/\s+/).filter((word) => word !== "");
  try {
    const models = await loadModels();
    if (verb === undefined) {
      ctx.ui.notify(listText(models), models.length === 0 ? "warning" : "info");
      return;
    }
    let next: string[];
    if (verb === "add" && ids.length === 0 && ctx.mode === "tui") {
      const offered = offeredModels(ctx, models);
      if (offered.length === 0) {
        ctx.ui.notify("factory: Pi offers no model that is not on the list", "warning");
        return;
      }
      const picked = await ctx.ui.select("Add a factory model", offered);
      if (picked === undefined) return;
      next = [...models, picked];
    } else if ((verb === "add" || verb === "remove") && ids.length === 1) {
      const [id] = ids;
      if (verb === "remove" && !models.includes(id)) throw new Error(`${id} is not a factory model`);
      next = verb === "add" ? [...models, id] : models.filter((model) => model !== id);
    } else if (verb === "set" && ids.length > 0) {
      next = ids;
    } else {
      throw new Error(USAGE);
    }
    await saveModels(next);
    const saved = await loadModels();
    ctx.ui.notify(listText(saved), saved.length === 0 ? "warning" : "info");
  } catch (error) {
    ctx.ui.notify(`factory: ${errorText(error)}`, "error");
  }
}
