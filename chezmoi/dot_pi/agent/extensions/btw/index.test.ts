/**
 * The extension against a fake `pi` and `ctx`: commands, the host session (conversation fork, model stream), the
 * `btw_state` publication in RPC mode, and the TUI widget with Esc. The fake `pi` throws on every way into the main
 * session, so a test that reaches one fails.
 */
import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initTheme } from "@earendil-works/pi-coding-agent";
import btw, { RPC_PUBLISH_INTERVAL_MS, toModelContext } from "./index.ts";
import { BTW_STATE_EVENT, buildCompletionContext, type BtwStateEvent } from "./core.ts";

initTheme("dark");

type Handler = (event: unknown, ctx: any) => unknown;

const model = { provider: "prov", id: "mod", api: "openai-completions" };

function harness(mode: "rpc" | "tui", options: { model?: typeof model | null; deltas?: string[]; fail?: string } = {}) {
  const commands = new Map<string, (args: string, ctx: any) => Promise<void>>();
  const handlers = new Map<string, Handler>();
  const events: [string, unknown][] = [];
  const widgets: [string, unknown][] = [];
  const notes: [string, string][] = [];
  const streamCalls: { model: unknown; context: any; options: any }[] = [];
  let inputHandler: ((data: string) => { consume?: boolean } | undefined) | undefined;
  const flags = { idle: true, editor: "" };
  const forbidden = (name: string) => () => {
    throw new Error(`btw must not call pi.${name}`);
  };
  const pi = {
    registerCommand: (name: string, spec: { handler: (args: string, ctx: any) => Promise<void> }) => commands.set(name, spec.handler),
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    events: { emit: (channel: string, data: unknown) => events.push([channel, data]), on: () => () => undefined },
    appendEntry: forbidden("appendEntry"),
    sendMessage: forbidden("sendMessage"),
    sendUserMessage: forbidden("sendUserMessage"),
  };
  const ctx = {
    mode,
    hasUI: true,
    model: options.model === undefined ? model : options.model,
    isIdle: () => flags.idle,
    sessionManager: {
      buildSessionProjection: () => ({ messages: [{ role: "user", content: "fix the parser", timestamp: 1 }] }),
    },
    modelRegistry: {
      streamSimple: (usedModel: unknown, context: any, streamOptions: any) => {
        streamCalls.push({ model: usedModel, context, options: streamOptions });
        return (async function* () {
          for (const delta of options.deltas ?? ["An ", "answer."]) yield { type: "text_delta", delta };
          if (options.fail) yield { type: "error", reason: "error", error: { errorMessage: options.fail } };
          else yield { type: "done", reason: "stop", message: {} };
        })();
      },
    },
    ui: {
      setWidget: (key: string, content: unknown) => widgets.push([key, content]),
      notify: (message: string, level: string) => notes.push([level, message]),
      onTerminalInput: (handler: typeof inputHandler) => {
        inputHandler = handler;
        return () => (inputHandler = undefined);
      },
      getEditorText: () => flags.editor,
    },
  };
  btw(pi as unknown as ExtensionAPI);
  handlers.get("session_start")?.({ type: "session_start" }, ctx);
  const run = (name: string, args = "") => {
    const handler = commands.get(name);
    if (!handler) throw new Error(`no command ${name}`);
    return handler(args, ctx);
  };
  return { commands, handlers, events, widgets, notes, streamCalls, flags, run, input: () => inputHandler, ctx };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, RPC_PUBLISH_INTERVAL_MS + 30));

function rpcStates(widgets: [string, unknown][]): (BtwStateEvent | undefined)[] {
  return widgets
    .filter(([key]) => key === BTW_STATE_EVENT)
    .map(([, lines]) => (Array.isArray(lines) ? (JSON.parse(lines[0]) as BtwStateEvent) : undefined));
}

