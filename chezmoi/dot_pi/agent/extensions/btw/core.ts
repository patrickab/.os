/**
 * The btw core: side questions about the current conversation as actions over plain JSON. Clients (the TUI widget in
 * `index.ts`, an RPC client such as gigachad through the `/btw-*` commands) only call `callAction` and render the
 * `BtwState` it publishes.
 *
 * - Provides `ACTIONS` (name -> summary, JSON schema of the params, whether it changes anything) and
 *   `createBtwCore({onState})` with `callAction(name, params, session)`
 * - A failure is a `BtwError` of one sentence with a code: `invalid` (the params), `not_found` (thread), `busy` (the
 *   thread is still streaming, or every history slot is), `refused` (the thread's status forbids it), `failed`
 * - A question forks the main conversation once, at `btw.ask` without `threadId`: `session.forkContext()` returns it
 *   as text, the thread keeps that text in memory (never in the state) and every follow-up sends it again. Nothing
 *   is ever written to the main session
 * - The answer streams through `session.stream` with the session's model at the time of each question
 * - Every change publishes the whole state through `onState` (a copy: clients may keep it)
 * - Imports nothing: the plain data and the completion context are built here, the model call is the caller's
 */

export type BtwStatus = "streaming" | "done" | "error" | "cancelled";

/** A question asked in an existing thread. `status`/`error` are this exchange's own. */
export interface BtwFollowUp {
  question: string;
  answer: string;
  status: BtwStatus;
  error?: string;
  createdAt: string;
}

/**
 * One side question with its follow-ups. `question`/`answer` are the first exchange; `status`/`error` are those of the
 * thread's latest exchange (the first one, or the last follow-up), so `status: "streaming"` means the thread is busy.
 */
export interface BtwThread {
  id: string;
  question: string;
  answer: string;
  status: BtwStatus;
  error?: string;
  followUps: BtwFollowUp[];
  createdAt: string;
}

/** The threads, oldest first. At most `MAX_THREADS`. */
export interface BtwState {
  threads: BtwThread[];
}

/** The one event every state change is published as (`btwStateEvent`). */
export const BTW_STATE_EVENT = "btw_state";
export const BTW_STATE_VERSION = 1;

export interface BtwStateEvent {
  type: typeof BTW_STATE_EVENT;
  version: typeof BTW_STATE_VERSION;
  state: BtwState;
}

export function btwStateEvent(state: BtwState): BtwStateEvent {
  return { type: BTW_STATE_EVENT, version: BTW_STATE_VERSION, state };
}

/** The history keeps this many threads; a new question drops the oldest one that is not streaming. */
export const MAX_THREADS = 5;

export type BtwErrorCode = "invalid" | "not_found" | "busy" | "refused" | "failed";

export class BtwError extends Error {
  readonly code: BtwErrorCode;
  constructor(code: BtwErrorCode, message: string) {
    super(message);
    this.name = "BtwError";
    this.code = code;
  }
}

/** A plain pi-ai `Context`: what `session.stream` sends to the model. */
export interface BtwCompletionContext {
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: { type: "text"; text: string }[]; timestamp: number }[];
}

/** What the core needs from the host for one action: the main conversation and the model. */
export interface BtwSession {
  /** `provider/model` of the session's current model, null when none is selected (`btw.ask` is refused then). */
  modelName(): string | null;
  /** The main conversation as text, read only. Called once per new thread. */
  forkContext(): string;
  /** Streams the answer's text deltas. Throws on a failed completion; ends early (or throws) once `signal` aborts. */
  stream(context: BtwCompletionContext, signal: AbortSignal): AsyncIterable<string>;
}

type Schema = Record<string, unknown>;

export interface ActionSpec {
  summary: string;
  params: { type: "object"; required: string[]; properties: Record<string, Schema> };
  mutates: boolean;
}

