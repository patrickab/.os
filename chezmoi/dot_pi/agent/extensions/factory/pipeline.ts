/**
 * The pipeline of one round, as control flow over injected steps. No Pi, no git, no spawn of its own.
 *
 * - Consumes the task `Snapshot` and `PipelineSteps` (the side effects: commands, diff, review, merge)
 * - Provides `runRound`: the entries of the round in order, and whether the coder gets another turn. A passed `auto`
 *   round ends in `merging` and does not merge: the caller merges once it knows the run was not aborted
 * - Provides `runMerge`: the entries of a merge, used after a passed `auto` round and by `/factory approve`. The task
 *   is rebased onto its target branch first. A rebase that conflicts gets a `conflict` round, a merge gate that
 *   fails on the rebased branch a `gates` round: the coder resolves it and the task merges once that round passes
 * - A rebase the coder left open in the worktree goes back to the coder as a `conflict` round before anything runs
 * - A passed round whose task title is not a conventional commit title first asks the coder for the commit message
 *   (`askCommitMessage`, a `factory-commit-ask` message in the same run); `commitAnswerDrafts` turns the answer into
 *   the `factory-commit-message` entry and the state the round passed into
 * - Provides `runMergeRequest`: the pipeline of a merge request, which has no coder. Its branch is rebased onto the
 *   target (`MergeRequestSteps.rebase`, unsquashed), the gates run, the reviewer reviews the whole diff whatever
 *   `settings.review` says, then it passes into `merging` or the wait for approve. Nothing opens a round: uncommitted
 *   files in its worktree (tracked or untracked before the rebase, tracked left by a gate), a rejected review, a
 *   conflict or a failed gate end it `blocked` (`dirty`, `review_rejected`, `conflict`, `gates`), and so does a
 *   conflict, a failed merge gate or a merge gate that left tracked files changed in its `runMerge`. What the gates
 *   leave untracked is removed after them (`MergeRequestSteps.removeUntracked`)
 * - A hook or gate that exits `INFRA_EXIT` (75, EX_TEMPFAIL) says the environment is broken, not the change: the task
 *   ends `blocked`, `infra: <last output line>`, without feedback to the coder. A retry starts the next round once it is fixed
 */
import { COMMIT_MESSAGE_PROMPT, commitMessageFallback, parseCommitMessage } from "./commitmsg.ts";
import { protectedPaths, type FactoryConfig } from "./config.ts";
import type { TaskDiff } from "./git.ts";
import type { MergeOutcome } from "./merge.ts";
import type { CommandResult } from "./run.ts";
import {
  commandFeedback,
  conflictFeedback,
  customDraft,
  feedbackDraft,
  gateData,
  passed,
  protectedFeedback,
  reviewFeedback,
  roundsUsed,
  stateDraft,
  COMMIT_ASK_TYPE,
  type CommitAskDraft,
  isMergeRequest,
  type Draft,
  type ReviewData,
  type Snapshot,
  type State,
  type Trigger,
} from "./state.ts";
import { errorText } from "./util.ts";

export interface PipelineSteps {
  status(text: string): void;
  cancelled(): boolean;
  /** True when a user message is queued: it starts a coder turn as soon as the round's pipeline returns. */
  pendingMessages(): boolean;
  config(): FactoryConfig;
  /** Runs a hook or gate in the task's checkout. */
  runCommand(argv: string[]): Promise<CommandResult>;
  diff(): Promise<TaskDiff>;
  review(round: number, diff: TaskDiff): Promise<ReviewData>;
  merge(config: FactoryConfig): Promise<MergeOutcome>;
  /** The conflicting files of a rebase in progress in the task's worktree, null when none is. */
  openRebase(): Promise<string[] | null>;
  /** True when a passed round asks the coder for the commit message before it ends. Absent: never. */
  askCommitMessage?(): boolean;
}

export interface MergeRequestSteps extends PipelineSteps {
  /** True when the worktree holds anything but HEAD's tree: changed tracked files or untracked files not ignored. */
  dirty(): Promise<boolean>;
  /** True when tracked files in the worktree differ from HEAD. */
  trackedChanges(): Promise<boolean>;
  /** Deletes the worktree's untracked files that are not ignored. */
  removeUntracked(): Promise<void>;
  /** Rebases the branch onto the target without squashing it: the conflicting files, null when it went clean. */
  rebase(): Promise<string[] | null>;
}

export interface RoundResult {
  entries: Draft[];
  /** True when the entries end with feedback and the coder runs the next round. */
  continue: boolean;
  /** Set when the entries end with the commit message ask: the state the round passed into, once answered. */
  commitAsk?: State;
}

export function commitAskDraft(round: number): CommitAskDraft {
  return { type: "custom_message", customType: COMMIT_ASK_TYPE, content: COMMIT_MESSAGE_PROMPT, display: true, details: { round } };
}

/**
 * The entries after the coder answered the commit message ask of a round that passed into `passedInto`: the message
 * (the task title when the answer is not a valid one) and that state, or a message round when a user message is queued.
 */
