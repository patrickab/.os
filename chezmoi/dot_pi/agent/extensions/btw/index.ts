/**
 * btw: side questions about the current conversation that never touch the main run or session.
 *
 *   /btw <question>                   ask; the answer streams in a widget while the main run goes on
 *   /btw-followup [id] <question>     ask again in a thread (default: the newest)
 *   /btw-cancel [id]                  stop a streaming answer (default: the newest streaming)
 *   /btw-dismiss [id]                 close a thread (default: the newest)
 *   /btw-list                         list the threads, publish the state again
 *   /btw-action {"action", "params"}  any `ACTIONS` entry with JSON params (what an RPC client sends)
 *
 * - A thin client of `core.ts`: commands map to actions through `commandCall`, Esc through `escapeCall`
 * - The host side of `BtwSession`: the main conversation is read from `ctx.sessionManager` (compaction-aware
 *   projection, serialized as text) and the answer streams from `ctx.modelRegistry.streamSimple` with `ctx.model`.
 *   Never `appendEntry`, `sendMessage` or `sendUserMessage`: nothing reaches the main session or its context
 * - Every state change goes out as the `btw_state` event (`btwStateEvent`): on `pi.events` for extensions in the same
 *   process, and in RPC mode as the widget `btw_state` whose one line is the event's JSON (throttled, see README)
 * - TUI: the widget `btw` above the editor renders the newest thread. Esc cancels or closes it, but only while the
 *   main agent is idle and the editor empty, so Esc keeps aborting the main run
 * - A new or switched session starts with no threads; shutdown cancels every stream
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { convertToLlm, getMarkdownTheme, serializeConversation } from "@earendil-works/pi-coding-agent";
import type { Api, AssistantMessage, Context, Message, Model } from "@earendil-works/pi-ai";
import { matchesKey, type TUI } from "@earendil-works/pi-tui";
import {
  BTW_STATE_EVENT,
  BtwError,
  btwStateEvent,
  COMMANDS,
  commandCall,
  createBtwCore,
  escapeCall,
  listLines,
  type BtwCompletionContext,
  type BtwSession,
  type BtwState,
  type CommandName,
} from "./core.ts";
import { BtwWidget } from "./widget.ts";

/** Key of the TUI widget. */
const TUI_WIDGET_KEY = "btw";
/** The RPC widget carries at most one `btw_state` line per this many ms; the last state always goes out. */
export const RPC_PUBLISH_INTERVAL_MS = 100;

/** The plain completion context as a pi-ai `Context`: earlier answers become assistant messages of `model`. */
export function toModelContext(context: BtwCompletionContext, model: Model<Api>): Context {
  const messages: Message[] = context.messages.map((message): Message => {
    if (message.role === "user") return { role: "user", content: message.content, timestamp: message.timestamp };
    const assistant: AssistantMessage = {
      role: "assistant",
      content: message.content,
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: message.timestamp,
    };
    return assistant;
  });
  return { systemPrompt: context.systemPrompt, messages };
}

/** The main session of `ctx` as the core sees it: read only. */
export function hostSession(ctx: ExtensionContext): BtwSession {
  const model = ctx.model;
  return {
    modelName: () => (model ? `${model.provider}/${model.id}` : null),
    forkContext: () => serializeConversation(convertToLlm(ctx.sessionManager.buildSessionProjection().messages)),
    async *stream(context, signal) {
      if (!model) throw new Error("no model is selected");
      const events = ctx.modelRegistry.streamSimple(model, toModelContext(context, model), { signal });
      for await (const event of events) {
        if (event.type === "text_delta") yield event.delta;
        else if (event.type === "error") {
          if (event.reason === "aborted") return;
          throw new Error(event.error.errorMessage || "the completion failed");
        }
      }
    },
  };
}

