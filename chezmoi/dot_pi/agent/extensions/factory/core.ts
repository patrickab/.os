/**
 * The factory core: every factory feature as one action over plain JSON. Clients (the `factory` tool, pi-host, a UI)
 * import only this module and render what it returns.
 *
 * - Provides `ACTIONS` (name -> summary, JSON schema of the params, whether it changes anything) and `callAction`
 * - Every failure is a `FactoryError` of one sentence with a code: `invalid` (the params), `not_found` (repo, branch,
 *   task), `busy` (another action or a runner holds the task), `refused` (the task's state or work forbids it),
 *   `failed` (anything else)
 * - A `repo` param is a path inside the repository, relative to the caller's `cwd` (absolute without one); an action
 *   that needs one and gets none uses `cwd`. The repository is its primary checkout. A task `id` may be a unique prefix
 * - The models a task or repository may use are one user-level list (`models.ts`): `models.get`/`models.set`.
 *   `tasks.start` and `settings.set` refuse a model not on it, and anything while it is empty; reads never check it
 * - `hostOnly` actions are for the host (pi-host), never offered to an agent: `tasks.import`
 * - `tasks.wait` polls the watched tasks until they rest (no runner lives and the state is a resting one, or the task
 *   is interrupted) or one needs attention (it rests and is not `done`): a supervisor's completion signal
 * - Runners an action starts get the caller's `env` (default `process.env`): the host passes one without its secrets
 * - A task that checks its state and then acts on it holds the task lock (`tasks.ts`) from the check on; a runner it
 *   spawns takes the lock over until it exits. `cancel` stops a live runner first: two Pi processes never share a session
 * - Reads a task's session file for its state, settings, usage (assistant messages plus recorded reviews) and
 *   timeline (by byte offset, so a client polls with `next`)
 * - Imports only Bun, `node:` modules and plugin modules that do the same: the deployed plugin has no `node_modules`
 */
import { existsSync, realpathSync } from "node:fs";
import { readFile, stat, truncate, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { parseFactoryYaml } from "./config.ts";
import { initDraft } from "./draft.ts";
import { diffFileCounts, git, primaryCheckout, snapshotTree, treeDiff, type FileCounts } from "./git.ts";
import {
  defaultBranch,
  deleteTask,
  launchTask,
  LaunchRefusedError,
  liveRunners,
  localBranchExists,
  messageTask,
  MessageRefusedError,
  sendCommand,
  stopRunners,
  taskInboxPath,
  unmergedWork,
  type RunnerEnv,
  type UnmergedWork,
} from "./launch.ts";
import { inboxReadPath, readFactoryStates, sessionFilePath, taskMainBranch } from "./runner.ts";
import { loadModels, requireModels, saveModels } from "./models.ts";
import { runCommand } from "./run.ts";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseStoredSettings,
  registeredRepos,
  resolveRepoSettings,
  resolveSettings,
  saveSettings,
  unregisterRepo,
  type ResolvedSettings,
  type StoredSettings,
} from "./settings.ts";
import { isFactoryPrompt, messageText, parseSettingsFields, RESTING_STATES, type Settings, type State } from "./state.ts";
import { isTaskTag, listTasks, lockTask, parseTaskRecord, tagInGroup, TaskBusyError, taskLogPath, unlockTask, writeTask, type TaskKind, type TaskRecord } from "./tasks.ts";
import { errorText, isRecord } from "./util.ts";

export type FactoryErrorCode = "invalid" | "not_found" | "busy" | "refused" | "failed";

/** `{force: true}`: a refused `tasks.remove` that `force: true` would carry out. */
export type FactoryErrorDetail = { force: true };

export class FactoryError extends Error {
  readonly code: FactoryErrorCode;
  readonly detail: FactoryErrorDetail | undefined;
  constructor(code: FactoryErrorCode, message: string, detail?: FactoryErrorDetail) {
    super(message);
    this.name = "FactoryError";
    this.code = code;
    this.detail = detail;
  }
}

/** A task as every client sees it. `running`: a live runner holds the task. */
export interface TaskView {
  id: string;
  repo: string;
  worktree: string;
  branch: string;
  title: string;
  createdAt: string;
  tag: string;
  plan: string | null;
  kind: TaskKind;
  sessionId: string;
  sessionPath: string | null;
  state: State | null;
  round: number | null;
  reason: string | null;
  /** The timestamp of the last `factory-state` entry. */
  at: string | null;
  running: boolean;
  /** The state is `running` or `merging` but no runner lives (it crashed, or the host rebooted). */
  interrupted: boolean;
  /** The settings of the session's `factory-task` entry, null before it. */
  settings: Settings | null;
  /** Coder messages and reviews together; `input` is uncached input tokens. Null before either. */
  usage: { input: number; output: number; cost: number } | null;
  /** The task actions the core would accept now (`remove` maybe only with `force`). */
  actions: TaskActionName[];
}

export type TaskActionName = "tasks.approve" | "tasks.retry" | "tasks.cancel" | "tasks.remove" | "tasks.message";

export type TimelineKind = "task" | "round" | "gate" | "review" | "merge" | "state" | "coder" | "user" | "spawn";

/** `coder`/`user` data is `{text}`; the others carry the `factory-*` entry's data unchanged. */
export interface TimelineEntry {
  at: string;
  kind: TimelineKind;
  data: object;
}

type Schema = Record<string, unknown>;

export interface ActionSpec {
  summary: string;
  params: { type: "object"; required: string[]; properties: Record<string, Schema> };
  mutates: boolean;
  /** For the host only: never offered to an agent. */
  hostOnly: boolean;
}

const SHORT_ID_CHARS = 8;

