/**
 * Agent factory: the pipeline of a factory task, run inside the task's own coding session.
 *
 *   /factory init                                     write a draft factory.yaml into the main checkout (any session)
 *   /factory start {"request", "title", "settings"}   record the task and start the coder
 *   /factory approve                                  merge a task that waits for approve
 *   /factory retry                                    another coder turn on a blocked or cancelled task
 *   /factory cancel                                   kill the running command group, end `cancelled`
 *   /factory models [add|remove|set ...]              the user's factory model list (`models.ts`, any session)
 *
 * - After every coder turn (`agent_before_settle`) it runs `hooks.after_code`, `gates`, the protected-path check and
 *   the review. A problem goes back to the coder as a `factory-feedback` message and starts the next round, up to
 *   `settings.maxRounds`. A passed round waits for approve or merges, a round with an empty diff ends `done`/`no_changes`
 * - The merge of a passed round starts in `agent_settled`, the first place that knows whether the run was aborted: an
 *   abort is invisible inside `agent_before_settle`, so the steps already started there run to their end, but nothing
 *   is merged after it and the task ends `blocked`/`stopped`. The merge is not awaited there: Pi defers every prompt,
 *   `/factory cancel` included, until the `agent_settled` handlers return
 * - `factory.yaml` and the role prompts come from a commit of the target branch (the task's base, `taskBase`, at the
 *   run's start; a merge request's target tip), never from the tree the coder edits
 * - A task runs in a git worktree of its own, on its own branch, made off `settings.branch` by whoever starts it. It
 *   stays up to date with that branch and merges into it: a run that opens commits the worktree and rebases it onto
 *   the branch. A conflicting rebase is aborted and the run opens with a `conflict` round instead, so does a rebase
 *   the coder left open, which is never aborted. A rebase or commit that fails otherwise (a hook, a deleted branch, an
 *   untracked file in the way) opens no run and ends the task `blocked`, `rebase_failed: <git error>`: a later retry
 *   or message tries again
 * - Every step is a `custom` session entry (`state.ts`). The task is rebuilt from them on `session_start`, where a
 *   merge that landed while the session went down is recorded from its `factory-merge-intent`
 * - A plain message to a waiting, blocked, cancelled or done task starts new rounds; to a task in `waiting_answer` (the
 *   coder called `factory_ask_supervisor`) it is the answer, and the coder continues the same round
 * - Loaded into every coding session: without a `factory-task` entry no handler does anything
 * - Registers the `factory` tool (`tool.ts`), which starts and drives tasks like this one from any session
 * - A passed round of a task whose title is not a conventional commit title asks the coder for the commit message
 *   first (`commitmsg.ts`), in the same run
 * - A message to a merged task (`done`/`merged`) opens a follow-up run (`followup.ts`): its change merges as a new
 *   commit, with a commit message the coder is asked for; a part outside the task's scope goes to a new task through
 *   `factory_new_task` (registered in task sessions only, usable in a follow-up run, once per user message), on this
 *   task's target branch and merge mode
 * - A merge request (`/factory start` with `"kind": "merge_request"`) has no coder: start and retry run its pipeline in
 *   the background (`ops.ts`), a plain message to it is refused, and `factory_ask_supervisor` is not registered
 */
