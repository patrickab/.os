/**
 * A message to a task that is merged already (`done`, reason `merged`): a follow-up run.
 *
 * - The coder works in the task's worktree (made again from its branch when it is gone, `restoreWorktree` in
 *   `launch.ts`); once the gates pass, the change merges as a normal new commit through the usual merge, with its own
 *   commit message (the coder is asked for it, `commitmsg.ts`). No history is rewritten
 * - `followUpPrompt`: the system prompt section of such a run
 * - `registerNewTaskTool`: the tool `factory_new_task {title, handoff}`, which starts a task for a part of the request
 *   outside the task's scope through `tasks.start`, on the parent's target branch and merge mode
 * - `registerAskSupervisorTool`: the tool `factory_ask_supervisor {question}`, which records the question, rests the
 *   task in `waiting_answer` and ends the coder's turn; the next message to the task is the answer
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { COMMIT_TITLE_RE } from "./commitmsg.ts";
import { callAction } from "./core.ts";
import { primaryCheckout } from "./git.ts";
import { runCommand } from "./run.ts";
import type { StoredSettings } from "./settings.ts";
import type { SpawnData } from "./state.ts";
import { errorText, isRecord } from "./util.ts";

/** The system prompt section of a follow-up run on the task merged as `merged`. */
export function followUpPrompt(merged: string | null): string {
  const commit = merged === null ? "" : ` as ${merged.slice(0, 12)}`;
  return (
    `This message follows up on the task, which is merged${commit}. Your change merges as a new commit once it passes. ` +
    "A part of the request outside the task's scope goes to a new task through `factory_new_task` (a conventional commit title, and a handoff that states the request completely: the new task's coder sees nothing else); at most one per message."
  );
}

/** What decides whether `factory_new_task` may start a task now, where a started one is recorded, and its settings. */
export interface NewTaskToolGate {
  /** Why the tool is refused now, null when it may start a task. */
  refusal(): string | null;
  /** The settings the new task takes over from this one: its target branch and merge mode. */
  overrides(): StoredSettings;
  spawned(spawn: SpawnData): void;
}

export const NEW_TASK_TOOL = "factory_new_task";

/** How the tool starts a task: a test swaps it for a fake. */
export const newTaskDeps = { callAction };

/** Registers `factory_new_task {title, handoff}`: starts a task in the session's repository through `tasks.start`. */
export function registerNewTaskTool(pi: ExtensionAPI, gate: NewTaskToolGate): void {
  pi.registerTool({
    name: NEW_TASK_TOOL,
    label: "New factory task",
    description:
      "Start a new factory task for the part of a follow-up request outside this merged task's scope: title = a conventional commit title, handoff = the complete request for the new task's coder, who sees nothing else. Only in a follow-up on a merged task, at most once per message.",
    parameters: {
      type: "object",
      required: ["title", "handoff"],
      properties: {
        title: { type: "string", description: "Conventional commit title, e.g. `fix(api): handle empty input`" },
        handoff: { type: "string", description: "The new task's request, complete" },
      },
    } as never,
    async execute(_toolCallId, params: unknown, signal, _onUpdate, ctx) {
      const fail = (text: string) => ({ content: [{ type: "text" as const, text: `${NEW_TASK_TOOL}: ${text}` }], details: undefined, isError: true });
      const refusal = gate.refusal();
      if (refusal !== null) return fail(refusal);
      const { title, handoff } = isRecord(params) ? params : {};
      if (typeof title !== "string" || !COMMIT_TITLE_RE.test(title)) return fail("title must be a conventional commit title (`type(scope): summary`)");
      if (typeof handoff !== "string" || handoff.trim() === "") return fail("handoff must be the new task's request, not empty");
      try {
        const { primary } = await primaryCheckout(runCommand, ctx.cwd);
        const view = await newTaskDeps.callAction("tasks.start", { repo: primary, title, request: handoff, overrides: gate.overrides() }, { cwd: ctx.cwd, signal });
        const id = isRecord(view) && typeof view.id === "string" ? view.id : "";
        gate.spawned({ id, title });
        return { content: [{ type: "text" as const, text: `started task ${id.slice(0, 8)}: ${title}` }], details: { id, title } };
      } catch (error) {
        return fail(errorText(error));
      }
    },
  });
}

/** What decides whether `factory_ask_supervisor` may ask now, and how a question is recorded. */
export interface AskSupervisorToolGate {
  /** Why the tool is refused now, null when the coder may ask. */
  refusal(): string | null;
  /** Records the question and rests the task in `waiting_answer`. */
  asked(question: string, ctx: ExtensionContext): void;
}

export const ASK_SUPERVISOR_TOOL = "factory_ask_supervisor";

/** Registers `factory_ask_supervisor {question}`: a terminating call, so the turn ends with the question. */
export function registerAskSupervisorTool(pi: ExtensionAPI, gate: AskSupervisorToolGate): void {
  pi.registerTool({
    name: ASK_SUPERVISOR_TOOL,
    label: "Ask the supervisor",
    description:
      "Ask whoever runs this factory task a question you cannot answer from the request or the code (a decision, missing information). Your turn ends with the call; the answer arrives as the next message and you continue the same round. Ask only when guessing would risk wrong work.",
    promptSnippet: "Ask the task's supervisor a blocking question; the turn ends and the answer comes as the next message",
    parameters: {
      type: "object",
      required: ["question"],
      properties: { question: { type: "string", description: "The question, self-contained: the supervisor has not seen your work" } },
    } as never,
    async execute(_toolCallId, params: unknown, _signal, _onUpdate, ctx) {
      const fail = (text: string) => ({ content: [{ type: "text" as const, text: `${ASK_SUPERVISOR_TOOL}: ${text}` }], details: undefined, isError: true });
      const refusal = gate.refusal();
      if (refusal !== null) return fail(refusal);
      const { question } = isRecord(params) ? params : {};
      if (typeof question !== "string" || question.trim() === "") return fail("question must not be empty");
      gate.asked(question, ctx);
      return { content: [{ type: "text" as const, text: "Question recorded. Stop now: the answer arrives as the next message." }], details: { question }, terminate: true };
    },
  });
}
