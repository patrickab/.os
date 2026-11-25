/**
 * The `factory` tool: every core action (`core.ts`) for an agent, one tool call per action.
 *
 * - Provides `agentActions` (every `ACTIONS` name but the `hostOnly` ones) and `factoryToolParameters`: the JSON schema
 *   of the tool, `action` (one of them) plus their params, built from `ACTIONS`
 * - Provides `registerFactoryTool` (sequential: one call at a time): the answer is the action's result as JSON text
 *   and as `details`; every failure is an `isError` result of one sentence starting `factory: `
 * - In a task session (`isTaskSession`: Pi started by the runner, or a session holding a `factory-task` entry) only the
 *   actions with `mutates: false` are offered; a mutating one answers as unknown. A task's coder starts a task only
 *   through `factory_new_task` (`followup.ts`)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ACTIONS, callAction, type ActionName } from "./core.ts";
import { TASK_SESSION_ENV } from "./runner.ts";
import { errorText, isRecord } from "./util.ts";

type Schema = Record<string, unknown>;

/** The actions an agent may call: every one but the `hostOnly` ones; in a task session only those with `mutates: false`. */
export function agentActions(taskSession = false): ActionName[] {
  return (Object.keys(ACTIONS) as ActionName[]).filter((name) => !ACTIONS[name].hostOnly && !(taskSession && ACTIONS[name].mutates));
}

/** Whether the tool runs in a factory task's session: Pi started by the runner, or a session branch holding a `factory-task` entry. */
export function isTaskSession(branch: Iterable<{ type: string }>): boolean {
  if (process.env[TASK_SESSION_ENV] === "1") return true;
  for (const entry of branch) if (entry.type === "custom" && (entry as { customType?: unknown }).customType === "factory-task") return true;
  return false;
}

/** `action` and the union of the actions' params. A param several actions share names each of them in its description. */
export function factoryToolParameters(taskSession = false): { type: "object"; required: ["action"]; properties: Record<string, Schema> } {
  const names = agentActions(taskSession);
  const shared = new Map<string, { schema: Schema; uses: { action: ActionName; description: unknown }[] }>();
  for (const name of names) {
    for (const [key, schema] of Object.entries(ACTIONS[name].params.properties as Record<string, Schema>)) {
      const entry = shared.get(key) ?? { schema, uses: [] };
      entry.uses.push({ action: name, description: schema.description });
      shared.set(key, entry);
    }
  }
  const properties: Record<string, Schema> = {
    action: { type: "string", enum: names, description: names.map((name) => `${name}: ${ACTIONS[name].summary}`).join(". ") },
  };
  for (const [key, { schema, uses }] of shared) {
    const descriptions = new Set(uses.map((use) => use.description));
    const description =
      descriptions.size === 1 && uses[0].description !== undefined
        ? `${uses.map((use) => use.action).join(", ")}: ${String(uses[0].description)}`
        : uses.map((use) => (use.description === undefined ? use.action : `${use.action}: ${String(use.description)}`)).join(". ");
    properties[key] = { ...schema, description };
  }
  return { type: "object", required: ["action"], properties };
}

export function registerFactoryTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "factory",
    label: "Factory",
    description:
      'Hand a self-contained coding task to a background factory run: it codes in its own git worktree, runs the repo\'s gates and merges when they pass. Use it in a git repository whose target branch has a committed factory.yaml; "tasks.start" returns at once with the task. Give related tasks one tag (path segments like "plugin/m1/w1"; default the system user) and filter "tasks.list" by a tag or its prefix. Instead of polling "tasks.get", block on "tasks.wait" (ids or tag): it answers once every watched task rests or one needs attention (waiting for approve or for an answer, blocked, cancelled, interrupted), or at its timeout. To gate an existing branch into its target without a coder, start kind "merge_request" with source (the branch) and overrides.branch (the target): rebased unsquashed, gated, reviewed (request = the reviewer\'s instructions), merged. Use tasks.approve, tasks.retry, tasks.cancel, tasks.message and tasks.remove as a task\'s state asks.',
    promptSnippet: "Run a self-contained coding task in the background in a git repo with a factory.yaml; wait for it with tasks.wait or check it with tasks.get",
    // The runner's environment is known at load; a session that gets its task later is checked per call.
    parameters: factoryToolParameters(process.env[TASK_SESSION_ENV] === "1"),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const { action, ...rest } = isRecord(params) ? params : {};
        const name = String(action);
        // A host-only action, or a mutating one in a task session, is as unknown to the agent as a made-up one.
        if (!(agentActions(isTaskSession(ctx.sessionManager.getBranch())) as string[]).includes(name)) throw new Error(`unknown action "${name}"`);
        const result = await callAction(name, rest, { cwd: ctx.cwd, signal });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      } catch (error) {
        return { content: [{ type: "text", text: `factory: ${errorText(error)}` }], details: undefined, isError: true };
      }
    },
  });
}
