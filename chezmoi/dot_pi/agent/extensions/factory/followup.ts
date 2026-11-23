/**
 * A message to a task that is merged already (`done`, reason `merged`): a follow-up run.
 *
 * - The coder works in the task's worktree (made again from its branch when it is gone, `restoreWorktree` in
 *   `launch.ts`); once the gates pass, the change merges as a normal new commit through the usual merge, with its own
 *   commit message (the coder is asked for it, `commitmsg.ts`). No history is rewritten
 * - `followUpPrompt`: the system prompt section of such a run
 * - `registerNewTaskTool`: the tool `factory_new_task {title, handoff}`, which starts a task for a part of the request
 *   outside the task's scope through `tasks.start`, on the parent's target branch and merge mode
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