const REPO: Schema = { type: "string", description: "A path inside the git repository. Default: the current directory" };
const ID: Schema = { type: "string", description: "The task id or a unique prefix of it" };
const TAG: Schema = { type: "string", description: "A task tag: segments of A-Z a-z 0-9 . _ @ + - joined by /" };
const TAG_FILTER: Schema = { type: "string", description: "Only the tasks whose tag is this one or lies under it (a holds a/b, not ab)" };
const WAIT_TIMEOUT_MS = { default: 600_000, minimum: 1_000, maximum: 3_600_000 };
const SETTINGS_PROPERTIES: Record<string, Schema> = {
  merge: { type: "string", enum: ["auto", "review"], description: "auto: merge a passed round. review: wait for approve" },
  maxRounds: { type: "integer", minimum: 1, maximum: 20 },
  review: { type: "boolean", description: "Run the reviewer on every round" },
  branch: { type: "string", description: "The branch the task starts from and merges into" },
  models: {
    type: "object",
    properties: { coder: { type: "string", description: "provider/model" }, reviewer: { type: "string", description: "provider/model" } },
  },
};

function spec(summary: string, properties: Record<string, Schema>, required: string[], mutates: boolean, hostOnly = false): ActionSpec {
  return { summary, params: { type: "object", required, properties }, mutates, hostOnly };
}

export const ACTIONS = {
  "models.get": spec("The factory models: the provider/model ids tasks and repository settings may use", {}, [], false),
  "models.set": spec(
    "Replace the factory models",
    { models: { type: "array", items: { type: "string" }, description: "provider/model ids" } },
    ["models"],
    true,
  ),
  "repos.list": spec("The registered repositories (those with a settings file)", {}, [], false),
  "repos.add": spec("Register a repository: give it a settings file", { repo: REPO }, ["repo"], true),
  "repos.remove": spec("Unregister a repository: remove its settings file", { repo: REPO }, ["repo"], true),
  "branches.list": spec("The repository's local branches, its default one and which hold a committed factory.yaml", { repo: REPO }, ["repo"], false),
  "settings.get": spec("The repository's stored settings, them resolved over the defaults, and the defaults", { repo: REPO }, ["repo"], false),
  "settings.set": spec(
    "Replace the repository's stored settings",
    { repo: REPO, settings: { type: "object", description: "The stored settings", properties: { ...SETTINGS_PROPERTIES, preview: { type: "boolean" } } } },
    ["repo", "settings"],
    true,
  ),
  "config.get": spec(
    "The repository's factory.yaml (the working copy, or committed on branch) and a draft when it has none",
    { repo: REPO, branch: { type: "string", description: "Read factory.yaml as committed on this branch" } },
    ["repo"],
    false,
  ),
  "config.write": spec(
    "Check factory.yaml text and write it into a registered repository's checkout (not committed)",
    {
      repo: REPO,
      text: { type: "string", description: "The factory.yaml text" },
      overwrite: { type: "boolean", description: "Replace an existing factory.yaml" },
    },
    ["repo", "text"],
    true,
  ),
  "tasks.list": spec("Every task, or the repository's", { repo: { type: "string", description: "Only the tasks of this repository" }, tag: TAG_FILTER }, [], false),
  "tasks.get": spec("One task", { id: ID }, ["id"], false),
  "tasks.import": spec(
    "Register a task another store kept: its record as the core writes them; an existing id stays unchanged. The worktree must be a linked worktree of repo (its primary checkout) on branch",
    {
      record: {
        type: "object",
        description: "id, repo, worktree, branch, title, sessionId, sessionDir, createdAt: non-empty strings; optional tag (default the system user), plan (string or null), kind (task or merge_request)",
      },
    },
    ["record"],
    true,
    true,
  ),
  "tasks.timeline": spec(
    "A task's session as entries; poll with since = the last answer's next",
    { id: ID, since: { type: "integer", minimum: 0, description: "The cursor an earlier answer returned as next" } },
    ["id"],
    false,
  ),
  "tasks.diff": spec("A task's worktree against where it branched off its target", { id: ID }, ["id"], false),
  "tasks.start": spec(
    "Start a task in its own worktree; answers once its runner is spawned",
    {
      repo: REPO,
      title: { type: "string", description: "A short title of the task" },
      request: { type: "string", description: "The full, self-contained task for the coder" },
      overrides: { type: "object", description: "Settings over the repository's stored ones", properties: SETTINGS_PROPERTIES },
      tag: { ...TAG, description: `${String(TAG.description)}. Default: the system user` },
      plan: { type: "string", description: "The memory_store path of the plan the task works from (only stored)" },
      kind: { type: "string", enum: ["task"], description: "Default: task" },
    },
    ["repo", "title", "request"],
    true,
  ),
  "tasks.wait": spec(
    "Wait until the watched tasks rest (no runner, state waiting_approve, blocked, done or cancelled, or interrupted) or one needs attention (it rests, not done), or the timeout passes. Answers {tasks, attention: ids, timedOut}",
    {
      ids: { type: "array", items: { type: "string" }, description: "Watch these tasks (ids or unique prefixes); give ids or tag" },
      tag: { ...TAG_FILTER, description: "Watch the tasks whose tag is this one or lies under it, those started during the wait too; give ids or tag" },
      ignore: { type: "array", items: { type: "string" }, description: "Task ids (or prefixes) left out of the watched ones" },
      timeoutMs: { type: "integer", minimum: WAIT_TIMEOUT_MS.minimum, maximum: WAIT_TIMEOUT_MS.maximum, description: `Default: ${WAIT_TIMEOUT_MS.default}` },
    },
    [],
    false,
  ),
  "tasks.approve": spec("Merge a task waiting for approve", { id: ID }, ["id"], true),
  "tasks.retry": spec("Another round on a blocked, cancelled or interrupted task", { id: ID }, ["id"], true),
  "tasks.cancel": spec("Stop a task", { id: ID }, ["id"], true),
  "tasks.remove": spec(
    "Delete a task's worktree, branch and record",
    { id: ID, force: { type: "boolean", description: "Also drop commits its target branch lacks and uncommitted changes" } },
    ["id"],
    true,
  ),
  "tasks.message": spec(
    "Send a task a message: a resting task runs new rounds, a running coder gets it as a follow-up",
    { id: ID, text: { type: "string", description: "The message" } },
    ["id", "text"],
    true,
  ),
} satisfies Record<string, ActionSpec>;

