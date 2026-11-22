/**
 * Git facts a factory task needs, as thin calls over the command runner.
 *
 * - Consumes an `Exec` and a checkout path
 * - Provides the task's git identity (`taskGit`), its primary checkout, the snapshot of a working tree as a tree id
 *   (`snapshotTree`), the task's diff base and its diff (changed paths and patch, untracked files included)
 * - Provides the checks a merge needs before it writes: the checkout is on its branch with no git operation in
 *   progress (`assertCheckoutReady`). Tells a rebase in progress and its conflicting files (`rebaseInProgress`), and
 *   aborts one a killed merge left behind (`abortLeftoverRebase`)
 * - Provides the added and removed lines per changed path (`diffFileCounts`)
 * - Provides where the task's own change starts (`taskBase`) and whether its target branch moved past it (`targetMoved`)
 * - Nothing here writes the checkout's own index or its files: staging goes through a scratch index
 */
import { existsSync, realpathSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Exec } from "./run.ts";
import type { Task } from "./state.ts";
import { outputTail } from "./util.ts";

/** Upper bound of what one git call may print: path lists and file contents, never a whole patch. */
const GIT_STDOUT_MAX_CHARS = 4_000_000;
/** What a diff keeps of its patch. The review caps it again, far lower. */
const PATCH_KEEP_CHARS = 1_000_000;

/**
 * The default of `factory.yaml` `lockfiles`: their bodies are noise in a review and go last in a patch. A change to one
 * makes a merge run `hooks.after_merge`.
 */
export const LOCKFILES = ["uv.lock", "package-lock.json", "bun.lock", "bun.lockb"];

/** Stdout of `git <args>` in `cwd`, trimmed. Throws with the end of the output when git fails. */
export async function git(exec: Exec, cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const result = await exec(["git", ...args], { cwd, env, maxStdoutChars: GIT_STDOUT_MAX_CHARS });
  if (result.exitCode !== 0 || result.killed) {
    throw new Error(`git ${args.join(" ")}: ${outputTail(result.output)}`);
  }
  if (result.stdoutTruncated) throw new Error(`git ${args.join(" ")}: more than ${GIT_STDOUT_MAX_CHARS} characters of output`);
  return result.stdout.trim();
}

/** The paths of a `-z` listing. */
export function nulList(text: string): string[] {
  return text.split("\0").filter((path) => path !== "");
}

export type TaskGit = Pick<Task, "branch" | "mainBranch" | "baseSha">;

