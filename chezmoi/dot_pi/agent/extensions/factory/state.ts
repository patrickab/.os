/**
 * Factory task state, without Pi, git or I/O.
 *
 * - Provides the entry shapes the extension writes (`factory-task`, `-round`, `-gate`, `-review`, `-merge-intent`,
 *   `-merge`, `-state`, `-commit-message`, `-spawn`, `-question`)
 * - Provides the reducer that rebuilds a task from those entries (`rebuild`), the same one that tracks it live (`applyEntry`)
 * - Provides the round budget, the `/factory start` payload check and the feedback texts the coder reads
 */
import type { CommitMessage } from "./commitmsg.ts";
import type { CommandResult } from "./run.ts";
import type { TaskKind } from "./tasks.ts";
import { isRecord } from "./util.ts";

/** `waiting_answer`: the coder asked the supervisor (`factory-question`); the next message answers it. */
export type State = "running" | "waiting_approve" | "waiting_answer" | "blocked" | "merging" | "done" | "cancelled";
/** A task in one of these states does nothing until someone sends it a command or a message. */
export const RESTING_STATES: readonly State[] = ["waiting_approve", "waiting_answer", "blocked", "done", "cancelled"];
export type GatePhase = "hooks" | "gates" | "merge_gates" | "after_merge";
export type Trigger = "start" | "hooks" | "gates" | "review" | "protected" | "message" | "retry" | "conflict";
export type Severity = "blocker" | "major" | "minor";
export type ReviewStatus = "ok" | "malformed" | "timeout" | "aborted" | "failed" | "no_diff";

export interface Settings {
  /** The branch the task's worktree starts from, is rebased onto and merges into. */
  branch: string;
  merge: "auto" | "review";
  maxRounds: number;
  review: boolean;
  models: { coder?: string; reviewer?: string };
}

export interface StartPayload {
  /** For a `merge_request`: the reviewer's extra instructions. */
  request: string;
  title: string;
  settings: Settings;
  /** Absent: `task`. A `merge_request` reviews and merges the branch its worktree has checked out, no coder turn ever. */
  kind?: TaskKind;
}

export interface Task extends StartPayload {
  /** The task's own branch, checked out in its worktree. */
  branch: string;
  /** `settings.branch`: what the task branch is rebased onto and merges into. */
  mainBranch: string;
  /** HEAD at start. */
  baseSha: string;
  /** `PROTOCOL_VERSION` of the plugin that started the task. Absent on tasks started before it was written. */
  protocol?: number;
  /** Absent on tasks started before merge requests existed: `task`. */
  kind?: TaskKind;
  /** The branch a `merge_request` reviews and merges (its `branch`), null for a `task`. Absent on older tasks. */
  source?: string | null;
}

export function isMergeRequest(task: Pick<Task, "kind">): boolean {
  return task.kind === "merge_request";
}

/** The version of the entry protocol, written into every new `factory-task` entry. */
export const PROTOCOL_VERSION = 2;

export interface RoundData {
  round: number;
  trigger: Trigger;
}

export interface GateData {
  round: number;
  phase: GatePhase;
  argv: string[];
  /** Null when a signal ended the command, so a killed gate never reads as exit 0. */
  exitCode: number | null;
  killed: boolean;
  durationMs: number;
  outputTail: string;
}

export interface Finding {
  file: string;
  line: number | null;
  severity: Severity;
  text: string;
}

export interface ReviewUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface ReviewData {
  round: number;
  status: ReviewStatus;
  approved: boolean;
  findings: Finding[];
  model: string | null;
  sessionFile: string | null;
  usage: ReviewUsage;
  wallMs: number;
}

export interface MergeData {
  ok: boolean;
  commit: string | null;
  error: string | null;
  depsSynced: boolean;
}

/**
 * Written right before the step of a merge that cannot be undone, so a session that dies during it can tell on resume
 * whether the merge landed: `commit` is the commit the main branch moves to, `before` where it was.
 */
export interface MergeIntentData {
  commit: string;
  before: string;
  /** The message of the merge commit. Absent on entries written before it existed. */
  message?: CommitMessage;
}

/** A task the coder started with `factory_new_task` from a follow-up of this one. */
export interface SpawnData {
  id: string;
  title: string;
}

/** What the coder asked the supervisor with `factory_ask_supervisor`. */
export interface QuestionData {
  text: string;
}

export interface StateData {
  state: State;
  round: number;
  reason: string;
}