export type ActionName = keyof typeof ACTIONS;

type Params = Record<string, unknown>;

/** `cwd`: where relative `repo` params start. `signal`: aborts a `tasks.start` before its runner is spawned. `env`: the environment of every runner the action starts (default `process.env`). */
export interface CallOptions {
  cwd?: string;
  signal?: AbortSignal;
  env?: Record<string, string>;
}

interface CallContext {
  cwd: string | undefined;
  signal: AbortSignal | undefined;
  env: RunnerEnv | undefined;
}

function isActionName(name: string): name is ActionName {
  return Object.hasOwn(ACTIONS, name);
}

const TYPE_CHECKS: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === "string",
  boolean: (value) => typeof value === "boolean",
  integer: (value) => typeof value === "number" && Number.isInteger(value),
  object: (value) => isRecord(value),
  array: (value) => Array.isArray(value),
};

/** The params checked against the action's schema (top-level keys only; unknown keys are dropped). */
function checkParams(name: ActionName, raw: unknown, cwd: string | undefined): Params {
  if (raw !== undefined && raw !== null && !isRecord(raw)) throw new FactoryError("invalid", `${name} needs its params as an object`);
  const { required, properties } = ACTIONS[name].params as ActionSpec["params"];
  const given: Params = { ...(raw ?? {}) };
  if (given.repo === undefined && required.includes("repo") && cwd !== undefined) given.repo = cwd;
  const params: Params = {};
  for (const [key, schema] of Object.entries(properties)) {
    const value = given[key];
    if (value === undefined || value === null) {
      if (required.includes(key)) throw new FactoryError("invalid", `${name} needs ${key}`);
      continue;
    }
    const type = String(schema.type);
    if (!TYPE_CHECKS[type](value)) throw new FactoryError("invalid", `${name}: ${key} must be ${type === "integer" || type === "array" ? `an ${type}` : `a ${type}`}`);
    if (typeof schema.minimum === "number" && (value as number) < schema.minimum) throw new FactoryError("invalid", `${name}: ${key} must be at least ${schema.minimum}`);
    if (typeof schema.maximum === "number" && (value as number) > schema.maximum) throw new FactoryError("invalid", `${name}: ${key} must be at most ${schema.maximum}`);
    params[key] = value;
  }
  return params;
}

function shortId(record: TaskRecord): string {
  return record.id.slice(0, SHORT_ID_CHARS);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value !== "string" || value.trim() === "" ? undefined : value;
}

/** `repo` resolved against `cwd`; a relative one without `cwd` is `invalid`. */
function repoPath(repo: string, cwd: string | undefined): string {
  if (isAbsolute(repo)) return repo;
  if (cwd === undefined) throw new FactoryError("invalid", `repo ${repo} must be an absolute path (the call has no cwd)`);
  return resolve(cwd, repo);
}

/** The primary checkout of the repository `repo` is in. */
async function primaryOf(repo: string, cwd: string | undefined): Promise<string> {
  const path = repoPath(repo, cwd);
  try {
    return (await primaryCheckout(runCommand, path)).primary;
  } catch {
    throw new FactoryError("not_found", `${path} is not inside a git repository`);
  }
}

/** The task whose id is `id` or starts with it. */
async function findTask(id: unknown): Promise<TaskRecord> {
  const wanted = nonEmpty(id)?.trim();
  if (wanted === undefined) throw new FactoryError("invalid", "the id of a task must not be empty");
  const tasks = await listTasks();
  const exact = tasks.find((task) => task.id === wanted);
  if (exact) return exact;
  const matches = tasks.filter((task) => task.id.startsWith(wanted));
  if (matches.length === 0) throw new FactoryError("not_found", `no task has an id starting with "${wanted}"`);
  if (matches.length > 1) {
    throw new FactoryError("invalid", `"${wanted}" matches ${matches.length} tasks (${matches.map((task) => task.id).join(", ")}), give more of the id`);
  }
  return matches[0];
}

async function branchHasConfig(repo: string, branch: string): Promise<boolean> {
  return (await runCommand(["git", "cat-file", "-e", `refs/heads/${branch}:factory.yaml`], { cwd: repo })).exitCode === 0;
}

/** The blob `object` (`<ref>:<path>`) as git stores it, not trimmed. */
async function committedText(repo: string, object: string): Promise<string> {
  const result = await runCommand(["git", "cat-file", "blob", object], { cwd: repo, maxStdoutChars: 4_000_000 });
  if (result.exitCode !== 0 || result.killed || result.stdoutTruncated) throw new Error(`git cat-file blob ${object} failed (exit ${result.exitCode})`);
  return result.stdout;
}

/** The session file's entries, a torn or invalid line skipped. */
function parseEntries(text: string): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (isRecord(entry)) entries.push(entry);
    } catch {
      // a line being written
    }
  }
  return entries;
}

