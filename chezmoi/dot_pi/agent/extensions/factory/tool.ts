/**
 * The `factory` tool: an agent hands a coding task to a background factory run and checks on it later.
 *
 * - Consumes the tool parameters (`FactoryToolParams`) and the caller's cwd
 * - Provides `runFactoryAction`, the whole tool without Pi: `start` (worktree, record, detached runner; answers once
 *   the runner is spawned, an abort before that undoes it), `status`, `list` (a `running`/`merging` task without a live
 *   runner is `interrupted`), `approve`, `retry` (also of an interrupted task), `cancel` (stops a live runner first: two
 *   Pi processes must never share a session), `remove` (worktree, branch, record and log of a task that is not
 *   running; unmerged commits or uncommitted changes only with `force`)
 * - Every action that checks a task's state and then acts on it holds the task lock (`tasks.ts`) from the check on;
 *   a runner it spawns takes the lock over until it exits
 * - Provides `registerFactoryTool` (sequential: one call at a time): every failure, the caller's own included, is an
 *   `isError` result of one sentence
 */
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { primaryCheckout } from "./git.ts";
import { deleteTask, launchTask, liveRunners, sendCommand, stopRunners, unmergedWork, type UnmergedWork } from "./launch.ts";
import { lastFactoryState, taskMainBranch } from "./runner.ts";
import { runCommand } from "./run.ts";
import type { StoredSettings } from "./settings.ts";
import { parseSettingsFields, RESTING_STATES, type State, type StateData } from "./state.ts";
import { listTasks, lockTask, unlockTask, type TaskRecord } from "./tasks.ts";
import { errorText, isRecord } from "./util.ts";

export const FACTORY_ACTIONS = ["start", "status", "list", "approve", "retry", "cancel", "remove"] as const;
export type FactoryAction = (typeof FACTORY_ACTIONS)[number];

export interface FactoryToolParams {
  action: FactoryAction;
  /** A path inside the repository; relative to the caller's cwd. Default: the caller's cwd. */
  repo?: string;
  title?: string;
  request?: string;
  /** A task id or a unique prefix of one. */
  id?: string;
  overrides?: StoredSettings;
  /** remove: also drop commits the target branch lacks and uncommitted changes. */
  force?: boolean;
}

/**
 * One task as the tool reports it: its record and its last `factory-state`, null before the first. `interrupted`:
 * the state is `running` or `merging` but no runner of the task lives (it crashed, or the host rebooted).
 */
export interface TaskView {
  record: TaskRecord;
  state: StateData | null;
  interrupted: boolean;
}

export type FactoryDetails = TaskView | { tasks: TaskView[] };

export interface FactoryAnswer {
  text: string;
  details: FactoryDetails;
}

const SHORT_ID_CHARS = 8;

const parameters = {
  type: "object",
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: [...FACTORY_ACTIONS],
      description:
        "start: new task (needs title, request). status: one task (needs id). list: the repo's tasks. approve: merge a task waiting for approve. retry: another round on a blocked, cancelled or interrupted task. cancel: stop a task. remove: delete a task's worktree, branch and record",
    },
    repo: { type: "string", description: "A path inside the git repository. Default: the current directory" },
    title: { type: "string", description: "start: a short title of the task" },
    request: { type: "string", description: "start: the full, self-contained task for the coder" },
    id: { type: "string", description: "The task id or a unique prefix of it (status, approve, retry, cancel, remove)" },
    force: { type: "boolean", description: "remove: also drop the task's commits its target branch lacks and its uncommitted changes" },
    overrides: {
      type: "object",
      description: "start: settings over the repo's stored ones",
      properties: {
        merge: { type: "string", enum: ["auto", "review"], description: "auto: merge a passed round. review: wait for approve" },
        maxRounds: { type: "integer", minimum: 1, maximum: 20 },
        review: { type: "boolean", description: "Run the reviewer on every round" },
        branch: { type: "string", description: "The branch the task starts from and merges into" },
        models: {
          type: "object",
          properties: { coder: { type: "string", description: "provider/model" }, reviewer: { type: "string", description: "provider/model" } },
        },
      },
    },
  },
};

function shortId(record: TaskRecord): string {
  return record.id.slice(0, SHORT_ID_CHARS);
}