export function commitAnswerDrafts(snapshot: Snapshot, answer: string, passedInto: State, pendingMessages: boolean): RoundResult {
  const message = parseCommitMessage(answer) ?? commitMessageFallback(snapshot.task.title);
  const entries: Draft[] = [customDraft("factory-commit-message", message), stateDraft(passedInto, snapshot.round, "passed")];
  return pendingMessages ? { entries: [...entries, ...messageRoundDrafts(snapshot.round)], continue: true } : { entries, continue: false };
}

/** Exit code of a hook or gate whose environment is broken (missing packages, tools, services): not the coder's to fix. */
export const INFRA_EXIT = 75;

function lastLine(output: string): string {
  const lines = output.trim().split("\n");
  return (lines[lines.length - 1] ?? "").slice(0, 200);
}

/**
 * The round a queued message gets after round `round` ended. That message starts a coder turn right after the
 * boundary, with no `before_agent_start`.
 */
export function messageRoundDrafts(round: number): Draft[] {
  return [customDraft("factory-round", { round: round + 1, trigger: "message" }), stateDraft("running", round + 1, "message")];
}

/**
 * A problem found in the snapshot's round: the next coder round and the feedback, or only the feedback when the run
 * used up its `maxRounds` (the caller ends it `blocked`, `max_rounds: <trigger>`).
 */
function nextRound(snapshot: Snapshot, trigger: Trigger, text: string): RoundResult {
  const feedback = feedbackDraft(snapshot.round, trigger, text);
  if (roundsUsed(snapshot) >= snapshot.task.settings.maxRounds) return { entries: [feedback], continue: false };
  return { entries: [customDraft("factory-round", { round: snapshot.round + 1, trigger }), feedback], continue: true };
}

/** The entries after `merging`: the merge gates, the merge and the state it ends in. */
export async function runMerge(snapshot: Snapshot, config: FactoryConfig, steps: PipelineSteps): Promise<Draft[]> {
  const { round } = snapshot;
  steps.status(`round ${round}: merge`);
  const { gates, result } = await steps.merge(config);
  const drafts: Draft[] = gates.map((gate) => customDraft("factory-gate", gate));
  // Nothing was merged: the coder resolves the conflict or the failed gate in a round of its own, unless cancelled.
  const problem = (trigger: Trigger, text: string): Draft[] => {
    // No coder could resolve it: the findings stay in the gate entries, the task waits for a retry.
    if (isMergeRequest(snapshot.task)) return [...drafts, stateDraft("blocked", round, trigger)];
    const next = nextRound(snapshot, trigger, text);
    const state = next.continue ? stateDraft("running", round + 1, trigger) : stateDraft("blocked", round, `max_rounds: ${trigger}`);
    return [...drafts, ...next.entries, state];
  };
  switch (result.kind) {
    case "conflict":
      if (steps.cancelled()) return [...drafts, stateDraft("cancelled", round, "cancelled")];
      return problem("conflict", conflictFeedback(round, snapshot.task.mainBranch, result.files, false));
    case "gate_failed": {
      const { argv, result: gate } = result.gate;
      if (steps.cancelled()) return [...drafts, stateDraft("cancelled", round, "cancelled")];
      if (gate.exitCode === INFRA_EXIT && !gate.killed) return [...drafts, stateDraft("blocked", round, `infra: ${lastLine(gate.output)}`)];
      return problem("gates", `After the rebase onto ${snapshot.task.mainBranch}: ${commandFeedback(round, argv, gate)}`);
    }
    case "dirty":
      return [...drafts, stateDraft("blocked", round, "dirty")];
    case "merged": {
      const { merge } = result;
      // A failed `after_merge` hook cannot undo the merge: the task is done, and says what is left to do.
      return [...drafts, customDraft("factory-merge", merge), stateDraft("done", round, merge.error ? "merged, after_merge failed" : "merged")];
    }
    case "failed":
      drafts.push(customDraft("factory-merge", result.merge));
      drafts.push(steps.cancelled() ? stateDraft("cancelled", round, "cancelled") : stateDraft("blocked", round, "merge_failed"));
      return drafts;
  }
}