function numberOr0(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function customData(entry: Record<string, unknown>, customType: string): Record<string, unknown> | undefined {
  return entry.type === "custom" && entry.customType === customType && isRecord(entry.data) ? entry.data : undefined;
}

function assistantMessage(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  return entry.type === "message" && isRecord(entry.message) && entry.message.role === "assistant" ? entry.message : undefined;
}

async function taskView(record: TaskRecord): Promise<TaskView> {
  const sessionPath = (await sessionFilePath(record.sessionDir, record.sessionId)) ?? null;
  const entries = sessionPath === null ? [] : parseEntries(await readFile(sessionPath, "utf8"));
  let last: { state: State; round: number; reason: string; at: string } | null = null;
  let settings: Settings | null = null;
  let usage: TaskView["usage"] = null;
  const addUsage = (input: unknown, output: unknown, cost: unknown) => {
    usage ??= { input: 0, output: 0, cost: 0 };
    usage.input += numberOr0(input);
    usage.output += numberOr0(output);
    usage.cost += numberOr0(cost);
  };
  for (const entry of entries) {
    const state = customData(entry, "factory-state");
    if (state && typeof state.state === "string" && typeof state.round === "number" && typeof state.reason === "string") {
      last = { state: state.state as State, round: state.round, reason: state.reason, at: typeof entry.timestamp === "string" ? entry.timestamp : "" };
    }
    const task = customData(entry, "factory-task");
    if (task && isRecord(task.settings)) settings = task.settings as unknown as Settings;
    const review = customData(entry, "factory-review");
    if (review && isRecord(review.usage)) addUsage(review.usage.input, review.usage.output, review.usage.cost);
    const message = assistantMessage(entry);
    if (message && isRecord(message.usage)) {
      const { input, output, cost } = message.usage;
      addUsage(input, output, isRecord(cost) ? cost.total : undefined);
    }
  }
  const running = (await liveRunners(record)).length > 0;
  const view: Omit<TaskView, "actions"> = {
    id: record.id,
    repo: record.repo,
    worktree: record.worktree,
    branch: record.branch,
    title: record.title,
    createdAt: record.createdAt,
    tag: record.tag,
    plan: record.plan,
    kind: record.kind,
    sessionId: record.sessionId,
    sessionPath,
    state: last?.state ?? null,
    round: last?.round ?? null,
    reason: last?.reason ?? null,
    at: last?.at ?? null,
    running,
    interrupted: last !== null && !RESTING_STATES.includes(last.state) && !running,
    settings,
    usage,
  };
  return { ...view, actions: taskActions(view) };
}

const APPROVE_STATES: readonly State[] = ["waiting_approve"];
const RETRY_STATES: readonly State[] = ["blocked", "cancelled"];
const FINAL_STATES: readonly State[] = ["done", "cancelled"];

/** A live runner holds it, or its state is `running`/`merging` with a live runner. */
function isActive(view: Omit<TaskView, "actions">): boolean {
  return view.running || (view.state !== null && !RESTING_STATES.includes(view.state) && !view.interrupted);
}

/** The predicates of the task actions' own checks (`requireState`, the lock, the runner), as one list for clients. */
function taskActions(view: Omit<TaskView, "actions">): TaskActionName[] {
  const allowed: Record<TaskActionName, boolean> = {
    "tasks.approve": !view.running && !view.interrupted && view.state !== null && APPROVE_STATES.includes(view.state),
    "tasks.retry": !view.running && (view.interrupted || (view.state !== null && RETRY_STATES.includes(view.state))),
    "tasks.cancel": view.state === null || !FINAL_STATES.includes(view.state),
    "tasks.remove": !isActive(view),
    "tasks.message": view.state !== null && view.state !== "merging",
  };
  return (Object.keys(allowed) as TaskActionName[]).filter((name) => allowed[name]);
}

/** No runner lives and nothing moves the task on by itself: its state is a resting one, or it is interrupted. */
function rests(view: TaskView): boolean {
  return !view.running && (view.interrupted || (view.state !== null && RESTING_STATES.includes(view.state)));
}

/** It rests and waits for someone: every resting state but `done`. */
function needsAttention(view: TaskView): boolean {
  return rests(view) && view.state !== "done";
}

function stateText(view: TaskView): string {
  if (view.state === null) return "starting";
  if (view.interrupted) return `interrupted (${view.state} when its runner ended, round ${view.round}, ${view.reason})`;
  return `${view.state} (round ${view.round}, ${view.reason})`;
}

function requireState(view: TaskView, allowed: readonly State[], what: string, orInterrupted = false): void {
  if (orInterrupted && view.interrupted) return;
  if (view.state === null || view.interrupted || !allowed.includes(view.state)) {
    throw new FactoryError("refused", `task ${view.id.slice(0, SHORT_ID_CHARS)} is ${stateText(view)}, ${what}`);
  }
}

/** Takes the task lock; a live holder is `busy`. */
async function lock(record: TaskRecord): Promise<void> {
  try {
    await lockTask(record.id);
  } catch (error) {
    if (error instanceof TaskBusyError) throw new FactoryError("busy", error.message);
    throw error;
  }
}

/**
 * Runs `act` holding the task lock; a lock `act` handed to a runner stays with it. `check` runs first without the lock
 * (a refusal names the state, not the lock) and again under it.
 */
async function withTaskLock<T>(record: TaskRecord, check: (view: TaskView) => Promise<void>, act: (view: TaskView) => Promise<T>): Promise<T> {
  await check(await taskView(record));
  await lock(record);
  try {
    const view = await taskView(record);
    await check(view);
    return await act(view);
  } finally {
    await unlockTask(record.id);
  }
}

async function requireNoRunner(record: TaskRecord): Promise<void> {
  if ((await liveRunners(record)).length > 0) throw new FactoryError("busy", `the runner of task ${shortId(record)} is still ending, try again in a few seconds`);
}

/** A command for a task at rest goes through a new runner; the last one must have ended first. */
async function sendToRestingTask(record: TaskRecord, message: string, env: RunnerEnv | undefined): Promise<void> {
  await requireNoRunner(record);
  await sendCommand(record, message, env);
}

/** The real path of `path`, itself when it does not exist. */
function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Refuses (`refused`) an imported record unless `repo` is a primary checkout and `worktree` one of its linked
 * worktrees (per `git worktree list`) with `branch` checked out: removing the task deletes exactly those.
 */
async function requireLinkedWorktree(record: TaskRecord): Promise<void> {
  const refuse = (why: string) => new FactoryError("refused", `tasks.import: ${why}`);
  const list = await runCommand(["git", "worktree", "list", "--porcelain"], { cwd: record.repo, maxStdoutChars: 1_000_000 }).catch(() => undefined);
  if (list === undefined || list.exitCode !== 0) throw refuse(`${record.repo} is not a git repository`);
  const blocks = list.stdout
    .split("\n\n")
    .map((block) => block.split("\n").filter((line) => line !== ""))
    .filter((lines) => lines.length > 0);
  const pathOf = (lines: string[]) => realPath(lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length) ?? "");
  const [primary, ...linked] = blocks;
  if (primary === undefined || pathOf(primary) !== realPath(record.repo)) throw refuse(`${record.repo} is not the primary checkout of its repository`);
  const worktree = linked.find((lines) => pathOf(lines) === realPath(record.worktree));
  if (worktree === undefined) throw refuse(`${record.worktree} is not a linked worktree of ${record.repo}`);
  if (!worktree.includes(`branch refs/heads/${record.branch}`)) throw refuse(`${record.worktree} does not have branch ${record.branch} checked out`);
}