/** What the extension knows about its task: rebuilt from the session's entries, updated with every entry it writes. */
export interface Snapshot {
  task: Task;
  state: State;
  round: number;
  /**
   * First round of the current run. `start`, `message` and `retry` each open a run with a fresh `maxRounds` budget, so
   * does a `conflict` round opened on a task at rest (in place of the `message` or `retry` round).
   */
  runFirstRound: number;
  reason: string;
  /** Written by a merge that has not recorded its `factory-merge` entry yet. */
  mergeIntent: MergeIntentData | null;
  /** The error of the last merge, when it failed. */
  mergeError: string | null;
  /** The commit the last successful merge landed for the task (`MergeData.commit`). */
  mergedCommit: string | null;
  /** The coder's commit message for the next merge (`factory-commit-message`), null when the task title is used; a successful merge clears it. */
  commitMessage: CommitMessage | null;
  /** The coder's open question while the task is `waiting_answer`, else absent. */
  question?: string;
}

export const FEEDBACK_TYPE = "factory-feedback";
/** The `custom_message` that asks the coder for the commit message once the last round passed. */
export const COMMIT_ASK_TYPE = "factory-commit-ask";
/** The prompt of `/factory retry`. */
export const RETRY_PROMPT = "Continue the task. If a problem was reported above, fix it. Then stop.";
const MERGE_FAILED_PROMPT_START = "The merge of the task failed: ";
export const OUTPUT_TAIL_CHARS = 4000;

/** The data of each `custom` entry the extension writes, by its `customType`. */
export interface EntryData {
  "factory-task": Task;
  "factory-round": RoundData;
  "factory-gate": GateData;
  "factory-review": ReviewData;
  "factory-merge-intent": MergeIntentData;
  "factory-merge": MergeData;
  "factory-state": StateData;
  "factory-commit-message": CommitMessage;
  "factory-spawn": SpawnData;
  "factory-question": QuestionData;
}

export type EntryType = keyof EntryData;

export interface CustomEntry<K extends EntryType> {
  type: "custom";
  customType: K;
  data: EntryData[K];
}

export type EntryDraft = { [K in EntryType]: CustomEntry<K> }[EntryType];

export interface FeedbackDraft {
  type: "custom_message";
  customType: typeof FEEDBACK_TYPE;
  content: string;
  display: true;
  details: { round: number; trigger: Trigger };
}

export interface CommitAskDraft {
  type: "custom_message";
  customType: typeof COMMIT_ASK_TYPE;
  content: string;
  display: true;
  details: { round: number };
}

export type Draft = EntryDraft | FeedbackDraft | CommitAskDraft;

const RUN_TRIGGERS: readonly Trigger[] = ["start", "message", "retry"];

type Reducer<K extends EntryType> = (snapshot: Snapshot | undefined, data: EntryData[K]) => Snapshot | undefined;

const REDUCERS: { [K in EntryType]: Reducer<K> } = {
  "factory-task": (_snapshot, task) => ({ task, state: "running", round: 0, runFirstRound: 1, reason: "", mergeIntent: null, mergeError: null, mergedCommit: null, commitMessage: null }),
  "factory-round": (snapshot, { round, trigger }) => {
    if (!snapshot) return undefined;
    const opensRun = RUN_TRIGGERS.includes(trigger) || (trigger === "conflict" && snapshot.state !== "running" && snapshot.state !== "merging");
    return { ...snapshot, round, runFirstRound: opensRun ? round : snapshot.runFirstRound };
  },
  "factory-gate": (snapshot) => snapshot,
  "factory-review": (snapshot) => snapshot,
  "factory-merge-intent": (snapshot, mergeIntent) => snapshot && { ...snapshot, mergeIntent },
  "factory-merge": (snapshot, { ok, error, commit }) =>
    snapshot && {
      ...snapshot,
      mergeIntent: null,
      mergeError: ok ? null : error,
      mergedCommit: ok && commit ? commit : snapshot.mergedCommit,
      // A message is the merge's own: a follow-up on the merged task gets asked for a new one.
      commitMessage: ok ? null : snapshot.commitMessage,
    },
  "factory-state": (snapshot, { state, reason }) =>
    snapshot && { ...snapshot, state, reason, mergeIntent: null, question: state === "waiting_answer" ? snapshot.question : undefined },
  "factory-commit-message": (snapshot, commitMessage) => snapshot && { ...snapshot, commitMessage },
  "factory-spawn": (snapshot) => snapshot,
  "factory-question": (snapshot, { text }) => snapshot && { ...snapshot, question: text },
};

export function isEntryType(value: string): value is EntryType {
  return Object.hasOwn(REDUCERS, value);
}

