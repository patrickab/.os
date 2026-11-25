/**
 * The operations of a factory task (start, approve, retry, cancel, init) and the run bookkeeping they share with the
 * event handlers in `index.ts`, over an explicit `OpsDeps`. An operation reports an expected failure (no task, wrong
 * state, invalid payload, not a worktree) as `{ ok: false }` and never throws for it; showing it is the caller's job.
 *
 * A merge request (`Task.kind`) has no coder: its start and its retry run `runMergeRequest` in the background
 * (`finishMergeRequest`), and the merge follows it there when it passed into `merging`.
 */
import { existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { commitMessageFallback, isConventionalTitle } from "./commitmsg.ts";
import { loadTaskFiles, type TaskFiles } from "./config.ts";
import { initDraft } from "./draft.ts";
import {
  abortLeftoverRebase,
  git,
  LOCKFILES,
  nulList,
  primaryCheckout,
  rebaseInProgress,
  removeUntracked,
  taskBase,
  taskDiff,
  taskGit,
  trackedChanges,
  treeDiff,
  uncommittedFiles,
} from "./git.ts";
import { mergeTask, rebaseWorktree } from "./merge.ts";
import { runMerge, runMergeRequest, type MergeRequestSteps, type PipelineSteps } from "./pipeline.ts";
import { runReview } from "./review.ts";
import { CommandRunner, type Exec } from "./run.ts";
import {
  applyEntry,
  conflictFeedback,
  customDraft,
  FEEDBACK_TYPE,
  isMergeRequest,
  type MergeData,
  mergeFailedPrompt,
  parseStartPayload,
  PROTOCOL_VERSION,
  RETRY_PROMPT,
  stateDraft,
  type Draft,
  type EntryData,
  type EntryType,
  type FeedbackDraft,
  type MergeIntentData,
  type Snapshot,
  type State,
  type Task,
  type Trigger,
} from "./state.ts";
import { errorText } from "./util.ts";

/** Shows what the pipeline does: set while a round, a review or a merge runs. */
export const STATUS_KEY = "factory";
/** pi-host keeps a session with this status from idle eviction. A merge sets it: `/factory approve` starts no agent run. */
export const LIVENESS_KEY = "session-liveness";

export type OpResult = { ok: true; message?: string } | { ok: false; error: string };

/** What a run opens with: `conflict`, the feedback of a rebase that conflicts (the run opens with a `conflict` round), or `failed`, why none opens. */
export type RunOpening = { conflict?: string; failed?: string };

/** A feedback message to the coder, as `pi.sendMessage` and `before_agent_start` take it. */
export type CoderMessage = Omit<FeedbackDraft, "type">;

/** A run that follows up on the merged task (`followup.ts`), from the user message that opened it on. */
export interface FollowUpRun {
  /** The task's merged commit the follow-up builds on. */
  merged: string | null;
  /** `factory_new_task` started a task for the current user message. */
  spawnedForMessage: boolean;
}

/** The task state of one session, shared by the operations and the event handlers. */
export interface TaskSession {
  snapshot: Snapshot | undefined;
  /** `factory.yaml` and the role prompts the current run is held to, read once per run. */
  files: Promise<TaskFiles> | undefined;
  starting: boolean;
  /** Set on `session_shutdown`: Pi is stale from then on and a merge still in flight must not write through it. */
  disposed: boolean;
  /** Runs every command of the task; `cancel` kills them. */
  readonly runner: CommandRunner;
  /** Set by a user message to the task while it is `done`/`merged`, cleared by one in any other resting state. */
  followUp: FollowUpRun | undefined;
}

/** The session state and the Pi capabilities the operations use. */
export interface OpsDeps {
  session: TaskSession;
  cwd: string;
  appendEntry<K extends EntryType>(customType: K, data: EntryData[K]): void;
  sendUserMessage(text: string): void;
  /**
   * Records `text` as a user message without starting a turn. A merge request's start: Pi writes the session file only
   * once it holds a message, and a merge request never sends one.
   */
  recordRequest(text: string): void;
  /** False when this Pi offers no way to `recordRequest`: a merge request's start must fail before it records anything. */
  canRecordRequest(): boolean;
  sendMessage(message: CoderMessage, options: { triggerTurn: boolean }): void;
  setStatus(key: string, text: string | undefined): void;
  isIdle(): boolean;
  abort(): void;
  /** Switches the coder to `provider/id`; false when that model is not available. */
  setModel(model: string): Promise<boolean>;
  hasPendingMessages(): boolean;
  /** The user's messages after the request, for the reviewer. */
  followUps(): string[];
  /** The session's model as `provider/id`, the reviewer's fallback. */
  sessionModel(): string | null;
  sessionId(): string;
}

export function newTaskSession(): TaskSession {
  return { snapshot: undefined, files: undefined, starting: false, disposed: false, runner: new CommandRunner(), followUp: undefined };
}

/** The feedback message of a `conflict` round that opens a run. */
export function conflictMessage(round: number, content: string): CoderMessage {
  return { customType: FEEDBACK_TYPE, content, display: true, details: { round, trigger: "conflict" } };
}

/** Appends an entry and keeps the snapshot in step with it. */
export function record<K extends EntryType>(deps: OpsDeps, customType: K, data: EntryData[K]): void {
  deps.appendEntry(customType, data);
  deps.session.snapshot = applyEntry(deps.session.snapshot, customType, data);
}

export function endState(deps: OpsDeps, current: Snapshot, state: State, reason: string): void {
  record(deps, "factory-state", { state, round: current.round, reason });
}

export function recordDrafts(deps: OpsDeps, drafts: Draft[]): void {
  for (const draft of drafts) if (draft.type === "custom") record(deps, draft.customType, draft.data);
}

export function startRun(deps: OpsDeps, current: Snapshot, trigger: Trigger, { conflict }: RunOpening): void {
  deps.session.runner.reset();
  deps.session.files = undefined;
  const opens = conflict === undefined ? trigger : "conflict";
  record(deps, "factory-round", { round: current.round + 1, trigger: opens });
  record(deps, "factory-state", { state: "running", round: current.round + 1, reason: opens });
}

/** The coder's question to the supervisor (`factory_ask_supervisor`): the task rests in `waiting_answer` until the next message. */
export function askSupervisor(deps: OpsDeps, current: Snapshot, question: string): void {
  record(deps, "factory-question", { text: question });
  endState(deps, current, "waiting_answer", "question");
}

/**
 * The message that answers the open question: the coder continues the same round. Unlike `startRun` it opens no round
 * (the run's budget stays spent) and `openRun` does not come first, so the worktree is neither squashed nor rebased.
 */
export function resumeAnswered(deps: OpsDeps, current: Snapshot): void {
  deps.session.runner.reset();
  record(deps, "factory-state", { state: "running", round: current.round, reason: "answer" });
}

function targetTip(exec: Exec, cwd: string, mainBranch: string): Promise<string> {
  return git(exec, cwd, ["rev-parse", `refs/heads/${mainBranch}`]);
}

/**
 * The rules of the current run, read once per run: from the task's base, a merge request's from its target's tip. A
 * merge request's base is where its source forked, which can be old: a retry is held to the gates the target has now.
 * `finishMerge` reads a merge request's again.
 */
export function taskFiles(deps: OpsDeps, task: Task): Promise<TaskFiles> {
  const { session, cwd } = deps;
  const exec = session.runner.cleanup;
  return (session.files ??= (async () => loadTaskFiles(exec, cwd, isMergeRequest(task) ? await targetTip(exec, cwd, task.mainBranch) : await taskBase(exec, cwd, task)))());
}

/**
 * The checks before a run opens on a task at rest: a rebase in progress (the coder's) is left as it is and gets a
 * `conflict` round, else the worktree is committed and rebased onto the target branch, a conflicting rebase aborted
 * into a `conflict` round, any other failure of it returned as `failed`.
 */
export async function openRun(deps: OpsDeps, current: Snapshot): Promise<RunOpening> {
  const { task } = current;
  const { runner } = deps.session;
  const open = await rebaseInProgress(runner.cleanup, deps.cwd);
  if (open) return { conflict: conflictFeedback(current.round, task.mainBranch, open, true) };
  const protectedGlobs = (await taskFiles(deps, task).catch(() => undefined))?.config.protected ?? [];
  try {
    const conflicts = await rebaseWorktree(runner.cleanup, runner.cleanup, deps.cwd, task, protectedGlobs);
    return conflicts ? { conflict: conflictFeedback(current.round, task.mainBranch, conflicts, false) } : {};
  } catch (error) {
    return { failed: `rebase_failed: ${errorText(error)}` };
  }
}

export function pipelineSteps(deps: OpsDeps, task: Task, taskFilesNow: TaskFiles, liveness: boolean): PipelineSteps {
  const { session, cwd: root } = deps;
  const { runner } = session;
  const status = (text: string) => {
    deps.setStatus(STATUS_KEY, text);
    if (liveness) deps.setStatus(LIVENESS_KEY, text);
  };
  return {
    status,
    cancelled: () => runner.cancelled,
    pendingMessages: () => deps.hasPendingMessages(),
    config: () => taskFilesNow.config,
    runCommand: (argv) => runner.run(argv, { cwd: root }),
    diff: async () => taskDiff(runner.run, root, await taskBase(runner.run, root, task), taskFilesNow.config.lockfiles),
    review: (round, diff) =>
      runReview({
        exec: runner.run,
        root,
        round,
        task,
        followUps: deps.followUps(),
        diff,
        model: task.settings.models.reviewer ?? deps.sessionModel(),
        rolePrompt: taskFilesNow.prompts.reviewer,
        reviewsDir: join(getAgentDir(), "factory-reviews", deps.sessionId()),
        cancelled: () => runner.cancelled,
      }),
    merge: async (config) => {
      const round = session.snapshot?.round ?? 0;
      const mergeStatus = (text: string) => status(`round ${round}: merge, ${text}`);
      const intent = (data: MergeIntentData) => {
        if (!session.disposed) record(deps, "factory-merge-intent", data);
      };
      const message = session.snapshot?.commitMessage ?? commitMessageFallback(task.title);
      return mergeTask({ exec: runner.run, cleanup: runner.cleanup, root, round, task, config, intent, status: mergeStatus, message });
    },
    openRebase: () => rebaseInProgress(runner.run, root),
    // A follow-up on a merged task is a new commit of its own: the task title already named the first one.
    askCommitMessage: () => !isConventionalTitle(task.title) || session.snapshot?.mergedCommit != null,
  };
}

/**
 * `pipelineSteps`, the worktree checks and cleanup and the unsquashed rebase of a merge request. Its diff is HEAD's
 * tree, the one the fast-forward gives the target, not the working tree.
 */
function mergeRequestSteps(deps: OpsDeps, task: Task, taskFilesNow: TaskFiles): MergeRequestSteps {
  const { runner } = deps.session;
  const root = deps.cwd;
  return {
    ...pipelineSteps(deps, task, taskFilesNow, true),
    diff: async () => treeDiff(runner.run, root, await taskBase(runner.run, root, task), await git(runner.run, root, ["rev-parse", "HEAD^{tree}"]), taskFilesNow.config.lockfiles),
    dirty: () => uncommittedFiles(runner.run, root),
    trackedChanges: () => trackedChanges(runner.run, root),
    // Not stopped by a cancel: a cancelled gate's output must not reach the retry.
    removeUntracked: () => removeUntracked(runner.cleanup, root),
    rebase: () => rebaseWorktree(runner.run, runner.cleanup, deps.cwd, task, taskFilesNow.config.protected),
  };
}

/**
 * A merge request in `running`: its pipeline, then its merge when it passed into `merging`. Started without being
 * awaited, from `startTask` and `retryTask`.
 */
async function finishMergeRequest(deps: OpsDeps, current: Snapshot): Promise<void> {
  const { session } = deps;
  let drafts: Draft[];
  try {
    // A merge request has no coder whose resolution a rebase in progress could hold: it is a dead run's, or a person's
    // the retry discards (README). Before the dirty check, which its conflicted files would fail.
    await abortLeftoverRebase(session.runner.cleanup, deps.cwd);
    drafts = await runMergeRequest(current, mergeRequestSteps(deps, current.task, await taskFiles(deps, current.task)));
  } catch (error) {
    drafts = [session.runner.cancelled ? stateDraft("cancelled", current.round, "cancelled") : stateDraft("blocked", current.round, `pipeline_error: ${errorText(error)}`)];
  }
  // The task then stays `running` in the file and is set right on `session_start`.
  if (session.disposed) return;
  recordDrafts(deps, drafts);
  const next = session.snapshot;
  if (next?.state === "merging") return finishMerge(deps, next);
  deps.setStatus(STATUS_KEY, undefined);
  deps.setStatus(LIVENESS_KEY, undefined);
  session.runner.reset();
}

/**
 * The merge of a task in `merging`, with the entries it ends in. Started without being awaited, from `agent_settled`
 * after a passed `auto` round and from `approveTask`. A rebase that conflicts, or a merge gate that fails on the
 * rebased branch, sends its feedback, which starts the coder's round unless the run's rounds are used up.
 */
export async function finishMerge(deps: OpsDeps, current: Snapshot): Promise<void> {
  const { session } = deps;
  let drafts: Draft[];
  try {
    // The merge rebases onto the target's tip: a merge request's merge gates come from there, not from its run's start.
    if (isMergeRequest(current.task)) session.files = undefined;
    const mergeSteps = pipelineSteps(deps, current.task, await taskFiles(deps, current.task), true);
    drafts = await runMerge(current, mergeSteps.config(), mergeSteps);
  } catch (error) {
    drafts = [session.runner.cancelled ? stateDraft("cancelled", current.round, "cancelled") : stateDraft("blocked", current.round, `pipeline_error: ${errorText(error)}`)];
  }
  // The task then stays `merging` in the file and is reconciled on `session_start`.
  if (session.disposed) return;
  recordDrafts(deps, drafts);
  deps.setStatus(STATUS_KEY, undefined);
  deps.setStatus(LIVENESS_KEY, undefined);
  session.runner.reset();
  const feedback = drafts.find((draft): draft is FeedbackDraft => draft.type === "custom_message" && draft.customType === FEEDBACK_TYPE);
  if (feedback) {
    const { type: _type, ...message } = feedback;
    deps.sendMessage(message, { triggerTurn: session.snapshot?.state === "running" });
  }
}

/** The merge entries of a task found `merging` on resume whose merge landed after its intent was written, else undefined. */
async function landedMerge(deps: OpsDeps, current: Snapshot): Promise<Draft[] | undefined> {
  const intent = current.mergeIntent;
  if (!intent) return undefined;
  const exec = deps.session.runner.cleanup;
  const { primary } = await primaryCheckout(exec, deps.cwd);
  const target = `refs/heads/${current.task.mainBranch}`;
  if ((await exec(["git", "merge-base", "--is-ancestor", intent.commit, target], { cwd: primary })).exitCode !== 0) return undefined;
  const changed = nulList(await git(exec, primary, ["diff", "--no-renames", "--name-only", "-z", intent.before, intent.commit]));
  // The rules of the run the merge belonged to; the default list when they cannot be read any more.
  const lockfiles = (await taskFiles(deps, current.task).catch(() => undefined))?.config.lockfiles ?? LOCKFILES;
  const error = changed.some((path) => lockfiles.includes(basename(path))) ? "after_merge did not run: the session ended during the merge" : null;
  const merge: MergeData = { ok: true, commit: intent.commit, error, depsSynced: false };
  return [customDraft("factory-merge", merge), stateDraft("done", current.round, error ? "merged, after_merge failed" : "merged")];
}

/**
 * A task the session went down under: a merge that landed is recorded, anything else ends `blocked`/`interrupted`. A
 * rebase a dead merge (or a merge request's pipeline: no coder left it) leaves in progress is aborted.
 */
export async function resumeTask(deps: OpsDeps, current: Snapshot): Promise<void> {
  if (current.state === "merging") {
    const landed = await landedMerge(deps, current).catch(() => undefined);
    if (landed) return recordDrafts(deps, landed);
  }
  if (current.state === "merging" || isMergeRequest(current.task)) await abortLeftoverRebase(deps.session.runner.cleanup, deps.cwd).catch(() => undefined);
  endState(deps, current, "blocked", "interrupted");
}

async function guarded(body: () => Promise<OpResult>): Promise<OpResult> {
  try {
    return await body();
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

/** Records the task of a `{"request", "title", "settings", "kind"?}` payload and starts the coder, or a merge request's pipeline. */
export function startTask(deps: OpsDeps, json: string): Promise<OpResult> {
  const { session } = deps;
  if (session.snapshot || session.starting) return Promise.resolve({ ok: false, error: "this session already holds a task" });
  if (!deps.isIdle()) return Promise.resolve({ ok: false, error: "the session is busy" });
  session.starting = true;
  return guarded(async () => {
    try {
      session.runner.reset();
      const payload = parseStartPayload(json);
      const kind = payload.kind ?? "task";
      if (kind === "merge_request" && !deps.canRecordRequest()) return { ok: false, error: "this Pi cannot record a message without a turn, which a merge request needs" };
      const taskGitFacts = await taskGit(session.runner.run, deps.cwd, payload.settings.branch);
      // A merge request's HEAD is its source branch, whose rules are what it is reviewed for: they come from the target.
      const rulesCommit = kind === "merge_request" ? await targetTip(session.runner.run, deps.cwd, taskGitFacts.mainBranch) : taskGitFacts.baseSha;
      const loaded = await loadTaskFiles(session.runner.run, deps.cwd, rulesCommit);
      const coder = payload.settings.models.coder;
      if (kind === "task" && coder && !(await deps.setModel(coder))) return { ok: false, error: `model ${coder} is not available` };
      const source = kind === "merge_request" ? taskGitFacts.branch : null;
      const task: Task = { title: payload.title, request: payload.request, settings: payload.settings, ...taskGitFacts, protocol: PROTOCOL_VERSION, kind, source };
      session.files = Promise.resolve(loaded);
      record(deps, "factory-task", task);
      record(deps, "factory-round", { round: 1, trigger: "start" });
      record(deps, "factory-state", { state: "running", round: 1, reason: "start" });
      if (kind === "merge_request") {
        deps.recordRequest(task.request);
        const started = deps.session.snapshot;
        if (started) void finishMergeRequest(deps, started).catch(() => undefined);
        return { ok: true };
      }
      // Everything that can fail from here on runs after this prompt: entries reach the file only once a message exists.
      deps.sendUserMessage(task.request);
      return { ok: true };
    } finally {
      session.starting = false;
    }
  });
}

/** Merges a task that waits for approve. Answers at once: the merge runs in the background. */
export async function approveTask(deps: OpsDeps): Promise<OpResult> {
  const current = deps.session.snapshot;
  if (!current) return { ok: false, error: "this session holds no task" };
  if (current.state !== "waiting_approve") return { ok: false, error: "the task is not waiting for approve" };
  if (!deps.isIdle()) return { ok: false, error: "the session is busy" };
  return guarded(async () => {
    deps.session.runner.reset();
    record(deps, "factory-state", { state: "merging", round: current.round, reason: "approved" });
    void finishMerge(deps, deps.session.snapshot ?? current).catch(() => undefined);
    return { ok: true };
  });
}

/** Another coder turn on a blocked or cancelled task; a merge request's pipeline again, from its rebase. */
export async function retryTask(deps: OpsDeps): Promise<OpResult> {
  const current = deps.session.snapshot;
  if (!current) return { ok: false, error: "this session holds no task" };
  if (current.state !== "blocked" && current.state !== "cancelled") return { ok: false, error: "retry needs a blocked or cancelled task" };
  if (!deps.isIdle()) return { ok: false, error: "the session is busy" };
  if (isMergeRequest(current.task)) {
    return guarded(async () => {
      startRun(deps, current, "retry", {});
      void finishMergeRequest(deps, deps.session.snapshot ?? current).catch(() => undefined);
      return { ok: true };
    });
  }
  return guarded(async () => {
    const opening = await openRun(deps, current);
    if (opening.failed !== undefined) {
      endState(deps, current, "blocked", opening.failed);
      return { ok: false, error: opening.failed };
    }
    startRun(deps, current, "retry", opening);
    // A failed merge is in no message the coder sees.
    const failed = current.reason === "merge_failed" && current.mergeError;
    if (opening.conflict !== undefined) deps.sendMessage(conflictMessage(current.round, opening.conflict), { triggerTurn: true });
    else deps.sendUserMessage(failed ? mergeFailedPrompt(failed) : RETRY_PROMPT);
    return { ok: true };
  });
}

/** Kills the running command group. A merge or a round in flight ends itself `cancelled`, an idle task is cancelled here. */
export async function cancelTask(deps: OpsDeps): Promise<OpResult> {
  const current = deps.session.snapshot;
  if (!current) return { ok: false, error: "this session holds no task" };
  const { state } = current;
  if (state === "done" || state === "cancelled") return { ok: false, error: "the task is not active" };
  return guarded(async () => {
    const { runner } = deps.session;
    runner.cancel();
    // A merge request in `running` is its pipeline in this process (`session_start` set a dead one right): it ends itself.
    if (state === "merging" || (state === "running" && isMergeRequest(current.task))) return { ok: true };
    if (!deps.isIdle()) {
      deps.abort();
      return { ok: true };
    }
    endState(deps, current, "cancelled", "cancelled");
    runner.reset();
    return { ok: true };
  });
}

/** The draft `factory.yaml` into the repo's main checkout, uncommitted. Needs no task, never overwrites. */
export function initConfig(deps: OpsDeps): Promise<OpResult> {
  return guarded(async () => {
    const { primary } = await primaryCheckout(deps.session.runner.cleanup, deps.cwd);
    const path = join(primary, "factory.yaml");
    if (existsSync(path)) return { ok: false, error: `${path} exists already, init does not overwrite it` };
    const draft = initDraft(primary);
    writeFileSync(path, draft.text, { flag: "wx" });
    const found = draft.source ? `gates detected from ${draft.source}` : "nothing detected, fill the gates in";
    return { ok: true, message: `wrote ${path} (${found}). Review it, then commit it.` };
  });
}