export const ACTIONS = {
  "btw.ask": {
    summary: "Ask a side question; with threadId a follow-up in that thread. Returns at once, the answer streams",
    params: {
      type: "object",
      required: ["question"],
      properties: { question: { type: "string", minLength: 1 }, threadId: { type: "string" } },
    },
    mutates: true,
  },
  "btw.cancel": {
    summary: "Stop a streaming thread; the partial answer stays, status cancelled",
    params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    mutates: true,
  },
  "btw.dismiss": {
    summary: "Remove a thread from the history (a streaming one is cancelled first)",
    params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    mutates: true,
  },
  "btw.list": {
    summary: "The current state",
    params: { type: "object", required: [], properties: {} },
    mutates: false,
  },
} as const satisfies Record<string, ActionSpec>;

export type ActionName = keyof typeof ACTIONS;

export interface AskResult {
  threadId: string;
  state: BtwState;
}

export interface StateResult {
  state: BtwState;
}

export type ActionResult<N extends ActionName> = N extends "btw.ask" ? AskResult : StateResult;

export const BTW_SYSTEM_PROMPT = [
  "You answer a quick side question (\"by the way\") about an ongoing conversation between a user and a coding agent.",
  "The conversation is context only: do not continue it, do not call tools, do not claim to take actions.",
  "Answer the question directly and concisely.",
].join("\n");