import type { ExtensionAPI, ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { followUpPrompt, registerAskSupervisorTool, registerNewTaskTool } from "./followup.ts";
import { snapshotTree } from "./git.ts";
import { modelsCommand } from "./models.ts";
import { commitAnswerDrafts, messageRoundDrafts, runRound, type RoundResult } from "./pipeline.ts";
import {
  approveTask,
  askSupervisor,
  cancelTask,
  conflictMessage,
  endState,
  finishMerge,
  initConfig,
  newTaskSession,
  openRun,
  pipelineSteps,
  resumeAnswered,
  resumeTask,
  retryTask,
  startRun,
  startTask,
  STATUS_KEY,
  taskFiles,
  type OpResult,
  type OpsDeps,
  type RunOpening,
} from "./ops.ts";
import { applyEntry, followUpMessages, isMergeRequest, messageText, rebuild, RESTING_STATES, stateDraft, wasInterrupted, type Draft, type Snapshot, type State } from "./state.ts";
import { registerFactoryTool } from "./tool.ts";
import { errorText } from "./util.ts";

/** Tag of the system prompt section that carries `.factory/agents/coder.md`. */
const ROLE_SECTION = "factory_role";
/** Tag of the system prompt section that tells the coder how a follow-up on a merged task is carried out. */
const FOLLOW_UP_SECTION = "factory_followup";

/** The text of the last assistant message of a session branch, empty when there is none. */
function lastAssistantText(entries: Iterable<{ type: string }>): string {
  let text = "";
  for (const entry of entries) {
    const { message } = entry as { message?: { role?: unknown; content?: unknown } };
    if (entry.type === "message" && message?.role === "assistant") text = messageText(message);
  }
  return text;
}

/**
 * The context types the session manager read-only, but Pi passes its session manager itself: the only way to a
 * message without a turn. A Pi that does not leaves `appendMessage` undefined.
 */
function writableSessionManager(ctx: ExtensionContext): Partial<Pick<SessionManager, "appendMessage">> {
  return ctx.sessionManager as Partial<Pick<SessionManager, "appendMessage">>;
}

function isMergedTask(snapshot: Snapshot): boolean {
  return snapshot.state === "done" && snapshot.reason.startsWith("merged");
}

export default function (pi: ExtensionAPI) {
  registerFactoryTool(pi);
  const session = newTaskSession();
  /** The state the last `agent_before_settle` pipeline ended in, until `agent_settled` has acted on it. */
  let roundEnd: State | undefined;
  /** What the `input` handler checked for the user message whose run `before_agent_start` opens next. */
  let opened: RunOpening | undefined;
  /** The commit message ask of a passed round awaiting the coder's answer: the state it passed into, the tree that passed. */
  let commitAsk: { passedInto: State; tree: string } | undefined;
  let taskTools = false;
  /** `factory_new_task` and `factory_ask_supervisor` exist in task sessions only: registered once the session holds a task. */
  const registerTaskTools = () => {
    if (taskTools || !session.snapshot) return;
    taskTools = true;
    registerNewTaskTool(pi, {
      refusal: () => {
        const current = session.snapshot;
        if (!current) return "this session holds no task";
        if (!session.followUp || current.state !== "running") return "only a follow-up run on a merged task may start a new task";
        if (session.followUp.spawnedForMessage) return "a task was started for this message already: one per message";
        return null;
      },
      overrides: () => {
        const task = session.snapshot?.task;
        return task ? { branch: task.mainBranch, merge: task.settings.merge } : {};
      },
      spawned: (spawn) => {
        if (session.followUp) session.followUp.spawnedForMessage = true;
        pi.appendEntry("factory-spawn", spawn);
        session.snapshot = applyEntry(session.snapshot, "factory-spawn", spawn);
      },
    });
    // A merge request has no coder that could ask.
    if (isMergeRequest(session.snapshot.task)) return;
    registerAskSupervisorTool(pi, {
      refusal: () => (session.snapshot?.state === "running" ? null : "only the coder of a running task may ask"),
      asked: (question, ctx) => {
        if (session.snapshot) askSupervisor(deps(ctx), session.snapshot, question);
      },
    });
  };

  const deps = (ctx: ExtensionContext): OpsDeps => ({
    session,
    cwd: ctx.cwd,
    appendEntry: (customType, data) => pi.appendEntry(customType, data),
    sendUserMessage: (text) => pi.sendUserMessage(text),
    recordRequest: (text) => {
      const manager = writableSessionManager(ctx);
      if (typeof manager.appendMessage !== "function") throw new Error("this Pi cannot record a message without a turn");
      manager.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
    },
    canRecordRequest: () => typeof writableSessionManager(ctx).appendMessage === "function",
    sendMessage: (message, options) => pi.sendMessage(message, options),
    setStatus: (key, text) => ctx.ui.setStatus(key, text),
    isIdle: () => ctx.isIdle(),
    abort: () => ctx.abort(),
    setModel: async (name) => {
      const slash = name.indexOf("/");
      const model = ctx.modelRegistry.find(name.slice(0, slash), name.slice(slash + 1));
      return model !== undefined && (await pi.setModel(model));
    },
    hasPendingMessages: () => ctx.hasPendingMessages(),
    followUps: () => followUpMessages(ctx.sessionManager.getBranch()),
    sessionModel: () => (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null),
    sessionId: () => ctx.sessionManager.getSessionId(),
  });

  const command = (args: string, ops: OpsDeps): Promise<OpResult> => {
    const text = args.trim();
    const verb = text.split(/\s+/, 1)[0];
    if (verb === "start") {
      return startTask(ops, text.slice(verb.length).trim()).then((result) => {
        registerTaskTools();
        return result;
      });
    }
    if (verb === "init") return initConfig(ops);
    if (!session.snapshot) return Promise.resolve({ ok: false, error: "this session holds no task" });
    if (verb === "approve") return approveTask(ops);
    if (verb === "retry") return retryTask(ops);
    if (verb === "cancel") return cancelTask(ops);
    return Promise.resolve({ ok: false, error: `unknown command "${verb}"` });
  };

  pi.registerCommand("factory", {
    description: "Agent factory: init (draft factory.yaml) | models [add|remove|set ...] | task: start <json> | approve | retry | cancel",
    handler: async (args, ctx) => {
      const [verb = ""] = args.trim().split(/\s+/, 1);
      if (verb === "models") {
        await modelsCommand(args.trim().slice(verb.length).trim(), ctx).catch((error) => ctx.ui.notify(`factory: ${errorText(error)}`, "error"));
        return;
      }
      const result = await command(args, deps(ctx)).catch((error): OpResult => ({ ok: false, error: errorText(error) }));
      if (!result.ok) ctx.ui.notify(`factory: ${result.error}`, "error");
      else if (result.message) ctx.ui.notify(`factory: ${result.message}`, "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    session.snapshot = rebuild(ctx.sessionManager.getBranch());
    session.files = undefined;
    registerTaskTools();
    if (session.snapshot && wasInterrupted(session.snapshot)) await resumeTask(deps(ctx), session.snapshot);
  });

  pi.on("session_tree", (_event, ctx) => {
    session.snapshot = rebuild(ctx.sessionManager.getBranch());
    session.files = undefined;
  });

  pi.on("session_shutdown", () => {
    session.disposed = true;
    session.runner.cancel();
  });

  pi.on("input", async (_event, ctx) => {
    const atRest = session.snapshot;
    if (!atRest) return;
    // One `factory_new_task` per user message, a follow-up queued during the run included.
    if (session.followUp) session.followUp.spawnedForMessage = false;
    if (isMergeRequest(atRest.task)) {
      ctx.ui.notify("factory: a merge request has no coder to message, retry or cancel it", "error");
      return { action: "handled" };
    }
    if (atRest.state === "merging") {
      ctx.ui.notify("factory: a merge is running, send the message when it has ended", "warning");
      return { action: "handled" };
    }
    // The answer to the coder's question continues its round: no rebase, so the worktree stays as the coder left it.
    if (atRest.state === "waiting_answer") {
      // A merged task runs again only in a follow-up run, whose session state a new runner has to restore.
      session.followUp = atRest.mergedCommit === null ? undefined : { merged: atRest.mergedCommit, spawnedForMessage: false };
      return;
    }
    if (!RESTING_STATES.includes(atRest.state)) return;
    const ops = deps(ctx);
    try {
      session.followUp = isMergedTask(atRest) ? { merged: atRest.mergedCommit, spawnedForMessage: false } : undefined;
      opened = await openRun(ops, atRest);
    } catch (error) {
      ctx.ui.notify(`factory: the message starts no run: ${errorText(error)}`, "error");
      return { action: "handled" };
    }
    if (opened.failed !== undefined) {
      const { failed } = opened;
      opened = undefined;
      endState(ops, atRest, "blocked", failed);
      ctx.ui.notify(`factory: the message starts no run: ${failed}`, "error");
      return { action: "handled" };
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const atRest = session.snapshot;
    if (!atRest) return;
    const opening = opened ?? {};
    opened = undefined;
    const ops = deps(ctx);
    const answers = event.messageType === "user" && atRest.state === "waiting_answer";
    const opens = event.messageType === "user" && !answers && RESTING_STATES.includes(atRest.state);
    if (answers) resumeAnswered(ops, atRest);
    if (opens) startRun(ops, atRest, "message", opening);
    // A `factory.yaml` that does not parse is reported by the round, not here.
    const taskFilesNow = await taskFiles(ops, atRest.task).catch(() => undefined);
    if (taskFilesNow?.prompts.coder) event.systemPromptOptions.sections[ROLE_SECTION] = taskFilesNow.prompts.coder;
    if (session.followUp) event.systemPromptOptions.sections[FOLLOW_UP_SECTION] = followUpPrompt(session.followUp.merged);
    // The user's message and the conflict both reach the coder in this run.
    if (opens && opening.conflict !== undefined) return { message: conflictMessage(atRest.round, opening.conflict) };
  });

  pi.on("agent_start", (_event, ctx) => {
    if (session.snapshot?.state === "running") ctx.ui.setStatus(STATUS_KEY, `round ${session.snapshot.round}: coder`);
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    const current = session.snapshot;
    if (!current || current.state !== "running") return;
    // An aborted run is classified in `agent_settled`, which is also reached when this boundary is skipped.
    if (event.outcome === "aborted") return;
    const { round, task } = current;
    const stopped = (reason: string): RoundResult => {
      const entries: Draft[] = [stateDraft("blocked", round, reason)];
      // A message queued meanwhile runs right after this boundary: it gets its round.
      return ctx.hasPendingMessages() ? { entries: [...entries, ...messageRoundDrafts(round)], continue: true } : { entries, continue: false };
    };
    let result: RoundResult;
    const asked = commitAsk;
    commitAsk = undefined;
    if (event.outcome === "error") {
      result = stopped("agent_error");
    } else {
      try {
        const ops = deps(ctx);
        const { runner } = session;
        // The answer to the commit message ask, unless the coder changed files with it: then the round runs again.
        if (asked && (await snapshotTree(runner.run, ctx.cwd)) === asked.tree) {
          result = commitAnswerDrafts(current, lastAssistantText(ctx.sessionManager.getBranch()), asked.passedInto, ctx.hasPendingMessages());
        } else {
          result = await runRound(current, pipelineSteps(ops, task, await taskFiles(ops, task), false));
          if (result.commitAsk) commitAsk = { passedInto: result.commitAsk, tree: await snapshotTree(runner.run, ctx.cwd) };
        }
      } catch (error) {
        result = stopped(`pipeline_error: ${errorText(error)}`);
      }
    }
    // Pi commits the returned entries: the snapshot follows them without `appendEntry`.
    for (const draft of result.entries) if (draft.type === "custom") session.snapshot = applyEntry(session.snapshot, draft.customType, draft.data);
    roundEnd = session.snapshot?.state;
    const entries = [...event.entries, ...result.entries];
    return result.continue ? { entries, continue: true } : { entries };
  });

  pi.on("agent_settled", async (event, ctx) => {
    const current = session.snapshot;
    if (!current) return;
    const ops = deps(ctx);
    const ended = roundEnd === current.state ? roundEnd : undefined;
    roundEnd = undefined;
    // `running`: no step ended the run. `merging`: the round passed and its merge is due. An aborted run keeps neither,
    // and no approve either: the abort may have come while the round's steps ran, which they cannot see.
    const open = current.state === "running" || ended === "merging" || (ended === "waiting_approve" && event.aborted);
    if (open && session.runner.cancelled) endState(ops, current, "cancelled", "cancelled");
    else if (open && event.aborted) endState(ops, current, "blocked", "stopped");
    else if (ended === "merging") {
      // Not awaited: Pi holds back every prompt until this handler returns, `/factory cancel` too.
      void finishMerge(ops, current).catch(() => undefined);
      return;
    } else if (current.state === "running") endState(ops, current, "blocked", "interrupted");
    ctx.ui.setStatus(STATUS_KEY, undefined);
    session.runner.reset();
  });
}