/**
 * Takes back the inbox line of `text` when it is the inbox's last line and no runner has sent it yet (it lies past
 * `<inbox>.read`); `false` otherwise.
 */
async function withdrawUnsentLine(record: TaskRecord, text: string): Promise<boolean> {
  const inbox = taskInboxPath(record.id);
  const bytes = await readFile(inbox).catch(() => undefined);
  if (bytes === undefined) return false;
  const line = Buffer.from(`${JSON.stringify({ text })}\n`);
  const start = bytes.length - line.length;
  const sent = Number((await readFile(inboxReadPath(inbox), "utf8").catch(() => "0")).trim()) || 0;
  if (start < sent || !bytes.subarray(start).equals(line)) return false;
  await truncate(inbox, start);
  return true;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** `1 unmerged commit (not on main)`, the count always named. */
function unmergedText(work: UnmergedWork, target: string | undefined): string {
  return `${plural(work.commits, "unmerged commit")} (not on ${target ?? "any other branch"})`;
}

function timelineKind(entry: Record<string, unknown>): { kind: TimelineKind; data: object } | undefined {
  if (entry.type === "custom" && typeof entry.customType === "string" && isRecord(entry.data)) {
    const kind = CUSTOM_KINDS[entry.customType];
    return kind === undefined ? undefined : { kind, data: entry.data };
  }
  if (entry.type !== "message" || !isRecord(entry.message)) return undefined;
  const text = messageText(entry.message);
  if (text.trim() === "") return undefined;
  if (entry.message.role === "assistant") return { kind: "coder", data: { text } };
  if (entry.message.role === "user" && !isFactoryPrompt(text)) return { kind: "user", data: { text } };
  return undefined;
}

const CUSTOM_KINDS: Record<string, TimelineKind | undefined> = {
  "factory-task": "task",
  "factory-round": "round",
  "factory-gate": "gate",
  "factory-review": "review",
  "factory-merge": "merge",
  "factory-state": "state",
  "factory-spawn": "spawn",
};

/** The entries of the session file's complete lines from byte `since` on; `next` is the end of the last one. */
async function readTimeline(record: TaskRecord, since: number): Promise<{ entries: TimelineEntry[]; next: number }> {
  const path = await sessionFilePath(record.sessionDir, record.sessionId);
  if (path === undefined) {
    if (since > 0) throw new FactoryError("invalid", `task ${shortId(record)} has no session file yet, since must be 0`);
    return { entries: [], next: 0 };
  }
  const size = (await stat(path)).size;
  if (since > size) throw new FactoryError("invalid", `since ${since} is past the end of the session file (${size} bytes)`);
  // Only the bytes from `since` on: a poll costs what was appended, not the whole session.
  const bytes = Buffer.from(await Bun.file(path).slice(since, size).arrayBuffer());
  const end = bytes.lastIndexOf(0x0a) + 1;
  if (end === 0) return { entries: [], next: since };
  const entries: TimelineEntry[] = [];
  for (const entry of parseEntries(bytes.subarray(0, end).toString("utf8"))) {
    const kind = timelineKind(entry);
    if (kind) entries.push({ at: typeof entry.timestamp === "string" ? entry.timestamp : "", ...kind });
  }
  return { entries, next: since + end };
}

/** A tag param, `invalid` unless it is segments joined by `/` (`isTaskTag`). */
function tagParam(name: ActionName, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isTaskTag(value)) throw new FactoryError("invalid", `${name}: tag ${JSON.stringify(value)} is not segments of A-Z a-z 0-9 . _ @ + - joined by /`);
  return value;
}

