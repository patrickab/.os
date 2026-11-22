/**
 * Factory task state, without Pi, git or I/O.
 *
 * - Provides the entry shapes the extension writes (`factory-task`, `-round`, `-gate`, `-review`, `-merge-intent`,
 *   `-merge`, `-state`)
 * - Provides the reducer that rebuilds a task from those entries (`rebuild`), the same one that tracks it live (`applyEntry`)
 * - Provides the round budget, the `/factory start` payload check and the feedback texts the coder reads
 */
import type { CommandResult } from "./run.ts";

export type State = "running" | "waiting_approve" | "blocked" | "merging" | "done" | "cancelled";
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
  request: string;
  title: string;
  settings: Settings;
}

export interface Task extends StartPayload {
  /** The task's own branch, checked out in its worktree. */
  branch: string;
  /** `settings.branch`: what the task branch is rebased onto and merges into. */
  mainBranch: string;
  /** HEAD at start. */
  baseSha: string;
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
}

export const FEEDBACK_TYPE = "factory-feedback";
/** The prompt of `/factory retry`. */
export const RETRY_PROMPT = "Continue the task. If a problem was reported above, fix it. Then stop.";
const MERGE_FAILED_PROMPT_START = "The merge of the task failed: ";
export const OUTPUT_TAIL_CHARS = 4000;

export interface CustomDraft {
  type: "custom";
  customType: string;
  data: unknown;
}

export interface FeedbackDraft {
  type: "custom_message";
  customType: typeof FEEDBACK_TYPE;
  content: string;
  display: true;
  details: { round: number; trigger: Trigger };
}

export type Draft = CustomDraft | FeedbackDraft;

const RUN_TRIGGERS: readonly Trigger[] = ["start", "message", "retry"];

export function applyEntry(snapshot: Snapshot | undefined, customType: string, data: unknown): Snapshot | undefined {
  if (customType === "factory-task") {
    return { task: data as Task, state: "running", round: 0, runFirstRound: 1, reason: "", mergeIntent: null, mergeError: null };
  }
  if (!snapshot) return undefined;
  if (customType === "factory-round") {
    const { round, trigger } = data as { round: number; trigger: Trigger };
    const opensRun = RUN_TRIGGERS.includes(trigger) || (trigger === "conflict" && snapshot.state !== "running" && snapshot.state !== "merging");
    return { ...snapshot, round, runFirstRound: opensRun ? round : snapshot.runFirstRound };
  }
  if (customType === "factory-state") {
    const { state, reason } = data as StateData;
    return { ...snapshot, state, reason, mergeIntent: null };
  }
  if (customType === "factory-merge-intent") return { ...snapshot, mergeIntent: data as MergeIntentData };
  if (customType === "factory-merge") {
    const { ok, error } = data as MergeData;
    return { ...snapshot, mergeIntent: null, mergeError: ok ? null : error };
  }
  return snapshot;
}

/** The task of a session branch, or undefined when the branch holds no `factory-task` entry. */
export function rebuild(entries: Iterable<{ type: string }>): Snapshot | undefined {
  let snapshot: Snapshot | undefined;
  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    const { customType, data } = entry as { type: string; customType?: unknown; data?: unknown };
    if (typeof customType === "string" && customType.startsWith("factory-")) snapshot = applyEntry(snapshot, customType, data);
  }
  return snapshot;
}

/** The prompt of `/factory retry` after a failed merge: no message the coder saw holds the merge's error. */
export function mergeFailedPrompt(error: string): string {
  return `${MERGE_FAILED_PROMPT_START}${error}\nFix the cause, then stop.`;
}

function userText(message: { content?: unknown }): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.flatMap((part) => (part?.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n");
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
    const text = userText(message);
    if (!requestSeen) {
      requestSeen = true;
      continue;
    }
    if (text.trimStart().startsWith("/factory") || text === RETRY_PROMPT || text.startsWith(MERGE_FAILED_PROMPT_START)) continue;
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

export function customDraft(customType: string, data: unknown): CustomDraft {
  return { type: "custom", customType, data };
}

export function stateDraft(state: State, round: number, reason: string): CustomDraft {
  return customDraft("factory-state", { state, round, reason } satisfies StateData);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const { request, title, settings } = raw;
  if (typeof request !== "string" || request.trim() === "") throw new Error("request must be a non-empty string");
  if (typeof title !== "string" || title.trim() === "") throw new Error("title must be a non-empty string");
  if (!isRecord(settings)) throw new Error("settings must be an object");
  const { branch, merge, maxRounds, review, models } = settings;
  if (typeof branch !== "string" || branch.trim() === "") throw new Error("settings.branch must be a non-empty string");
  if (merge !== "auto" && merge !== "review") throw new Error('settings.merge must be "auto" or "review"');
  if (typeof maxRounds !== "number" || !Number.isInteger(maxRounds) || maxRounds < 1) throw new Error("settings.maxRounds must be a positive integer");
  if (typeof review !== "boolean") throw new Error("settings.review must be a boolean");
  if (!isRecord(models)) throw new Error("settings.models must be an object");
  const roleModels: Settings["models"] = {};
  for (const role of ["coder", "reviewer"] as const) {
    const model = models[role];
    if (model === undefined) continue;
    if (typeof model !== "string" || !model.includes("/")) throw new Error(`settings.models.${role} must be "provider/model"`);
    roleModels[role] = model;
  }
  return { request, title, settings: { branch, merge, maxRounds, review, models: roleModels } };
}