/** A merge request's pipeline, from the rebase onto its target to `merging`, the wait for approve or `blocked`. */
export async function runMergeRequest(snapshot: Snapshot, steps: MergeRequestSteps): Promise<Draft[]> {
  const { round, task } = snapshot;
  const drafts: Draft[] = [];
  const end = (state: State, reason: string): Draft[] => [...drafts, stateDraft(state, round, reason)];
  try {
    const config = steps.config();
    // The gates and the review see the committed tree only. The factory made the worktree pristine, so anything else in
    // it is somebody's work: it blocks the run and is left as it is.
    if (await steps.dirty()) return end("blocked", "dirty");
    steps.status(`round ${round}: rebase onto ${task.mainBranch}`);
    const conflicts = await steps.rebase();
    if (steps.cancelled()) return end("cancelled", "cancelled");
    if (conflicts) return end("blocked", "conflict");
    // The rebase brings the target's .gitignore: a file it stopped ignoring was there before the run and is no gate output.
    if (await steps.dirty()) return end("blocked", "dirty");
    try {
      for (const argv of config.gates) {
        steps.status(`round ${round}: gates ${argv.join(" ")}`);
        const result = await steps.runCommand(argv);
        drafts.push(customDraft("factory-gate", gateData(round, "gates", argv, result)));
        if (steps.cancelled()) return end("cancelled", "cancelled");
        if (!passed(result)) return end("blocked", "gates");
      }
    } finally {
      // The worktree was clean before the gates: what lies untracked now is their output, which neither the review,
      // the next gate nor a retry may see.
      await steps.removeUntracked();
    }
    // A gate that rewrote a tracked file passed on a tree the target would never get.
    if (await steps.trackedChanges()) return end("blocked", "dirty");

    steps.status(`round ${round}: diff`);
    const diff = await steps.diff();
    if (diff.paths.length === 0) return end("done", "no_changes");
    steps.status(`round ${round}: review`);
    const review = await steps.review(round, diff);
    drafts.push(customDraft("factory-review", review));
    if (steps.cancelled() || review.status === "aborted") return end("cancelled", "cancelled");
    if (review.status === "ok" && !review.approved) return end("blocked", "review_rejected");
    if (review.status !== "ok" && review.status !== "no_diff") return end("blocked", `review_${review.status}`);
    return end(task.settings.merge === "review" ? "waiting_approve" : "merging", "passed");
  } catch (error) {
    return steps.cancelled() ? end("cancelled", "cancelled") : end("blocked", `pipeline_error: ${errorText(error)}`);
  }
}

/** Everything after a coder turn: hooks, gates, protected paths, review, then `merging` or the wait for approve. */
export async function runRound(snapshot: Snapshot, steps: PipelineSteps): Promise<RoundResult> {
  const { round, task } = snapshot;
  const drafts: Draft[] = [];
  const messageRound = (): RoundResult => {
    drafts.push(...messageRoundDrafts(round));
    return { entries: drafts, continue: true };
  };
  const end = (state: State, reason: string): RoundResult => {
    drafts.push(stateDraft(state, round, reason));
    return state !== "cancelled" && steps.pendingMessages() ? messageRound() : { entries: drafts, continue: false };
  };
  const problem = (trigger: Trigger, text: string): RoundResult => {
    const next = nextRound(snapshot, trigger, text);
    drafts.push(...next.entries);
    return next.continue ? { entries: drafts, continue: true } : end("blocked", `max_rounds: ${trigger}`);
  };

  try {
    const config = steps.config();
    const conflicts = await steps.openRebase();
    if (conflicts) return problem("conflict", conflictFeedback(round, task.mainBranch, conflicts, true));
    for (const [phase, commands] of [["hooks", config.hooks.after_code], ["gates", config.gates]] as const) {
      for (const argv of commands) {
        steps.status(`round ${round}: ${phase} ${argv.join(" ")}`);
        const result = await steps.runCommand(argv);
        drafts.push(customDraft("factory-gate", gateData(round, phase, argv, result)));
        if (steps.cancelled()) return end("cancelled", "cancelled");
        if (result.exitCode === INFRA_EXIT && !result.killed) return end("blocked", `infra: ${lastLine(result.output)}`);
        if (!passed(result)) return problem(phase, commandFeedback(round, argv, result));
      }
    }

    steps.status(`round ${round}: diff`);
    const diff = await steps.diff();
    // Nothing differs from the diff base, whatever opened the round: nothing to review, approve or merge.
    if (diff.paths.length === 0) return end("done", "no_changes");
    const touched = protectedPaths(diff.paths, config.protected);
    if (touched.length > 0) return problem("protected", protectedFeedback(round, touched));

    if (task.settings.review) {
      steps.status(`round ${round}: review`);
      const review = await steps.review(round, diff);
      drafts.push(customDraft("factory-review", review));
      if (steps.cancelled() || review.status === "aborted") return end("cancelled", "cancelled");
      if (review.status === "ok" && !review.approved) return problem("review", reviewFeedback(round, review.findings));
      if (review.status !== "ok" && review.status !== "no_diff") return end("blocked", `review_${review.status}`);
    }

    // The message is about a change that is neither approved nor merged yet: it goes first.
    if (steps.pendingMessages()) return messageRound();
    const passedInto: State = task.settings.merge === "review" ? "waiting_approve" : "merging";
    if (steps.askCommitMessage?.()) {
      drafts.push(commitAskDraft(round));
      return { entries: drafts, continue: true, commitAsk: passedInto };
    }
    return end(passedInto, "passed");
  } catch (error) {
    return steps.cancelled() ? end("cancelled", "cancelled") : end("blocked", `pipeline_error: ${errorText(error)}`);
  }
}