/** The model context of a question: the forked conversation and the thread's earlier exchanges, then the question. */
export function buildCompletionContext(
  conversation: string,
  earlier: { question: string; answer: string }[],
  question: string,
  now: number,
): BtwCompletionContext {
  const user = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }], timestamp: now });
  const assistant = (text: string) => ({
    role: "assistant" as const,
    content: [{ type: "text" as const, text: text || "(no answer)" }],
    timestamp: now,
  });
  const exchanges = [...earlier, { question, answer: "" }];
  const messages: BtwCompletionContext["messages"] = [];
  exchanges.forEach((exchange, index) => {
    const asked =
      index === 0 && conversation.trim() ? `<conversation>\n${conversation}\n</conversation>\n\nSide question: ${exchange.question}` : exchange.question;
    messages.push(user(asked));
    if (index < exchanges.length - 1) messages.push(assistant(exchange.answer));
  });
  return { systemPrompt: BTW_SYSTEM_PROMPT, messages };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringParam(params: Record<string, unknown>, name: string, required: boolean): string | undefined {
  const value = params[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new BtwError("invalid", `${name} must be a non-empty string`);
  return value.trim();
}

export interface BtwCoreOptions {
  onState(state: BtwState): void;
  now?: () => number;
}

export interface BtwCore {
  state(): BtwState;
  callAction<N extends ActionName>(name: N, params: unknown, session: BtwSession): Promise<ActionResult<N>>;
  callAction(name: string, params: unknown, session: BtwSession): Promise<AskResult | StateResult>;
  /** Cancels every streaming thread and empties the history (a new session). */
  reset(): void;
  /** Resolves once no thread streams. */
  idle(): Promise<void>;
}

export function createBtwCore(options: BtwCoreOptions): BtwCore {
  const now = options.now ?? Date.now;
  let threads: BtwThread[] = [];
  let counter = 0;
  /** The forked conversation of each thread, outside the state. */
  const conversations = new Map<string, string>();
  const running = new Map<string, { controller: AbortController; done: Promise<void> }>();

  const snapshot = (): BtwState => structuredClone({ threads });
  const publish = () => options.onState(snapshot());

  const find = (id: string): BtwThread => {
    const thread = threads.find((candidate) => candidate.id === id);
    if (!thread) throw new BtwError("not_found", `no btw thread ${id}`);
    return thread;
  };

  /** The exchange a streaming answer writes into: the last follow-up, else the thread itself. */
  const latest = (thread: BtwThread): BtwThread | BtwFollowUp => thread.followUps.at(-1) ?? thread;

  const settle = (thread: BtwThread, status: BtwStatus, error?: string) => {
    const exchange = latest(thread);
    exchange.status = status;
    if (error === undefined) delete exchange.error;
    else exchange.error = error;
    if (exchange !== thread) {
      thread.status = status;
      if (error === undefined) delete thread.error;
      else thread.error = error;
    }
  };

  const remove = (id: string) => {
    threads = threads.filter((thread) => thread.id !== id);
    conversations.delete(id);
  };

  const start = (thread: BtwThread, context: BtwCompletionContext, session: BtwSession) => {
    const controller = new AbortController();
    // Registered before `run` starts, so even a synchronous throw of `stream` finds its own entry to delete.
    const entry = { controller, done: Promise.resolve() };
    running.set(thread.id, entry);
    const run = async () => {
      try {
        for await (const delta of session.stream(context, controller.signal)) {
          if (controller.signal.aborted) break;
          if (!delta) continue;
          latest(thread).answer += delta;
          publish();
        }
        if (!controller.signal.aborted) settle(thread, "done");
      } catch (error) {
        if (!controller.signal.aborted) settle(thread, "error", errorText(error));
      } finally {
        // A cancelled run ends after a follow-up may have started the thread's next one: that entry is not ours.
        if (running.get(thread.id) === entry) running.delete(thread.id);
        if (threads.includes(thread)) publish();
      }
    };
    entry.done = run();
  };

  /** Settles the thread `cancelled` at once; its run stops at the next delta (or when the stream sees the abort). */
  const cancel = (thread: BtwThread) => {
    const active = running.get(thread.id);
    if (!active || thread.status !== "streaming") return;
    settle(thread, "cancelled");
    active.controller.abort();
  };

  const ask = (params: Record<string, unknown>, session: BtwSession): AskResult => {
    const question = stringParam(params, "question", true) as string;
    const threadId = stringParam(params, "threadId", false);
    if (!session.modelName()) throw new BtwError("refused", "no model is selected");
    const createdAt = new Date(now()).toISOString();
    if (threadId !== undefined) {
      const thread = find(threadId);
      if (thread.status === "streaming") throw new BtwError("busy", `btw thread ${thread.id} is still answering`);
      const earlier = [{ question: thread.question, answer: thread.answer }, ...thread.followUps];
      const context = buildCompletionContext(conversations.get(thread.id) ?? "", earlier, question, now());
      thread.followUps.push({ question, answer: "", status: "streaming", createdAt });
      thread.status = "streaming";
      delete thread.error;
      start(thread, context, session);
      publish();
      return { threadId: thread.id, state: snapshot() };
    }
    if (threads.length >= MAX_THREADS) {
      const oldest = threads.find((thread) => thread.status !== "streaming");
      if (!oldest) throw new BtwError("busy", `all ${MAX_THREADS} btw threads are still answering`);
      remove(oldest.id);
    }
    let conversation: string;
    try {
      conversation = session.forkContext();
    } catch (error) {
      throw new BtwError("failed", `could not read the conversation: ${errorText(error)}`);
    }
    counter += 1;
    const thread: BtwThread = { id: `btw-${counter}`, question, answer: "", status: "streaming", followUps: [], createdAt };
    threads.push(thread);
    conversations.set(thread.id, conversation);
    start(thread, buildCompletionContext(conversation, [], question, now()), session);
    publish();
    return { threadId: thread.id, state: snapshot() };
  };

  async function callAction(name: string, params: unknown, session: BtwSession): Promise<AskResult | StateResult> {
    if (!Object.hasOwn(ACTIONS, name)) throw new BtwError("invalid", `unknown btw action ${name}`);
    const input = params ?? {};
    if (!isRecord(input)) throw new BtwError("invalid", "params must be an object");
    switch (name as ActionName) {
      case "btw.ask":
        return ask(input, session);
      case "btw.cancel": {
        const thread = find(stringParam(input, "id", true) as string);
        if (thread.status !== "streaming") throw new BtwError("refused", `btw thread ${thread.id} is not answering`);
        cancel(thread);
        publish();
        return { state: snapshot() };
      }
      case "btw.dismiss": {
        const thread = find(stringParam(input, "id", true) as string);
        cancel(thread);
        remove(thread.id);
        publish();
        return { state: snapshot() };
      }
      case "btw.list":
        return { state: snapshot() };
    }
  }

  return {
    state: snapshot,
    callAction: callAction as BtwCore["callAction"],
    reset() {
      for (const thread of threads) cancel(thread);
      threads = [];
      conversations.clear();
      publish();
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running.values()].map((entry) => entry.done));
    },
  };
}