/** An array param of non-empty strings, `invalid` otherwise. */
function stringsParam(name: ActionName, key: string, value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const strings = value as unknown[];
  if (strings.some((item) => nonEmpty(item) === undefined)) throw new FactoryError("invalid", `${name}: ${key} must hold non-empty strings`);
  return (strings as string[]).map((item) => item.trim());
}

/** The tasks of `repo` (every repository's without), only those in the tag group `tag` when given. */
async function tasksIn(repo: string | undefined, tag: string | undefined): Promise<TaskRecord[]> {
  const records = await listTasks(repo);
  return tag === undefined ? records : records.filter((record) => tagInGroup(record.tag, tag));
}

const WAIT_POLL_MS = 500;

/** `tasks.wait`: polls the watched tasks until all rest, one needs attention, the deadline passes or none is watched. */
async function waitForTasks(
  watched: () => Promise<TaskRecord[]>,
  ignore: string[],
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<{ tasks: TaskView[]; attention: string[]; timedOut: boolean }> {
  const deadline = Date.now() + timeoutMs;
  const ignored = (record: TaskRecord) => ignore.some((prefix) => record.id.startsWith(prefix));
  while (true) {
    if (signal?.aborted) throw new FactoryError("failed", "tasks.wait was aborted");
    const tasks = await Promise.all((await watched()).filter((record) => !ignored(record)).map(taskView));
    const attention = tasks.filter(needsAttention).map((view) => view.id);
    if (tasks.every(rests) || attention.length > 0) return { tasks, attention, timedOut: false };
    if (Date.now() >= deadline) return { tasks, attention, timedOut: true };
    await abortableSleep(Math.min(WAIT_POLL_MS, deadline - Date.now()), signal);
  }
}

/** Sleeps `ms`, less when `signal` aborts first. */
async function abortableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  await new Promise<void>((done) => {
    const wake = () => {
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", wake);
      done();
    }, ms);
    signal?.addEventListener("abort", wake, { once: true });
  });
}

/** How long a cancel or retry of an interrupted task waits for its runner to write a state or end. */
const RUNNER_START_WAIT_MS = 15_000;

/**
 * For a command to an interrupted task: waits until the session has more than `statesBefore` `factory-state` entries
 * (the runner runs) or the runner ended without one (`failed`, naming the last line of its log). A runner still
 * alive after `RUNNER_START_WAIT_MS` counts as started.
 */
async function requireRunnerStarted(record: TaskRecord, statesBefore: number): Promise<void> {
  const deadline = Date.now() + RUNNER_START_WAIT_MS;
  const wroteState = async () => (await readFactoryStates(record.sessionDir, record.sessionId)).count > statesBefore;
  while (Date.now() < deadline) {
    if (await wroteState()) return;
    if ((await liveRunners(record)).length === 0) {
      if (await wroteState()) return;
      const log = await readFile(taskLogPath(record.id), "utf8").catch(() => "");
      const last = log.trim().split("\n").at(-1)?.trim().slice(0, 300) ?? "";
      throw new FactoryError("failed", `the runner of task ${shortId(record)} ended before it ran${last === "" ? "" : ` (${last})`}`);
    }
    await Bun.sleep(100);
  }
}

async function settingsOf(repo: string): Promise<{ stored: StoredSettings; resolved: ResolvedSettings; defaults: ResolvedSettings }> {
  const stored = await loadSettings(repo);
  const fallback = await defaultBranch(repo).catch(() => undefined);
  const branch = stored.branch ?? fallback;
  if (branch === undefined) throw new FactoryError("refused", `${repo} has no default branch (origin/HEAD, main and master do not exist locally)`);
  return { stored, resolved: resolveRepoSettings(stored, {}, branch), defaults: { ...DEFAULT_SETTINGS, models: {}, branch: fallback ?? branch } };
}

/** `requireModels` as a `refused` error. */
async function requireFactoryModels(models: Settings["models"]): Promise<void> {
  try {
    await requireModels(models);
  } catch (error) {
    throw new FactoryError("refused", errorText(error));
  }
}

function storedSettingsParam(raw: unknown, prefix: string): StoredSettings {
  try {
    return parseStoredSettings(raw);
  } catch (error) {
    throw new FactoryError("invalid", `${prefix}${errorText(error)}`);
  }
}