function stateText(view: TaskView): string {
  const { state } = view;
  if (state === null) return "starting";
  if (view.interrupted) return `interrupted (${state.state} when its runner ended, round ${state.round}, ${state.reason})`;
  return `${state.state} (round ${state.round}, ${state.reason})`;
}

async function viewOf(record: TaskRecord): Promise<TaskView> {
  const state = (await lastFactoryState(record.sessionDir, record.sessionId)) ?? null;
  const interrupted = state !== null && !RESTING_STATES.includes(state.state) && (await liveRunners(record)).length === 0;
  return { record, state, interrupted };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

/** `repo` resolved against `cwd`; `cwd` without one. */
function repoPath(repo: string | undefined, cwd: string): string {
  return repo === undefined ? cwd : isAbsolute(repo) ? repo : resolve(cwd, repo);
}

/** The primary checkout of the repository `repo` (relative to `cwd`) or `cwd` is in. */
async function primaryOf(repo: string | undefined, cwd: string): Promise<string> {
  const path = repoPath(repo, cwd);
  try {
    return (await primaryCheckout(runCommand, path)).primary;
  } catch {
    throw new Error(`${path} is not inside a git repository`);
  }
}

/** The task whose id is `id` or starts with it. */
async function findTask(action: FactoryAction, id: string | undefined): Promise<TaskRecord> {
  const wanted = nonEmpty(id)?.trim();
  if (wanted === undefined) throw new Error(`${action} needs the id of a task`);
  const tasks = await listTasks();
  const exact = tasks.find((task) => task.id === wanted);
  if (exact) return exact;
  const matches = tasks.filter((task) => task.id.startsWith(wanted));
  if (matches.length === 0) throw new Error(`no task has an id starting with "${wanted}"`);
  if (matches.length > 1) throw new Error(`"${wanted}" matches ${matches.length} tasks (${matches.map((task) => task.id).join(", ")}), give more of the id`);
  return matches[0];
}

function requireState(view: TaskView, allowed: readonly State[], what: string, orInterrupted = false): void {
  if (orInterrupted && view.interrupted) return;
  if (view.state === null || view.interrupted || !allowed.includes(view.state.state)) {
    throw new Error(`task ${shortId(view.record)} is ${stateText(view)}, ${what}`);
  }
}

/**
 * Runs `act` on the task's view holding the task lock; a lock `act` handed to a runner stays with it. `check` runs
 * first without the lock (a refusal names the state, not the lock) and again under it.
 */
async function withTaskLock<T>(record: TaskRecord, check: (view: TaskView) => Promise<void>, act: (view: TaskView) => Promise<T>): Promise<T> {
  await check(await viewOf(record));
  await lockTask(record.id);
  try {
    const view = await viewOf(record);
    await check(view);
    return await act(view);
  } finally {
    await unlockTask(record.id);
  }
}

/** A command for a task at rest goes through a new runner; the last one must have ended first. */
async function sendToRestingTask(view: TaskView, message: string): Promise<void> {
  if ((await liveRunners(view.record)).length > 0) throw new Error(`the runner of task ${shortId(view.record)} is still ending, try again in a few seconds`);
  await sendCommand(view.record, message);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** `1 unmerged commit (not on main)`, the count always named. */
function unmergedText(work: UnmergedWork, target: string | undefined): string {
  return `${plural(work.commits, "unmerged commit")} (not on ${target ?? "any other branch"})`;
}

/** Runs one tool action. Throws an `Error` of one sentence for anything that went wrong. */
export async function runFactoryAction(params: FactoryToolParams, cwd: string, signal?: AbortSignal): Promise<FactoryAnswer> {
  switch (params.action) {
    case "start": {
      const title = nonEmpty(params.title);
      const request = nonEmpty(params.request);
      if (title === undefined) throw new Error("start needs a title");
      if (request === undefined) throw new Error("start needs a request");
      const overrides = isRecord(params.overrides) ? parseSettingsFields(params.overrides, "overrides.") : {};
      const record = await launchTask({ repo: repoPath(params.repo, cwd), title, request, overrides, signal });
      return {
        text: `Started task ${shortId(record)} "${title}" in ${record.worktree}; check it with action "status".`,
        details: { record, state: null, interrupted: false },
      };
    }
    case "status": {
      const view = await viewOf(await findTask("status", params.id));
      return { text: `Task ${shortId(view.record)} "${view.record.title}": ${stateText(view)}.`, details: view };
    }
    case "list": {
      const repo = await primaryOf(params.repo, cwd);
      const tasks = await Promise.all((await listTasks(repo)).map(viewOf));
      const lines = tasks.map((view) => `${shortId(view.record)} "${view.record.title}": ${stateText(view)}`);
      return { text: tasks.length === 0 ? `No tasks in ${repo}.` : lines.join("\n"), details: { tasks } };
    }
    case "approve": {
      const record = await findTask("approve", params.id);
      const check = async (view: TaskView) => requireState(view, ["waiting_approve"], "approve needs waiting_approve");
      return withTaskLock(record, check, async (view) => {
        await sendToRestingTask(view, "/factory approve");
        return { text: `Approved task ${shortId(record)}: the merge runs in the background.`, details: view };
      });
    }
    case "retry": {
      const record = await findTask("retry", params.id);
      // An interrupted task is set right by the session's start (`resumeTask`) before the retry runs.
      const check = async (view: TaskView) => requireState(view, ["blocked", "cancelled"], "retry needs blocked, cancelled or interrupted", true);
      return withTaskLock(record, check, async (view) => {
        await sendToRestingTask(view, "/factory retry");
        return { text: `Retrying task ${shortId(record)}: a new round runs in the background.`, details: view };
      });
    }
    case "cancel": {
      const record = await findTask("cancel", params.id);
      const before = await viewOf(record);
      if (before.state?.state === "done" || before.state?.state === "cancelled") throw new Error(`task ${shortId(record)} is ${before.state.state} already`);
      // The runner holds the task lock until it exits: stop it, then take the lock.
      await stopRunners(record);
      return withTaskLock(record, async () => undefined, async (view) => {
        // A runner stopped before the task was recorded leaves nothing to cancel in the session.
        if (view.state === null) return { text: `Stopped task ${shortId(record)} before it started.`, details: view };
        await sendCommand(record, "/factory cancel");
        return { text: `Cancelling task ${shortId(record)}.`, details: view };
      });
    }
    case "remove": {
      const record = await findTask("remove", params.id);
      const check = async (view: TaskView) => {
        const running = view.state !== null && !RESTING_STATES.includes(view.state.state);
        if (running || (await liveRunners(record)).length > 0) throw new Error(`task ${shortId(record)} is running, cancel it first`);
      };
      return withTaskLock(record, check, async (view) => {
        const target = await taskMainBranch(record.sessionDir, record.sessionId);
        const work = await unmergedWork(record, target);
        const dropsWork = work.commits > 0 || work.dirty;
        if (dropsWork && params.force !== true) {
          const changes = work.dirty ? " and uncommitted changes in its worktree" : "";
          throw new Error(`task ${shortId(record)} has ${unmergedText(work, target)}${changes}, give force: true to remove it anyway`);
        }
        await deleteTask(record);
        const dropped = dropsWork ? `, dropping ${unmergedText(work, target)}${work.dirty ? " and uncommitted changes" : ""}` : "";
        return { text: `Removed task ${shortId(record)}: its record, log, worktree and branch ${record.branch}${dropped}.`, details: view };
      });
    }
    default:
      throw new Error(`unknown action "${String((params as { action: unknown }).action)}"`);
  }
}

export function registerFactoryTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "factory",
    label: "Factory",
    description:
      'Hand a self-contained coding task to a background factory run: it codes in its own git worktree, runs the repo\'s gates and merges when they pass. Use it in a git repository whose target branch has a committed factory.yaml; "start" returns at once with the task id. Check on the task later with "status" (or "list"), and use approve, retry, cancel and remove as the state asks.',
    promptSnippet: "Run a self-contained coding task in the background in a git repo with a factory.yaml; check it later with status",
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const answer = await runFactoryAction(params as unknown as FactoryToolParams, ctx.cwd, signal);
        return { content: [{ type: "text", text: answer.text }], details: answer.details };
      } catch (error) {
        return { content: [{ type: "text", text: `factory: ${errorText(error)}` }], details: undefined, isError: true };
      }
    },
  });
}