describe("btw extension", () => {
  test("registers its commands", () => {
    const { commands } = harness("rpc");
    expect([...commands.keys()]).toEqual(["btw", "btw-followup", "btw-cancel", "btw-dismiss", "btw-list", "btw-action"]);
  });

  test("/btw streams an answer from the session's model over the forked conversation, published as btw_state", async () => {
    const { run, streamCalls, widgets, events } = harness("rpc");
    await run("btw", "what does the parser do?");
    await settle();
    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0].model).toBe(model);
    expect(streamCalls[0].options.signal).toBeInstanceOf(AbortSignal);
    const asked = streamCalls[0].context.messages[0].content[0].text as string;
    expect(asked).toContain("fix the parser");
    expect(asked).toEndWith("Side question: what does the parser do?");
    const last = rpcStates(widgets).at(-1);
    expect(last).toMatchObject({ type: "btw_state", version: 1 });
    expect(last?.state.threads).toEqual([
      expect.objectContaining({ id: "btw-1", question: "what does the parser do?", answer: "An answer.", status: "done" }),
    ]);
    expect(events.every(([channel]) => channel === BTW_STATE_EVENT)).toBe(true);
    expect((events.at(-1)?.[1] as BtwStateEvent).state.threads[0].status).toBe("done");
    expect(widgets.some(([key]) => key === "btw")).toBe(false);
  });

  test("the RPC widget is throttled and cleared when the last thread is dismissed", async () => {
    const { run, widgets } = harness("rpc", { deltas: Array.from({ length: 20 }, () => "x") });
    await run("btw", "q");
    await settle();
    const sent = rpcStates(widgets);
    expect(sent.length).toBeLessThan(5);
    expect(sent.at(-1)?.state.threads[0].answer).toBe("x".repeat(20));
    await run("btw-dismiss");
    await settle();
    expect(widgets.at(-1)).toEqual([BTW_STATE_EVENT, undefined]);
  });

  test("/btw-action calls an action from JSON; /btw-list notifies and publishes at once", async () => {
    const { run, widgets, notes, streamCalls } = harness("rpc");
    await run("btw-action", JSON.stringify({ action: "btw.ask", params: { question: "first" } }));
    await settle();
    await run("btw-action", JSON.stringify({ action: "btw.ask", params: { question: "second", threadId: "btw-1" } }));
    await settle();
    expect(streamCalls[1].context.messages.map((message: any) => message.role)).toEqual(["user", "assistant", "user"]);
    const before = widgets.length;
    await run("btw-list");
    expect(widgets.length).toBe(before + 1);
    expect(notes.at(-1)).toEqual(["info", "btw-1 [done] first (+1 follow-up)"]);
  });

  test("errors become notifications", async () => {
    const noModel = harness("rpc", { model: null });
    await noModel.run("btw", "q");
    expect(noModel.notes).toEqual([["error", "btw: no model is selected"]]);
    const { run, notes } = harness("rpc", { fail: "overloaded" });
    await run("btw");
    await run("btw-cancel");
    expect(notes).toEqual([
      ["error", "btw: usage: /btw <question>"],
      ["error", "btw: no btw answer is streaming"],
    ]);
    await run("btw", "q");
    await settle();
    await run("btw-list");
    expect(notes.at(-1)).toEqual(["info", "btw-1 [error] q"]);
  });

  test("TUI: the widget renders the newest thread; Esc closes it only while the main agent is idle", async () => {
    const { run, widgets, input, flags } = harness("tui");
    await run("btw", "what is up?");
    await settle();
    const mounted = widgets.find(([key]) => key === "btw");
    expect(typeof mounted?.[1]).toBe("function");
    const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
    const tui = { requestRender: () => undefined };
    const component = (mounted?.[1] as (tui: unknown, theme: unknown) => { render(width: number): string[] })(tui, theme);
    const lines = component.render(60);
    expect(lines[0]).toStartWith("btw btw-1 done");
    expect(lines[0]).toEndWith("[x]");
    expect(lines.join("\n")).toContain("> what is up?");
    expect(lines.join("\n")).toContain("An answer.");
    expect(lines.at(-1)).toContain("Esc close");
    expect(lines.every((line) => line.length <= 60)).toBe(true);

    flags.idle = false;
    expect(input()?.("\x1b")).toBeUndefined();
    flags.idle = true;
    flags.editor = "draft";
    expect(input()?.("\x1b")).toBeUndefined();
    flags.editor = "";
    expect(input()?.("a")).toBeUndefined();
    expect(input()?.("\x1b")).toEqual({ consume: true });
    await settle();
    expect(widgets.at(-1)).toEqual(["btw", undefined]);
    expect(input()?.("\x1b")).toBeUndefined();
  });

  test("a new session drops the threads; shutdown cancels streams", async () => {
    const { run, handlers, ctx, events } = harness("rpc");
    await run("btw", "q");
    await settle();
    handlers.get("session_start")?.({ type: "session_start" }, ctx);
    expect((events.at(-1)?.[1] as BtwStateEvent).state.threads).toEqual([]);
    handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx);
  });

  test("toModelContext turns earlier answers into assistant messages of the model", () => {
    const context = toModelContext(buildCompletionContext("conv", [{ question: "a", answer: "b" }], "c", 7), model as any);
    expect(context.messages[1]).toMatchObject({ role: "assistant", provider: "prov", model: "mod", api: "openai-completions", stopReason: "stop" });
    expect(context.messages[2]).toEqual({ role: "user", content: [{ type: "text", text: "c" }], timestamp: 7 });
  });
});