const HANDLERS: Record<ActionName, (params: Params, context: CallContext) => Promise<unknown>> = {
  "models.get": async () => ({ models: await loadModels() }),

  "models.set": async (params) => {
    try {
      await saveModels(params.models as string[]);
    } catch (error) {
      // A file system error (it has a code) is `failed`; a wrong id is the caller's.
      if ((error as NodeJS.ErrnoException).code !== undefined) throw error;
      throw new FactoryError("invalid", `models.set: ${errorText(error)}`);
    }
    return { models: await loadModels() };
  },

  "repos.list": async () => ({ repos: await registeredRepos() }),

  "repos.add": async (params, { cwd }) => {
    const repo = await primaryOf(params.repo as string, cwd);
    if (!(await registeredRepos()).includes(repo)) await saveSettings(repo, {});
    return { repo, repos: await registeredRepos() };
  },

  "repos.remove": async (params, { cwd }) => {
    // A registered path is removed as it is: the repository may be gone from disk.
    const path = repoPath(params.repo as string, cwd);
    const repo = (await registeredRepos()).includes(path) ? path : await primaryOf(path, cwd);
    if (!(await unregisterRepo(repo))) throw new FactoryError("not_found", `${repo} is not registered`);
    return { repos: await registeredRepos() };
  },

  "branches.list": async (params, { cwd }) => {
    const repo = await primaryOf(params.repo as string, cwd);
    const refs = (await git(runCommand, repo, ["for-each-ref", "--format=%(refname)", "refs/heads"])).split("\n").filter((ref) => ref !== "");
    const fallback = await defaultBranch(repo).catch(() => undefined);
    const branches = [];
    for (const ref of refs) {
      const name = ref.slice("refs/heads/".length);
      branches.push({ name, default: name === fallback, hasConfig: await branchHasConfig(repo, name) });
    }
    return { branches };
  },

  "settings.get": async (params, { cwd }) => settingsOf(await primaryOf(params.repo as string, cwd)),

  "settings.set": async (params, { cwd }) => {
    const repo = await primaryOf(params.repo as string, cwd);
    const settings = storedSettingsParam(params.settings, "settings.");
    await requireFactoryModels(settings.models ?? {});
    await saveSettings(repo, settings);
    return settingsOf(repo);
  },

  "config.get": async (params, { cwd }) => {
    const repo = await primaryOf(params.repo as string, cwd);
    const branch = params.branch as string | undefined;
    let text: string | null;
    if (branch !== undefined) {
      if (!(await localBranchExists(repo, branch))) throw new FactoryError("not_found", `${repo} has no local branch ${branch}`);
      text = (await branchHasConfig(repo, branch)) ? await committedText(repo, `refs/heads/${branch}:factory.yaml`) : null;
    } else {
      text = await readFile(join(repo, "factory.yaml"), "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    }
    if (text !== null) return { exists: true, text, draft: null, source: [] };
    const draft = initDraft(repo);
    return { exists: false, text: null, draft: draft.text, source: draft.source === "" ? [] : draft.source.split(", ") };
  },

  "config.write": async (params, { cwd }) => {
    const repo = await primaryOf(params.repo as string, cwd);
    if (!(await registeredRepos()).includes(repo)) throw new FactoryError("not_found", `${repo} is not registered, add it with repos.add first`);
    const text = params.text as string;
    try {
      parseFactoryYaml(text);
    } catch (error) {
      throw new FactoryError("invalid", errorText(error));
    }
    const path = join(repo, "factory.yaml");
    if (params.overwrite !== true && existsSync(path)) throw new FactoryError("refused", `${path} exists, give overwrite: true to replace it`);
    await writeFile(path, text, "utf8");
    return { path };
  },

  "tasks.list": async (params, { cwd }) => {
    const tag = tagParam("tasks.list", params.tag);
    const repo = params.repo === undefined ? undefined : await primaryOf(params.repo as string, cwd);
    return { tasks: await Promise.all((await tasksIn(repo, tag)).map(taskView)) };
  },

  "tasks.wait": async (params, { signal }) => {
    const ids = stringsParam("tasks.wait", "ids", params.ids);
    const tag = tagParam("tasks.wait", params.tag);
    if ((ids === undefined) === (tag === undefined)) throw new FactoryError("invalid", "tasks.wait needs exactly one of ids and tag");
    const ignore = stringsParam("tasks.wait", "ignore", params.ignore) ?? [];
    const timeoutMs = (params.timeoutMs as number | undefined) ?? WAIT_TIMEOUT_MS.default;
    if (ids !== undefined) {
      // Ids are resolved once: a prefix that turns ambiguous later must not end the wait.
      const records = await Promise.all(ids.map(findTask));
      return waitForTasks(async () => records, ignore, timeoutMs, signal);
    }
    return waitForTasks(() => tasksIn(undefined, tag), ignore, timeoutMs, signal);
  },

  "tasks.get": async (params) => taskView(await findTask(params.id)),
  "tasks.import": async (params) => {
    const raw = params.record as Record<string, unknown>;
    let record: TaskRecord;
    try {
      record = parseTaskRecord(raw, String(raw.id));
      if (!/^[0-9a-f-]{36}$/.test(record.id)) throw new Error(`${record.id} is not a task id`);
      if (!isAbsolute(record.repo) || !isAbsolute(record.worktree)) throw new Error("repo and worktree must be absolute paths");
    } catch (error) {
      throw new FactoryError("invalid", `tasks.import: ${errorText(error)}`);
    }
    const existing = (await listTasks()).find((task) => task.id === record.id);
    if (existing) return taskView(existing);
    await requireLinkedWorktree(record);
    await writeTask(record);
    return taskView(record);
  },

  "tasks.timeline": async (params) => readTimeline(await findTask(params.id), (params.since as number | undefined) ?? 0),

  "tasks.diff": async (params) => {
    const record = await findTask(params.id);
    const target = await taskMainBranch(record.sessionDir, record.sessionId);
    if (target === undefined) throw new FactoryError("refused", `task ${shortId(record)} has not started yet, so it has no diff`);
    if (!existsSync(record.worktree)) throw new FactoryError("refused", `the worktree of task ${shortId(record)} is gone (${record.worktree})`);
    const base = await git(runCommand, record.worktree, ["merge-base", "HEAD", `refs/heads/${target}`]);
    const tree = await snapshotTree(runCommand, record.worktree);
    const diff = await treeDiff(runCommand, record.worktree, base, tree);
    const files: FileCounts[] = await diffFileCounts(runCommand, record.worktree, base, tree);
    return { base, diff: diff.patch, files };
  },

  "tasks.start": async (params, { cwd, signal, env }) => {
    const title = nonEmpty(params.title);
    const request = nonEmpty(params.request);
    if (title === undefined) throw new FactoryError("invalid", "tasks.start needs a title that is not empty");
    if (request === undefined) throw new FactoryError("invalid", "tasks.start needs a request that is not empty");
    const tag = tagParam("tasks.start", params.tag);
    if (params.plan !== undefined && nonEmpty(params.plan) === undefined) throw new FactoryError("invalid", "tasks.start: plan must not be empty");
    const plan = params.plan as string | undefined;
    if (params.kind !== undefined && params.kind !== "task") throw new FactoryError("invalid", `tasks.start: kind ${JSON.stringify(params.kind)} is not supported yet`);
    let overrides: StoredSettings = {};
    try {
      if (params.overrides !== undefined) overrides = parseSettingsFields(params.overrides as Params, "overrides.");
    } catch (error) {
      throw new FactoryError("invalid", errorText(error));
    }
    const repo = await primaryOf(params.repo as string, cwd);
    await requireFactoryModels(resolveSettings(await loadSettings(repo), overrides, "").models);
    try {
      return taskView(await launchTask({ repo, title, request, overrides, tag, plan, signal, env }));
    } catch (error) {
      if (error instanceof LaunchRefusedError) throw new FactoryError("refused", error.message);
      throw error;
    }
  },

  "tasks.approve": async (params, { env }) => {
    const record = await findTask(params.id);
    const check = async (view: TaskView) => requireState(view, APPROVE_STATES, "approve needs waiting_approve");
    await withTaskLock(record, check, () => sendToRestingTask(record, "/factory approve", env));
    return taskView(record);
  },

  "tasks.retry": async (params, { env }) => {
    const record = await findTask(params.id);
    // An interrupted task is set right by the session's start (`resumeTask`) before the retry runs.
    const check = async (view: TaskView) => requireState(view, RETRY_STATES, "retry needs blocked, cancelled or interrupted", true);
    const sent = await withTaskLock(record, check, async (view) => {
      const statesBefore = (await readFactoryStates(record.sessionDir, record.sessionId)).count;
      await sendToRestingTask(record, "/factory retry", env);
      return { interrupted: view.interrupted, statesBefore };
    });
    if (sent.interrupted) await requireRunnerStarted(record, sent.statesBefore);
    return taskView(record);
  },

  "tasks.cancel": async (params, { env }) => {
    const record = await findTask(params.id);
    const before = await taskView(record);
    if (before.state !== null && FINAL_STATES.includes(before.state)) throw new FactoryError("refused", `task ${shortId(record)} is ${before.state} already`);
    // The runner holds the task lock until it exits: stop it, then take the lock.
    await stopRunners(record);
    const sent = await withTaskLock(
      record,
      async () => undefined,
      async (view) => {
        // A runner stopped before the task was recorded leaves nothing to cancel in the session.
        if (view.state === null) return undefined;
        const statesBefore = (await readFactoryStates(record.sessionDir, record.sessionId)).count;
        await sendCommand(record, "/factory cancel", env);
        return { interrupted: view.interrupted, statesBefore };
      },
    );
    if (sent?.interrupted) await requireRunnerStarted(record, sent.statesBefore);
    return taskView(record);
  },

  "tasks.remove": async (params) => {
    const record = await findTask(params.id);
    const check = async (view: TaskView) => {
      if (isActive(view)) throw new FactoryError("refused", `task ${shortId(record)} is running, cancel it first`);
    };
    return withTaskLock(record, check, async () => {
      const target = await taskMainBranch(record.sessionDir, record.sessionId);
      const work = await unmergedWork(record, target);
      const dropsWork = work.commits > 0 || work.dirty;
      if (dropsWork && params.force !== true) {
        const changes = work.dirty ? " and uncommitted changes in its worktree" : "";
        throw new FactoryError("refused", `task ${shortId(record)} has ${unmergedText(work, target)}${changes}, give force: true to remove it anyway`, { force: true });
      }
      await deleteTask(record);
      const dropped = dropsWork ? `${unmergedText(work, target)}${work.dirty ? " and uncommitted changes" : ""}` : null;
      return { removed: record.id, dropped };
    });
  },

  "tasks.message": async (params, { env }) => {
    const record = await findTask(params.id);
    const text = nonEmpty(params.text);
    if (text === undefined) throw new FactoryError("invalid", "tasks.message needs a text that is not empty");
    const view = await taskView(record);
    if (view.state === null) throw new FactoryError("refused", `task ${shortId(record)} has not started yet, send the message once it runs`);
    if (view.state === "merging") throw new FactoryError("refused", `task ${shortId(record)} is merging, send the message when the merge has ended`);
    // `messageTask` takes the task lock itself (resting) or appends to the live runner's inbox (running).
    const deliver = async () => {
      try {
        await messageTask(record, text, env);
      } catch (error) {
        if (error instanceof MessageRefusedError) throw new FactoryError("refused", error.message);
        if (error instanceof TaskBusyError) throw new FactoryError("busy", oneLine(errorText(error)));
        throw new FactoryError("failed", oneLine(errorText(error)));
      }
    };
    await deliver();
    // A runner that ended as the line was appended never sends it: take it back and start a runner with it.
    if ((await liveRunners(record)).length === 0 && (await withdrawUnsentLine(record, text))) await deliver();
    return taskView(record);
  },
};

/** One sentence: a multi-line error (git output) on one line. */
function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/** Runs the action `name` with `params` (`CallOptions`). Resolves with plain JSON, rejects with a `FactoryError`. */
export async function callAction(name: string, params: unknown, options: CallOptions = {}): Promise<unknown> {
  const { cwd, signal, env } = options;
  if (!isActionName(name)) throw new FactoryError("invalid", `unknown action "${name}"`);
  const checked = checkParams(name, params, cwd);
  try {
    return await HANDLERS[name](checked, { cwd, signal, env });
  } catch (error) {
    if (error instanceof FactoryError) throw error;
    if (error instanceof TaskBusyError) throw new FactoryError("busy", error.message);
    throw new FactoryError("failed", oneLine(errorText(error)));
  }
}
