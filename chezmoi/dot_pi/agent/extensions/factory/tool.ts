/**
 * The `factory` tool: every core action (`core.ts`) for an agent, one tool call per action.
 *
 * - Provides `agentActions` (every `ACTIONS` name but the `hostOnly` ones) and `factoryToolParameters`: the JSON schema
 *   of the tool, `action` (one of them) plus their params, built from `ACTIONS`
 * - Provides `registerFactoryTool` (sequential: one call at a time): the answer is the action's result as JSON text
 *   and as `details`; every failure is an `isError` result of one sentence starting `factory: `
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ACTIONS, callAction, type ActionName } from "./core.ts";
import { errorText, isRecord } from "./util.ts";

type Schema = Record<string, unknown>;

/** The actions an agent may call: every one but the `hostOnly` ones. */
export function agentActions(): ActionName[] {
  return (Object.keys(ACTIONS) as ActionName[]).filter((name) => !ACTIONS[name].hostOnly);
}

/** `action` and the union of the actions' params. A param several actions share names each of them in its description. */
export function factoryToolParameters(): { type: "object"; required: ["action"]; properties: Record<string, Schema> } {
  const names = agentActions();
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
      'Hand a self-contained coding task to a background factory run: it codes in its own git worktree, runs the repo\'s gates and merges when they pass. Use it in a git repository whose target branch has a committed factory.yaml; "tasks.start" returns at once with the task. Check on it later with "tasks.get" (or "tasks.list"), and use tasks.approve, tasks.retry, tasks.cancel, tasks.message and tasks.remove as its state asks.',
    promptSnippet: "Run a self-contained coding task in the background in a git repo with a factory.yaml; check it later with tasks.get",
    parameters: factoryToolParameters(),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const { action, ...rest } = isRecord(params) ? params : {};
        const name = String(action);
        // A host-only action is as unknown to the agent as a made-up one.
        if (!(agentActions() as string[]).includes(name)) throw new Error(`unknown action "${name}"`);
        const result = await callAction(name, rest, { cwd: ctx.cwd, signal });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      } catch (error) {
        return { content: [{ type: "text", text: `factory: ${errorText(error)}` }], details: undefined, isError: true };
      }
    },
  });
}