/** Primary checkout of the repository `cwd` belongs to, and its git directory (where the merge lock lives). */
export async function primaryCheckout(exec: Exec, cwd: string): Promise<{ primary: string; gitDir: string }> {
  const gitDir = await git(exec, cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return { primary: dirname(gitDir), gitDir };
}

/** A scratch index for `root` that starts as a copy of its real one. `GIT_INDEX_FILE` in `env` points git at it. */
export async function withScratchIndex<T>(exec: Exec, root: string, use: (env: { GIT_INDEX_FILE: string }, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "factory-index-"));
  try {
    const index = await git(exec, root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
    const env = { GIT_INDEX_FILE: join(dir, "index") };
    if (existsSync(index)) await copyFile(index, env.GIT_INDEX_FILE);
    return await use(env, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * `git add -A` arguments that leave out untracked nested repositories: one without a commit makes `add` fail, one
 * with a commit would be staged as a gitlink. Git lists both with a trailing slash.
 */
export async function addAllArgs(exec: Exec, root: string, env?: Record<string, string>): Promise<string[]> {
  const nested = nulList(await git(exec, root, ["ls-files", "--others", "--exclude-standard", "-z"], env)).filter((path) => path.endsWith("/"));
  return ["add", "-A", "--", ".", ...nested.map((path) => `:(exclude,literal)${path.slice(0, -1)}`)];
}

/** Stages the whole working tree into the scratch index of `env` and returns its tree id. */
export async function stageTree(exec: Exec, root: string, env: { GIT_INDEX_FILE: string }): Promise<string> {
  await git(exec, root, await addAllArgs(exec, root, env), env);
  return git(exec, root, ["write-tree"], env);
}

/** Tree id of the working tree of `root` as it is now: tracked and untracked files, ignored ones left out. */
export function snapshotTree(exec: Exec, root: string): Promise<string> {
  return withScratchIndex(exec, root, (env) => stageTree(exec, root, env));
}

/**
 * The task's git identity. Throws when `cwd` is not the root of a linked git worktree on a branch with at least one
 * commit, or the branch it merges into (`target`, `settings.branch`) does not exist. A task never runs in the
 * repository's main checkout: that tree is the user's.
 */
export async function taskGit(exec: Exec, cwd: string, target: string): Promise<TaskGit> {
  const lines = await git(exec, cwd, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir", "HEAD"]);
  const [toplevel, gitDir, commonDir, baseSha] = lines.split("\n");
  if (realpathSync(toplevel) !== realpathSync(cwd)) throw new Error(`${cwd} is not the root of its git checkout (${toplevel})`);
  if (gitDir === commonDir) throw new Error(`${cwd} is the repository's main checkout: a factory task runs in a git worktree of its own`);
  const branch = await git(exec, cwd, ["symbolic-ref", "--short", "HEAD"]);
  if ((await exec(["git", "rev-parse", "--verify", "--quiet", `refs/heads/${target}`], { cwd })).exitCode !== 0) {
    throw new Error(`the branch ${target} does not exist`);
  }
  if (branch === target) throw new Error(`the worktree is on ${target} itself: a task works on a branch of its own`);
  return { branch, mainBranch: target, baseSha };
}

/** Whether `ancestor` is an ancestor of (or is) `commit`. Throws when git fails otherwise. */
async function isAncestor(exec: Exec, root: string, ancestor: string, commit: string): Promise<boolean> {
  const result = await exec(["git", "merge-base", "--is-ancestor", ancestor, commit], { cwd: root });
  if (result.exitCode === 0 || result.exitCode === 1) return result.exitCode === 0 && !result.killed;
  throw new Error(`git merge-base --is-ancestor ${ancestor} ${commit}: ${outputTail(result.output)}`);
}

/**
 * The commit the task's own change sits on, the merge base of HEAD and its target branch: what is in it is not the
 * task's. The diff is taken against it, and `factory.yaml` and the role prompts are read from it.
 */
export function taskBase(exec: Exec, root: string, task: Task): Promise<string> {
  return git(exec, root, ["merge-base", "HEAD", `refs/heads/${task.mainBranch}`]);
}

/** Whether the target branch holds commits the task branch does not build on yet. */
export async function targetMoved(exec: Exec, root: string, task: Task): Promise<boolean> {
  return !(await isAncestor(exec, root, `refs/heads/${task.mainBranch}`, "HEAD"));
}

const GIT_OPERATIONS = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"];

/** The git operations (merge, cherry-pick, revert, rebase) that are in progress in `root`, by their state path. */
async function operationsInProgress(exec: Exec, root: string): Promise<string[]> {
  const paths = await git(exec, root, ["rev-parse", "--path-format=absolute", ...GIT_OPERATIONS.flatMap((name) => ["--git-path", name])]);
  return GIT_OPERATIONS.filter((_name, index) => existsSync(paths.split("\n")[index]));
}

/** Throws unless `root` is on `branch` with no merge, cherry-pick, revert or rebase in progress. */
export async function assertCheckoutReady(exec: Exec, root: string, branch: string): Promise<void> {
  // First: a rebase in progress also detaches HEAD, and the operation is the useful thing to name.
  const operations = await operationsInProgress(exec, root);
  if (operations.length > 0) throw new Error(`a git operation is in progress in the task checkout (${operations.join(", ")})`);
  const current = await git(exec, root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current !== branch) throw new Error(`the task checkout is on ${current === "HEAD" ? "a detached HEAD" : current}, not on ${branch}`);
}

/** The conflicting (unmerged) files of a rebase in progress in `root`, or null when no rebase is in progress. */
export async function rebaseInProgress(exec: Exec, root: string): Promise<string[] | null> {
  const operations = await operationsInProgress(exec, root);
  if (!operations.some((name) => name.startsWith("rebase-"))) return null;
  return nulList(await git(exec, root, ["diff", "--name-only", "--diff-filter=U", "-z"]));
}

/** Aborts a rebase that a killed merge left behind in `root`. `exec` must be one a cancel does not stop. */
export async function abortLeftoverRebase(exec: Exec, root: string): Promise<void> {
  const operations = await operationsInProgress(exec, root);
  if (operations.some((name) => name.startsWith("rebase-"))) await git(exec, root, ["rebase", "--abort"]);
}

export interface TaskDiff {
  /** What the diff is taken against, a commit or a tree. */
  base: string;
  /** Changed paths relative to the repo root. A rename lists both of its paths. */
  paths: string[];
  /** Source first, lockfiles last. Cut at a size no review reads. */
  patch: string;
}

/** The working tree of `root` against `base`, untracked files included. Files named in `lockfiles` go last in the patch. */
export async function taskDiff(exec: Exec, root: string, base: string, lockfiles: readonly string[] = LOCKFILES): Promise<TaskDiff> {
  return treeDiff(exec, root, base, await snapshotTree(exec, root), lockfiles);
}

/** `taskDiff` against the tree id `tree` (`snapshotTree`). */
export async function treeDiff(exec: Exec, root: string, base: string, tree: string, lockfiles: readonly string[] = LOCKFILES): Promise<TaskDiff> {
  const paths = nulList(await git(exec, root, ["diff", "--no-renames", "--name-only", "-z", base, tree]));
  // Fixed prefixes and no external diff tool: the patch must not depend on the user's git config.
  const patchOf = async (pathspecs: string[]) => {
    const argv = ["git", "diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", base, tree, "--", ...pathspecs];
    const result = await exec(argv, { cwd: root, maxStdoutChars: PATCH_KEEP_CHARS });
    if (result.exitCode !== 0 || result.killed) throw new Error(`git diff: ${outputTail(result.output)}`);
    return result.stdout;
  };
  const source = await patchOf([".", ...lockfiles.map((name) => `:(exclude,glob)**/${name}`)]);
  const locks = lockfiles.length === 0 ? "" : await patchOf(lockfiles.map((name) => `:(glob)**/${name}`));
  return { base, paths, patch: source + locks };
}

export interface FileCounts {
  path: string;
  /** Lines; 0 for a binary file. */
  added: number;
  removed: number;
}

/** Added and removed lines per changed path of `tree` against `base`, no renames. */
export async function diffFileCounts(exec: Exec, root: string, base: string, tree: string): Promise<FileCounts[]> {
  const fields = nulList(await git(exec, root, ["diff", "--no-renames", "--no-ext-diff", "--numstat", "-z", base, tree]));
  return fields.map((field) => {
    const [added = "", removed = "", ...path] = field.split("\t");
    return { path: path.join("\t"), added: Number(added) || 0, removed: Number(removed) || 0 };
  });
}