export function applyEntry<K extends EntryType>(snapshot: Snapshot | undefined, customType: K, data: EntryData[K]): Snapshot | undefined {
  const reduce: Reducer<K> = REDUCERS[customType];
  return reduce(snapshot, data);
}

/** The task of a session branch, or undefined when the branch holds no `factory-task` entry. Unknown `factory-*` entries are skipped. */
export function rebuild(entries: Iterable<{ type: string }>): Snapshot | undefined {
  let snapshot: Snapshot | undefined;
  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    const { customType, data } = entry as { type: string; customType?: unknown; data?: unknown };
    if (typeof customType === "string" && isEntryType(customType)) snapshot = applyEntry(snapshot, customType, data as EntryData[EntryType]);
  }
  return snapshot;
}

/** The prompt of `/factory retry` after a failed merge: no message the coder saw holds the merge's error. */
export function mergeFailedPrompt(error: string): string {
  return `${MERGE_FAILED_PROMPT_START}${error}\nFix the cause, then stop.`;
}

/** The text parts of a message's content (a string, or parts of which only `text` ones count), joined by newlines. */
export function messageText(message: { content?: unknown }): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.flatMap((part) => (part?.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n");
}

/** A user message the plugin sent itself: a `/factory` command or the prompt of `/factory retry`. */
export function isFactoryPrompt(text: string): boolean {
  return text.trimStart().startsWith("/factory") || text === RETRY_PROMPT || text.startsWith(MERGE_FAILED_PROMPT_START);
}

/**
 * The user's messages to the task of a session branch after its request, in order: the user `message` entries after
 * the `factory-task` entry but the first (the request `/factory start` sends), `/factory` commands and the prompts of
 * `/factory retry`. Feedback is a `custom_message` entry and never one of them.
 */
export function followUpMessages(entries: Iterable<{ type: string }>): string[] {
  let messages: string[] | undefined;
  let requestSeen = false;
  for (const entry of entries) {
    const { customType, message } = entry as { customType?: unknown; message?: { role?: unknown; content?: unknown } };
    if (entry.type === "custom" && customType === "factory-task") {
      messages = [];
      requestSeen = false;
    }
    if (!messages || entry.type !== "message" || message?.role !== "user") continue;
    const text = messageText(message);
    if (!requestSeen) {
      requestSeen = true;
      continue;
    }
    if (isFactoryPrompt(text)) continue;
    messages.push(text);
  }
  return messages ?? [];
}

export function roundsUsed(snapshot: Snapshot): number {
  return snapshot.round - snapshot.runFirstRound + 1;
}

/** A run is active only inside the process that started it, so a task loaded as `running` or `merging` was interrupted. */
export function wasInterrupted(snapshot: Snapshot): boolean {
  return snapshot.state === "running" || snapshot.state === "merging";
}

export function customDraft<K extends EntryType>(customType: K, data: EntryData[K]): CustomEntry<K> {
  return { type: "custom", customType, data };
}

export function stateDraft(state: State, round: number, reason: string): CustomEntry<"factory-state"> {
  return customDraft("factory-state", { state, round, reason });
}

export function feedbackDraft(round: number, trigger: Trigger, content: string): FeedbackDraft {
  return { type: "custom_message", customType: FEEDBACK_TYPE, content, display: true, details: { round, trigger } };
}

export function passed(result: CommandResult): boolean {
  return result.exitCode === 0 && !result.killed;
}

export function gateData(round: number, phase: GatePhase, argv: string[], result: CommandResult): GateData {
  return {
    round,
    phase,
    argv,
    exitCode: result.exitCode,
    killed: result.killed,
    durationMs: result.durationMs,
    outputTail: result.output.slice(-OUTPUT_TAIL_CHARS),
  };
}

/** `approved` is never the reviewer's own claim: it follows from the severities. */
export function approvedFrom(status: ReviewStatus, findings: Finding[]): boolean {
  return status === "ok" && findings.every((finding) => finding.severity === "minor");
}

export function commandFeedback(round: number, argv: string[], result: CommandResult): string {
  const how = result.exitCode === null ? "was killed" : `failed (exit ${result.exitCode})`;
  return `Round ${round}: \`${argv.join(" ")}\` ${how}. Fix the cause, then stop.\n\n${result.output.slice(-OUTPUT_TAIL_CHARS)}`;
}

export function protectedFeedback(round: number, paths: string[]): string {
  const list = paths.map((path) => `- ${path}`).join("\n");
  return `Round ${round}: the change touches protected paths, which a task must not modify:\n${list}\nRestore them to their original state, then stop.`;
}

/**
 * The task branch does not rebase cleanly onto `branch`: the conflicting files and how to resolve them. `leftOpen`: a
 * rebase is still in progress in the task worktree, the coder finishes it.
 */
export function conflictFeedback(round: number, branch: string, files: string[], leftOpen: boolean): string {
  const list = files.map((path) => `- ${path}`).join("\n");
  const steps = leftOpen
    ? "A rebase is still in progress in the task worktree. Resolve the conflicts, `git add` the files and run `GIT_EDITOR=true git rebase --continue` until the rebase is done, then stop."
    : `Run \`git rebase refs/heads/${branch}\`, resolve the conflicts, \`git add\` the files, run \`GIT_EDITOR=true git rebase --continue\` until the rebase is done, then stop.`;
  return `Round ${round}: the task branch conflicts with ${branch}. Conflicting files:\n${list || "- (none listed)"}\n${steps}`;
}

export function reviewFeedback(round: number, findings: Finding[]): string {
  const lines = findings.map((finding) => `- [${finding.severity}] ${finding.file}${finding.line === null ? "" : `:${finding.line}`}: ${finding.text}`);
  return `Round ${round}: the review found problems. Fix every blocker and major finding, then stop.\n\n${lines.join("\n")}`;
}

/** The highest `maxRounds` a task may run with. */
export const MAX_ROUNDS_LIMIT = 20;
/** The roles `Settings.models` sets a model for. */
export const ROLES = ["coder", "reviewer"] as const;

/**
 * The settings keys of `raw`, checked, unknown keys dropped; an absent key stays absent. Shared by the `/factory start`
 * payload and the stored settings (`settings.ts`). Throws an `Error` naming the first wrong key after `prefix`.
 */
export function parseSettingsFields(raw: Record<string, unknown>, prefix = ""): Partial<Settings> {
  const fields: Partial<Settings> = {};
  const { branch, merge, maxRounds, review, models } = raw;
  if (branch !== undefined) {
    if (typeof branch !== "string" || branch.trim() === "") throw new Error(`${prefix}branch must be a non-empty string`);
    fields.branch = branch;
  }
  if (merge !== undefined) {
    if (merge !== "auto" && merge !== "review") throw new Error(`${prefix}merge must be "auto" or "review"`);
    fields.merge = merge;
  }
  if (maxRounds !== undefined) {
    if (typeof maxRounds !== "number" || !Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > MAX_ROUNDS_LIMIT) {
      throw new Error(`${prefix}maxRounds must be an integer from 1 to ${MAX_ROUNDS_LIMIT}`);
    }
    fields.maxRounds = maxRounds;
  }
  if (review !== undefined) {
    if (typeof review !== "boolean") throw new Error(`${prefix}review must be a boolean`);
    fields.review = review;
  }
  if (models !== undefined) {
    if (!isRecord(models)) throw new Error(`${prefix}models must be an object`);
    const roleModels: Settings["models"] = {};
    for (const role of ROLES) {
      const model = models[role];
      if (model === undefined) continue;
      if (typeof model !== "string" || !model.includes("/")) throw new Error(`${prefix}models.${role} must be "provider/model"`);
      roleModels[role] = model;
    }
    fields.models = roleModels;
  }
  return fields;
}

/** The payload of `/factory start <json>`. Throws an `Error` that names the first wrong field. */
export function parseStartPayload(text: string): StartPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("payload is not JSON");
  }
  if (!isRecord(raw)) throw new Error("payload is not an object");
  const { request, title, settings, kind } = raw;
  if (kind !== undefined && kind !== "task" && kind !== "merge_request") throw new Error('kind must be "task" or "merge_request"');
  if (typeof request !== "string" || request.trim() === "") throw new Error("request must be a non-empty string");
  if (typeof title !== "string" || title.trim() === "") throw new Error("title must be a non-empty string");
  if (!isRecord(settings)) throw new Error("settings must be an object");
  const { branch, merge, maxRounds, review, models } = parseSettingsFields(settings, "settings.");
  // Every key is required here: the absent ones get the message of a wrong one.
  if (branch === undefined) throw new Error("settings.branch must be a non-empty string");
  if (merge === undefined) throw new Error('settings.merge must be "auto" or "review"');
  if (maxRounds === undefined) throw new Error(`settings.maxRounds must be an integer from 1 to ${MAX_ROUNDS_LIMIT}`);
  if (review === undefined) throw new Error("settings.review must be a boolean");
  if (models === undefined) throw new Error("settings.models must be an object");
  return { request, title, settings: { branch, merge, maxRounds, review, models }, ...(kind === "merge_request" ? { kind } : {}) };
}