export default function (pi: ExtensionAPI) {
  /** The context of the current session: whose UI shows the state. */
  let ui: ExtensionContext | undefined;
  let widget: { component: BtwWidget; tui: TUI } | undefined;
  let widgetMounted = false;
  let rpcTimer: ReturnType<typeof setTimeout> | undefined;
  let rpcSentAt = 0;
  let unsubscribeInput: (() => void) | undefined;

  const sendRpcState = () => {
    rpcTimer = undefined;
    rpcSentAt = Date.now();
    const state = core.state();
    if (ui?.mode !== "rpc") return;
    ui.ui.setWidget(BTW_STATE_EVENT, state.threads.length ? [JSON.stringify(btwStateEvent(state))] : undefined);
  };

  const showTui = (state: BtwState) => {
    if (ui?.mode !== "tui") return;
    if (state.threads.length === 0) {
      if (widgetMounted) ui.ui.setWidget(TUI_WIDGET_KEY, undefined);
      widgetMounted = false;
      widget = undefined;
      return;
    }
    if (widgetMounted && widget) {
      widget.component.invalidate();
      widget.tui.requestRender();
      return;
    }
    widgetMounted = true;
    ui.ui.setWidget(TUI_WIDGET_KEY, (tui, theme) => {
      const component = new BtwWidget(core.state, theme, getMarkdownTheme(), () => void escape());
      widget = { component, tui };
      return component;
    });
  };

  const publish = (state: BtwState, now = false) => {
    pi.events.emit(BTW_STATE_EVENT, btwStateEvent(state));
    showTui(state);
    if (ui?.mode !== "rpc") return;
    if (now) {
      if (rpcTimer) clearTimeout(rpcTimer);
      sendRpcState();
    } else if (!rpcTimer) {
      rpcTimer = setTimeout(sendRpcState, Math.max(0, rpcSentAt + RPC_PUBLISH_INTERVAL_MS - Date.now()));
    }
  };

  const core = createBtwCore({ onState: (state) => publish(state) });

  const fail = (ctx: ExtensionContext, error: unknown) => {
    const text = error instanceof BtwError || error instanceof Error ? error.message : String(error);
    if (ctx.hasUI) ctx.ui.notify(`btw: ${text}`, "error");
  };

  /** Esc and the close click: the newest thread's `escapeCall`. */
  const escape = async () => {
    const call = escapeCall(core.state());
    if (!call || !ui) return;
    try {
      await core.callAction(call.name, call.params, hostSession(ui));
    } catch (error) {
      fail(ui, error);
    }
  };

  for (const [name, spec] of Object.entries(COMMANDS) as [CommandName, (typeof COMMANDS)[CommandName]][]) {
    pi.registerCommand(name, {
      description: spec.summary,
      handler: async (args, ctx) => {
        ui = ctx;
        const call = commandCall(name, args, core.state());
        if ("error" in call) return fail(ctx, new Error(call.error));
        try {
          const result = await core.callAction(call.name, call.params, hostSession(ctx));
          if (call.name === "btw.list") {
            publish(result.state, true);
            if (ctx.hasUI) ctx.ui.notify(listLines(result.state).join("\n"), "info");
          }
        } catch (error) {
          fail(ctx, error);
        }
      },
    });
  }

  pi.on("session_start", (_event, ctx) => {
    ui = ctx;
    widgetMounted = false;
    widget = undefined;
    core.reset();
    unsubscribeInput?.();
    unsubscribeInput = undefined;
    if (ctx.mode !== "tui") return;
    unsubscribeInput = ctx.ui.onTerminalInput((data) => {
      if (!matchesKey(data, "escape") || !escapeCall(core.state())) return undefined;
      if (!ctx.isIdle() || ctx.ui.getEditorText() !== "") return undefined;
      void escape();
      return { consume: true };
    });
  });

  pi.on("session_shutdown", () => {
    unsubscribeInput?.();
    unsubscribeInput = undefined;
    core.reset();
    if (rpcTimer) clearTimeout(rpcTimer);
    rpcTimer = undefined;
    ui = undefined;
  });
}
