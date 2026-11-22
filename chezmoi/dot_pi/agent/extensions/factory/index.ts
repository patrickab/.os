/**
 * Agent factory: the pipeline of a factory task, run inside the task's own coding session.
 *
 *   /factory init                                     write a draft factory.yaml into the main checkout (any session)
 *   /factory start {"request", "title", "settings"}   record the task and start the coder
 *   /factory approve                                  merge a task that waits for approve
 *   /factory retry                                    another coder turn on a blocked or cancelled task
 *   /factory cancel                                   kill the running command group, end `cancelled`
 *
 * - After every coder turn (`agent_before_settle`) it runs `hooks.after_code`, `gates`, the protected-path check and
 *   the review. A problem goes back to the coder as a `factory-feedback` message and starts the next round, up to
 *   `settings.maxRounds`. A passed round waits for approve or merges, a round with an empty diff ends `done`/`no_changes`
 * - The merge of a passed round starts in `agent_settled`, the first place that knows whether the run was aborted: an
 *   abort is invisible inside `agent_before_settle`, so the steps already started there run to their end, but nothing
 *   is merged after it and the task ends `blocked`/`stopped`. The merge is not awaited there: Pi defers every prompt,
 *   `/factory cancel` included, until the `agent_settled` handlers return
 * - `factory.yaml` and the role prompts come from a commit of the target branch (the task's base, `taskBase`, at the
 *   run's start), never from the tree the coder edits
 * - A task runs in a git worktree of its own, on its own branch, made off `settings.branch` by whoever starts it. It
 *   stays up to date with that branch and merges into it: a run that opens commits the worktree and rebases it onto
 *   the branch. A conflicting rebase is aborted and the run opens with a `conflict` round instead, so does a rebase
 *   the coder left open, which is never aborted. A rebase or commit that fails otherwise (a hook, a deleted branch, an
 *   untracked file in the way) opens no run and ends the task `blocked`, `rebase_failed: <git error>`: a later retry
 *   or message tries again
 * - Every step is a `custom` session entry (`state.ts`). The task is rebuilt from them on `session_start`, where a
 *   merge that landed while the session went down is recorded from its `factory-merge-intent`
 * - A plain message to a waiting, blocked, cancelled or done task starts new rounds
 * - Loaded into every coding session: without a `factory-task` entry no handler does anything
 */
import { existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadTaskFiles, type TaskFiles } from "./config.ts";
import { abortLeftoverRebase, git, LOCKFILES, nulList, primaryCheckout, rebaseInProgress, taskBase, taskDiff, taskGit } from "./git.ts";
import { initDraft } from "./draft.ts";
import { mergeTask, rebaseWorktree } from "./merge.ts";
import { messageRoundDrafts, runMerge, runRound, type PipelineSteps, type RoundResult } from "./pipeline.ts";
import { runReview } from "./review.ts";
import { CommandRunner } from "./run.ts";
import {
  applyEntry,
  conflictFeedback,
  customDraft,
  FEEDBACK_TYPE,
  followUpMessages,
  mergeFailedPrompt,
  parseStartPayload,
  rebuild,
  RETRY_PROMPT,
  stateDraft,
  wasInterrupted,
  type Draft,
  type FeedbackDraft,
  type MergeData,
  type Snapshot,
  type State,
  type StateData,
  type Task,
  type Trigger,
} from "./state.ts";

/** Shows what the pipeline does: set while a round, a review or a merge runs. */
const STATUS_KEY = "factory";
/** pi-host keeps a session with this status from idle eviction. A merge sets it: `/factory approve` starts no agent run. */
const LIVENESS_KEY = "session-liveness";
/** Tag of the system prompt section that carries `.factory/agents/coder.md`. */
const ROLE_SECTION = "factory_role";
/** States a user message opens a new run from. */
const RESTING_STATES: readonly State[] = ["waiting_approve", "blocked", "done", "cancelled"];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a run opens with: `conflict`, the feedback of a rebase that conflicts (the run opens with a `conflict` round), or `failed`, why none opens. */
type RunOpening = { conflict?: string; failed?: string };