/** A parsed command: the action to call, or a usage error to show. */
export type CommandCall = { name: ActionName; params: Record<string, unknown> } | { error: string };

export const COMMANDS = {
  btw: { usage: "/btw <question>", summary: "Ask a side question about this conversation; the main run goes on" },
  "btw-followup": {
    usage: "/btw-followup [id] <question>",
    summary: "Ask a follow-up in a btw thread (default: the newest)",
  },
  "btw-cancel": { usage: "/btw-cancel [id]", summary: "Stop a streaming btw answer (default: the newest streaming)" },
  "btw-dismiss": { usage: "/btw-dismiss [id]", summary: "Close a btw thread (default: the newest)" },
  "btw-list": { usage: "/btw-list", summary: "Show the btw threads and publish the state again" },
  "btw-action": {
    usage: "/btw-action {\"action\": \"btw.ask\", \"params\": {...}}",
    summary: "Call any btw action with JSON params (for RPC clients)",
  },
} as const;

export type CommandName = keyof typeof COMMANDS;

/** Maps a `/btw*` command and its argument text to an action; ids default as `COMMANDS` describes. */
export function commandCall(command: CommandName, args: string, state: BtwState): CommandCall {
  const text = args.trim();
  const newest = state.threads.at(-1);
  const usage = { error: `usage: ${COMMANDS[command].usage}` };
  switch (command) {
    case "btw":
      return text ? { name: "btw.ask", params: { question: text } } : usage;
    case "btw-followup": {
      const [first = ""] = text.split(/\s+/, 1);
      const named = state.threads.find((thread) => thread.id === first);
      const question = named ? text.slice(first.length).trim() : text;
      const threadId = named?.id ?? newest?.id;
      if (!question) return usage;
      if (!threadId) return { error: "there is no btw thread to follow up; ask with /btw <question>" };
      return { name: "btw.ask", params: { question, threadId } };
    }
    case "btw-cancel": {
      const id = text || state.threads.findLast((thread) => thread.status === "streaming")?.id;
      return id ? { name: "btw.cancel", params: { id } } : { error: "no btw answer is streaming" };
    }
    case "btw-dismiss": {
      const id = text || newest?.id;
      return id ? { name: "btw.dismiss", params: { id } } : { error: "there is no btw thread" };
    }
    case "btw-list":
      return { name: "btw.list", params: {} };
    case "btw-action": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return usage;
      }
      if (!isRecord(parsed) || typeof parsed.action !== "string" || !Object.hasOwn(ACTIONS, parsed.action)) {
        return { error: `unknown btw action; one of ${Object.keys(ACTIONS).join(", ")}` };
      }
      const params = parsed.params ?? {};
      if (!isRecord(params)) return { error: "params must be an object" };
      return { name: parsed.action as ActionName, params };
    }
  }
}

/** What Esc does in the TUI: cancel the newest thread while it streams, else dismiss it. Null without a thread. */
export function escapeCall(state: BtwState): { name: "btw.cancel" | "btw.dismiss"; params: { id: string } } | null {
  const newest = state.threads.at(-1);
  if (!newest) return null;
  return { name: newest.status === "streaming" ? "btw.cancel" : "btw.dismiss", params: { id: newest.id } };
}

/** One line per thread for `/btw-list`. */
export function listLines(state: BtwState): string[] {
  if (state.threads.length === 0) return ["no btw threads"];
  return state.threads.map((thread) => {
    const more = thread.followUps.length ? ` (+${thread.followUps.length} follow-up${thread.followUps.length > 1 ? "s" : ""})` : "";
    return `${thread.id} [${thread.status}] ${thread.question}${more}`;
  });
}
