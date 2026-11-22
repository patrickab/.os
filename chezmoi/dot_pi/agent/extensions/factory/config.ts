/**
 * The repo's side of a factory task.
 *
 * - Consumes `factory.yaml` (the keys the plugin runs: `hooks.after_create`, `hooks.after_code`, `hooks.after_merge`,
 *   `gates`, `merge_gates`, `protected`, `lockfiles`)
 *   and the role prompts `.factory/agents/<role>.md`, all as the task's base commit holds them. The working tree is
 *   the coder's to edit, so it is never the source of the rules the coder is held to
 * - Provides `TaskFiles` (`loadTaskFiles`), `FactoryConfig` (`parseFactoryYaml` for a file read elsewhere: `launch.ts`
 *   runs `hooks.after_create` from the new worktree's copy), the protected-path match and the role prompt text
 * - `preview` belongs to the backend and is not read here
 */
import { git, LOCKFILES } from "./git.ts";
import type { Exec } from "./run.ts";
import { errorText, isRecord } from "./util.ts";

export interface FactoryConfig {
  /** `after_create`: once, in a new task worktree (`launch.ts`). */
  hooks: { after_create: string[][]; after_code: string[][]; after_merge: string[][] };
  /** After every coder turn: cheap checks (lint, types). */
  gates: string[][];
  /** In the merge queue, on the branch rebased onto the target, before the fast-forward: the tests. `gates` when unset. */
  merge_gates: string[][];
  protected: string[];
  /**
   * File names (no directory) whose change makes a merge run `hooks.after_merge`; their bodies go last in the review's
   * patch. Default `LOCKFILES`.
   */
  lockfiles: string[];
}

export const DEFAULT_PROTECTED = ["factory.yaml", ".factory/**"];

function argvList(value: unknown, key: string): string[][] {
  if (value === undefined || value === null) return [];
  const valid =
    Array.isArray(value) &&
    value.every((argv) => Array.isArray(argv) && argv.length > 0 && argv.every((part) => typeof part === "string" || typeof part === "number"));
  if (!valid) throw new Error(`factory.yaml: ${key} must be a list of argv lists`);
  return (value as (string | number)[][]).map((argv) => argv.map(String));
}

/** `raw` is the parsed YAML document. A missing or empty file (`undefined`, `null`) means no hooks and no gates. */
export function parseFactoryConfig(raw: unknown): FactoryConfig {
  if (raw === undefined || raw === null) {
    return { hooks: { after_create: [], after_code: [], after_merge: [] }, gates: [], merge_gates: [], protected: DEFAULT_PROTECTED, lockfiles: LOCKFILES };
  }
  if (!isRecord(raw)) throw new Error("factory.yaml: the document must be a mapping");
  const hooks = raw.hooks ?? {};
  if (!isRecord(hooks)) throw new Error("factory.yaml: hooks must be a mapping");
  const globs = raw.protected ?? DEFAULT_PROTECTED;
  if (!Array.isArray(globs) || !globs.every((glob) => typeof glob === "string" && glob !== "")) {
    throw new Error("factory.yaml: protected must be a list of globs");
  }
  const lockfiles = raw.lockfiles ?? LOCKFILES;
  if (!Array.isArray(lockfiles) || !lockfiles.every((name) => typeof name === "string" && name !== "" && !name.includes("/"))) {
    throw new Error("factory.yaml: lockfiles must be a list of file names without a slash");
  }
  return {
    hooks: {
      after_create: argvList(hooks.after_create, "hooks.after_create"),
      after_code: argvList(hooks.after_code, "hooks.after_code"),
      after_merge: argvList(hooks.after_merge, "hooks.after_merge"),
    },
    gates: argvList(raw.gates, "gates"),
    merge_gates: raw.merge_gates === undefined ? argvList(raw.gates, "gates") : argvList(raw.merge_gates, "merge_gates"),
    protected: globs,
    lockfiles,
  };
}

/** `factory.yaml` text as `parseFactoryConfig` reads it. Throws an `Error` starting `factory.yaml:`. */
export function parseFactoryYaml(text: string): FactoryConfig {
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(text);
  } catch (error) {
    throw new Error(`factory.yaml: ${errorText(error)}`);
  }
  return parseFactoryConfig(raw);
}

/**
 * A glob over repo-relative paths with git's `glob` pathspec rules: `*` and `?` stay inside one path segment,
 * a `**` segment spans any number of them.
 */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (glob.startsWith("**/", index) && (index === 0 || glob[index - 1] === "/")) {
      source += "(?:.*/)?";
      index += 2;
    } else if (glob.startsWith("**", index)) {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** The paths of `paths` that a protected glob matches. */
export function protectedPaths(paths: string[], globs: string[]): string[] {
  const patterns = globs.map(globToRegExp);
  return paths.filter((path) => patterns.some((pattern) => pattern.test(path)));
}

/** A role file's prompt: its text without a leading YAML frontmatter block. */
export function rolePromptText(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

export interface TaskFiles {
  config: FactoryConfig;
  /** Role prompts, undefined for a role the repo has no file for. */
  prompts: { coder: string | undefined; reviewer: string | undefined };
}

const CONFIG_PATH = "factory.yaml";
const ROLE_PATHS = { coder: ".factory/agents/coder.md", reviewer: ".factory/agents/reviewer.md" };

/** `factory.yaml` and the role prompts of commit `base` in the repository of `root`. Throws on a `factory.yaml` that does not parse. */
export async function loadTaskFiles(exec: Exec, root: string, base: string): Promise<TaskFiles> {
  const paths = [CONFIG_PATH, ROLE_PATHS.coder, ROLE_PATHS.reviewer];
  const present = new Set((await git(exec, root, ["ls-tree", "-r", "--name-only", base, "--", ...paths])).split("\n"));
  const show = (path: string) => (present.has(path) ? git(exec, root, ["show", `${base}:${path}`]) : undefined);
  const yaml = await show(CONFIG_PATH);
  const prompt = async (path: string) => {
    const content = await show(path);
    return content === undefined ? undefined : rolePromptText(content) || undefined;
  };
  return { config: yaml === undefined ? parseFactoryConfig(undefined) : parseFactoryYaml(yaml), prompts: { coder: await prompt(ROLE_PATHS.coder), reviewer: await prompt(ROLE_PATHS.reviewer) } };
}