/** The feedback message of a `conflict` round that opens a run, as `pi.sendMessage` and `before_agent_start` take it. */
function conflictMessage(round: number, content: string): Omit<FeedbackDraft, "type"> {
  return { customType: FEEDBACK_TYPE, content, display: true, details: { round, trigger: "conflict" } };
}

export default function (pi: ExtensionAPI) {
  let snapshot: Snapshot | undefined;
  /** `factory.yaml` and the role prompts the current run is held to, read once per run. */
  let files: Promise<TaskFiles> | undefined;
  let starting = false;
  /** Set on `session_shutdown`: `pi` is stale from then on and a merge still in flight must not write through it. */
  let disposed = false;
  /** The state the last `agent_before_settle` pipeline ended in, until `agent_settled` has acted on it. */
  let roundEnd: State | undefined;
  /** What the `input` handler checked for the user message whose run `before_agent_start` opens next. */
  let opened: RunOpening | undefined;
  const runner = new CommandRunner();

  const record = (customType: string, data: unknown) => {
    pi.appendEntry(customType, data);
    snapshot = applyEntry(snapshot, customType, data);
  };
  const endState = (current: Snapshot, state: State, reason: string) => record("factory-state", { state, round: current.round, reason } satisfies StateData);
  const recordDrafts = (drafts: Draft[]) => {
    for (const draft of drafts) if (draft.type === "custom") record(draft.customType, draft.data);
  };
  const startRun = (current: Snapshot, trigger: Trigger, { conflict }: RunOpening) => {
    runner.reset();
    files = undefined;
    const opens = conflict === undefined ? trigger : "conflict";
    record("factory-round", { round: current.round + 1, trigger: opens });
    record("factory-state", { state: "running", round: current.round + 1, reason: opens } satisfies StateData);
  };
  const taskFiles = (ctx: ExtensionContext, task: Task) =>
    (files ??= (async () => loadTaskFiles(runner.cleanup, ctx.cwd, await taskBase(runner.cleanup, ctx.cwd, task)))());

  /**
   * The checks before a run opens on a task at rest: a rebase in progress (the coder's) is left as it is and gets a
   * `conflict` round, else the worktree is committed and rebased onto the target branch, a conflicting rebase aborted
   * into a `conflict` round, any other failure of it returned as `failed`.
   */
  const openRun = async (current: Snapshot, ctx: ExtensionContext): Promise<RunOpening> => {
    const { task } = current;
    const open = await rebaseInProgress(runner.cleanup, ctx.cwd);
    if (open) return { conflict: conflictFeedback(current.round, task.mainBranch, open, true) };
    const protectedGlobs = (await taskFiles(ctx, task).catch(() => undefined))?.config.protected ?? [];
    try {
      const conflicts = await rebaseWorktree(runner.cleanup, runner.cleanup, ctx.cwd, task, protectedGlobs);
      return conflicts ? { conflict: conflictFeedback(current.round, task.mainBranch, conflicts, false) } : {};
    } catch (error) {
      return { failed: `rebase_failed: ${errorText(error)}` };
    }
  };

  const steps = (ctx: ExtensionContext, task: Task, taskFilesNow: TaskFiles, liveness: boolean): PipelineSteps => {
    const root = ctx.cwd;
    const status = (text: string) => {
      ctx.ui.setStatus(STATUS_KEY, text);
      if (liveness) ctx.ui.setStatus(LIVENESS_KEY, text);
    };
    return {
      status,
      cancelled: () => runner.cancelled,
      pendingMessages: () => ctx.hasPendingMessages(),
      config: () => taskFilesNow.config,
      runCommand: (argv) => runner.run(argv, { cwd: root }),
      diff: async () => taskDiff(runner.run, root, await taskBase(runner.run, root, task)),
      review: (round, diff) =>
        runReview({
          exec: runner.run,
          root,
          round,
          task,
          followUps: followUpMessages(ctx.sessionManager.getBranch()),
          diff,
          model: task.settings.models.reviewer ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null),
          rolePrompt: taskFilesNow.prompts.reviewer,
          reviewsDir: join(getAgentDir(), "factory-reviews", ctx.sessionManager.getSessionId()),
          cancelled: () => runner.cancelled,
        }),
      merge: async (config) => {
        const round = snapshot?.round ?? 0;
        const mergeStatus = (text: string) => status(`round ${round}: merge, ${text}`);
        const intent = (data: unknown) => {
          if (!disposed) record("factory-merge-intent", data);
        };
        return mergeTask({ exec: runner.run, cleanup: runner.cleanup, root, round, task, config, intent, status: mergeStatus });
      },
      openRebase: () => rebaseInProgress(runner.run, root),
    };
  };

  const start = async (json: string, ctx: ExtensionCommandContext) => {
    if (snapshot || starting) throw new Error("this session already holds a task");
    if (!ctx.isIdle()) throw new Error("the session is busy");
    starting = true;
    try {
      runner.reset();
      const payload = parseStartPayload(json);
      const taskGitFacts = await taskGit(runner.run, ctx.cwd, payload.settings.branch);
      const loaded = await loadTaskFiles(runner.run, ctx.cwd, taskGitFacts.baseSha);
      const coder = payload.settings.models.coder;
      if (coder) {
        const slash = coder.indexOf("/");
        const model = ctx.modelRegistry.find(coder.slice(0, slash), coder.slice(slash + 1));
        if (!model || !(await pi.setModel(model))) throw new Error(`model ${coder} is not available`);
      }
      const task: Task = { title: payload.title, request: payload.request, settings: payload.settings, ...taskGitFacts };
      files = Promise.resolve(loaded);
      record("factory-task", task);
      record("factory-round", { round: 1, trigger: "start" });
      record("factory-state", { state: "running", round: 1, reason: "start" });
      // Everything that can fail from here on runs after this prompt: entries reach the file only once a message exists.
      pi.sendUserMessage(task.request);
    } finally {
      starting = false;
    }
  };

  /**
   * The merge of a task in `merging`, with the entries it ends in. Started without being awaited, from `agent_settled`
   * after a passed `auto` round and from `/factory approve`. A rebase that conflicts, or a merge gate that fails on the
   * rebased branch, sends its feedback, which starts the coder's round unless the run's rounds are used up.
   */
  const finishMerge = async (current: Snapshot, ctx: ExtensionContext) => {
    let drafts: Draft[];
    try {
      const mergeSteps = steps(ctx, current.task, await taskFiles(ctx, current.task), true);
      drafts = await runMerge(current, mergeSteps.config(), mergeSteps);
    } catch (error) {
      drafts = [runner.cancelled ? stateDraft("cancelled", current.round, "cancelled") : stateDraft("blocked", current.round, `pipeline_error: ${errorText(error)}`)];
    }
    // The task then stays `merging` in the file and is reconciled on `session_start`.
    if (disposed) return;
    recordDrafts(drafts);
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setStatus(LIVENESS_KEY, undefined);
    runner.reset();
    const feedback = drafts.find((draft): draft is FeedbackDraft => draft.type === "custom_message");
    if (feedback) {
      const { type: _type, ...message } = feedback;
      pi.sendMessage(message, { triggerTurn: snapshot?.state === "running" });
    }
  };

  /** The merge entries of a task found `merging` on resume whose merge landed after its intent was written, else undefined. */
  const landedMerge = async (current: Snapshot, ctx: ExtensionContext): Promise<Draft[] | undefined> => {
    const intent = current.mergeIntent;
    if (!intent) return undefined;
    const exec = runner.cleanup;
    const { primary } = await primaryCheckout(exec, ctx.cwd);
    const target = `refs/heads/${current.task.mainBranch}`;
    if ((await exec(["git", "merge-base", "--is-ancestor", intent.commit, target], { cwd: primary })).exitCode !== 0) return undefined;
    const changed = nulList(await git(exec, primary, ["diff", "--no-renames", "--name-only", "-z", intent.before, intent.commit]));
    const error = changed.some((path) => LOCKFILES.includes(basename(path))) ? "after_merge did not run: the session ended during the merge" : null;
    const merge: MergeData = { ok: true, commit: intent.commit, error, depsSynced: false };
    return [customDraft("factory-merge", merge), stateDraft("done", current.round, error ? "merged, after_merge failed" : "merged")];
  };

  const resume = async (current: Snapshot, ctx: ExtensionContext) => {
    if (current.state === "merging") {
      const landed = await landedMerge(current, ctx).catch(() => undefined);
      if (landed) return recordDrafts(landed);
      await abortLeftoverRebase(runner.cleanup, ctx.cwd).catch(() => undefined);
    }
    endState(current, "blocked", "interrupted");
  };

  /** `/factory init`: the draft `factory.yaml` into the repo's main checkout, uncommitted. Needs no task. */
  const init = async (ctx: ExtensionCommandContext) => {
    const { primary } = await primaryCheckout(runner.cleanup, ctx.cwd);
    const path = join(primary, "factory.yaml");
    if (existsSync(path)) throw new Error(`${path} exists already, init does not overwrite it`);
    const draft = initDraft(primary);
    writeFileSync(path, draft.text, { flag: "wx" });
    const found = draft.source ? `gates detected from ${draft.source}` : "nothing detected, fill the gates in";
    ctx.ui.notify(`factory: wrote ${path} (${found}). Review it, then commit it.`, "info");
  };

  const command = async (args: string, ctx: ExtensionCommandContext) => {
    const text = args.trim();
    const verb = text.split(/\s+/, 1)[0];
    if (verb === "start") return start(text.slice(verb.length).trim(), ctx);
    if (verb === "init") return init(ctx);
    const current = snapshot;
    if (!current) throw new Error("this session holds no task");
    const { state } = current;
    if (verb === "approve") {
      if (state !== "waiting_approve") throw new Error("the task is not waiting for approve");
      if (!ctx.isIdle()) throw new Error("the session is busy");
      runner.reset();
      record("factory-state", { state: "merging", round: current.round, reason: "approved" } satisfies StateData);
      void finishMerge(snapshot ?? current, ctx).catch(() => undefined);
    } else if (verb === "retry") {
      if (state !== "blocked" && state !== "cancelled") throw new Error("retry needs a blocked or cancelled task");
      if (!ctx.isIdle()) throw new Error("the session is busy");
      const opening = await openRun(current, ctx);
      if (opening.failed !== undefined) {
        endState(current, "blocked", opening.failed);
        throw new Error(opening.failed);
      }
      startRun(current, "retry", opening);
      // A failed merge is in no message the coder sees.
      const failed = current.reason === "merge_failed" && current.mergeError;
      if (opening.conflict !== undefined) pi.sendMessage(conflictMessage(current.round, opening.conflict), { triggerTurn: true });
      else pi.sendUserMessage(failed ? mergeFailedPrompt(failed) : RETRY_PROMPT);
    } else if (verb === "cancel") {
      if (state === "done" || state === "cancelled") throw new Error("the task is not active");
      runner.cancel();
      // A merge or a round in flight ends itself and writes `cancelled`. An idle task is cancelled here.
      if (state === "merging") return;
      if (!ctx.isIdle()) return ctx.abort();
      endState(current, "cancelled", "cancelled");
      runner.reset();
    } else {
      throw new Error(`unknown command "${verb}"`);
    }
  };

  pi.registerCommand("factory", {
    description: "Agent factory: init (draft factory.yaml) | task: start <json> | approve | retry | cancel",
    handler: async (args, ctx) => {
      try {
        await command(args, ctx);
      } catch (error) {
        ctx.ui.notify(`factory: ${errorText(error)}`, "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    snapshot = rebuild(ctx.sessionManager.getBranch());
    files = undefined;
    if (snapshot && wasInterrupted(snapshot)) await resume(snapshot, ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    snapshot = rebuild(ctx.sessionManager.getBranch());
    files = undefined;
  });

  pi.on("session_shutdown", () => {
    disposed = true;
    runner.cancel();
  });

  pi.on("input", async (_event, ctx) => {
    if (!snapshot) return;
    if (snapshot.state === "merging") {
      ctx.ui.notify("factory: a merge is running, send the message when it has ended", "warning");
      return { action: "handled" };
    }
    if (!RESTING_STATES.includes(snapshot.state)) return;
    const atRest = snapshot;
    try {
      opened = await openRun(atRest, ctx);
    } catch (error) {
      ctx.ui.notify(`factory: the message starts no run: ${errorText(error)}`, "error");
      return { action: "handled" };
    }
    if (opened.failed !== undefined) {
      const { failed } = opened;
      opened = undefined;
      endState(atRest, "blocked", failed);
      ctx.ui.notify(`factory: the message starts no run: ${failed}`, "error");
      return { action: "handled" };
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!snapshot) return;
    const opening = opened ?? {};
    opened = undefined;
    const atRest = snapshot;
    const opens = event.messageType === "user" && RESTING_STATES.includes(atRest.state);
    if (opens) startRun(atRest, "message", opening);
    // A `factory.yaml` that does not parse is reported by the round, not here.
    const taskFilesNow = await taskFiles(ctx, snapshot.task).catch(() => undefined);
    if (taskFilesNow?.prompts.coder) event.systemPromptOptions.sections[ROLE_SECTION] = taskFilesNow.prompts.coder;
    // The user's message and the conflict both reach the coder in this run.
    if (opens && opening.conflict !== undefined) return { message: conflictMessage(atRest.round, opening.conflict) };
  });

  pi.on("agent_start", (_event, ctx) => {
    if (snapshot?.state === "running") ctx.ui.setStatus(STATUS_KEY, `round ${snapshot.round}: coder`);
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    if (!snapshot || snapshot.state !== "running") return;
    // An aborted run is classified in `agent_settled`, which is also reached when this boundary is skipped.
    if (event.outcome === "aborted") return;
    const current = snapshot;
    const { round, task } = current;
    const stopped = (reason: string): RoundResult => {
      const entries: Draft[] = [stateDraft("blocked", round, reason)];
      // A message queued meanwhile runs right after this boundary: it gets its round.
      return ctx.hasPendingMessages() ? { entries: [...entries, ...messageRoundDrafts(round)], continue: true } : { entries, continue: false };
    };
    let result: RoundResult;
    if (event.outcome === "error") {
      result = stopped("agent_error");
    } else {
      try {
        result = await runRound(current, steps(ctx, task, await taskFiles(ctx, task), false));
      } catch (error) {
        result = stopped(`pipeline_error: ${errorText(error)}`);
      }
    }
    for (const draft of result.entries) if (draft.type === "custom") snapshot = applyEntry(snapshot, draft.customType, draft.data);
    roundEnd = snapshot?.state;
    const entries = [...event.entries, ...result.entries];
    return result.continue ? { entries, continue: true } : { entries };
  });

  pi.on("agent_settled", async (event, ctx) => {
    if (!snapshot) return;
    const current = snapshot;
    const ended = roundEnd === current.state ? roundEnd : undefined;
    roundEnd = undefined;
    // `running`: no step ended the run. `merging`: the round passed and its merge is due. An aborted run keeps neither,
    // and no approve either: the abort may have come while the round's steps ran, which they cannot see.
    const open = current.state === "running" || ended === "merging" || (ended === "waiting_approve" && event.aborted);
    if (open && runner.cancelled) endState(current, "cancelled", "cancelled");
    else if (open && event.aborted) endState(current, "blocked", "stopped");
    else if (ended === "merging") {
      // Not awaited: Pi holds back every prompt until this handler returns, `/factory cancel` too.
      void finishMerge(current, ctx).catch(() => undefined);
      return;
    } else if (current.state === "running") endState(current, "blocked", "interrupted");
    ctx.ui.setStatus(STATUS_KEY, undefined);
    runner.reset();
  });
}
