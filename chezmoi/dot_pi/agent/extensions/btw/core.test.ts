/** The btw core against a fake session whose streams the test feeds delta by delta. No model is called. */
import { describe, expect, test } from "bun:test";
import {
  ACTIONS,
  BTW_STATE_EVENT,
  BtwError,
  btwStateEvent,
  buildCompletionContext,
  commandCall,
  createBtwCore,
  escapeCall,
  listLines,
  MAX_THREADS,
  type BtwCompletionContext,
  type BtwSession,
  type BtwState,
} from "./core.ts";

/** One stream the core opened: the test pushes deltas, ends or fails it. */
class FakeStream {
  readonly context: BtwCompletionContext;
  readonly signal: AbortSignal;
  private queue: string[] = [];
  private finished = false;
  private failure: Error | undefined;
  private wake: (() => void) | undefined;
  constructor(context: BtwCompletionContext, signal: AbortSignal) {
    this.context = context;
    this.signal = signal;
    signal.addEventListener("abort", () => this.poke());
  }
  push(...deltas: string[]) {
    this.queue.push(...deltas);
    this.poke();
  }
  end() {
    this.finished = true;
    this.poke();
  }
  fail(message: string) {
    this.failure = new Error(message);
    this.poke();
  }
  private poke() {
    this.wake?.();
    this.wake = undefined;
  }
  async *iterate(): AsyncIterable<string> {
    while (true) {
      if (this.queue.length) {
        yield this.queue.shift() as string;
        continue;
      }
      if (this.failure) throw this.failure;
      if (this.finished || this.signal.aborted) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }
}

function fakeSession(conversation = "User: hi\n\nAssistant: hello", model: string | null = "test/model") {
  const streams: FakeStream[] = [];
  let forks = 0;
  const session: BtwSession = {
    modelName: () => model,
    forkContext: () => {
      forks += 1;
      return conversation;
    },
    stream: (context, signal) => {
      const stream = new FakeStream(context, signal);
      streams.push(stream);
      return stream.iterate();
    },
  };
  return { session, streams, forks: () => forks };
}

function setup() {
  const published: BtwState[] = [];
  const core = createBtwCore({ onState: (state) => published.push(state), now: () => Date.UTC(2025, 0, 1) });
  return { core, published, ...fakeSession() };
}

/** Lets the core's stream loops take what was pushed. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function rejection(promise: Promise<unknown>): Promise<BtwError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BtwError) return error;
    throw error;
  }
  throw new Error("expected a BtwError");
}

describe("btw.ask", () => {
  test("streams the answer into a new thread and ends done", async () => {
    const { core, published, session, streams, forks } = setup();
    const { threadId, state } = await core.callAction("btw.ask", { question: " what is X? " }, session);
    expect(threadId).toBe("btw-1");
    expect(state.threads).toEqual([
      { id: "btw-1", question: "what is X?", answer: "", status: "streaming", followUps: [], createdAt: "2025-01-01T00:00:00.000Z" },
    ]);
    expect(forks()).toBe(1);
    streams[0].push("X is ", "a thing.");
    await tick();
    expect(core.state().threads[0].answer).toBe("X is a thing.");
    streams[0].end();
    await core.idle();
    expect(core.state().threads[0]).toMatchObject({ status: "done", answer: "X is a thing." });
    expect(published.at(-1)?.threads[0].status).toBe("done");
    expect(published.map((state) => state.threads[0]?.answer)).toContain("X is ");
  });

  test("sends the forked conversation with the question", async () => {
    const { core, session, streams } = setup();
    await core.callAction("btw.ask", { question: "why?" }, session);
    expect(streams[0].context.messages).toHaveLength(1);
    expect(streams[0].context.messages[0].content[0].text).toBe(
      "<conversation>\nUser: hi\n\nAssistant: hello\n</conversation>\n\nSide question: why?",
    );
  });

  test("a failed completion ends the thread error with its message, keeping the partial answer", async () => {
    const { core, session, streams } = setup();
    await core.callAction("btw.ask", { question: "q" }, session);
    streams[0].push("part");
    streams[0].fail("rate limited");
    await core.idle();
    expect(core.state().threads[0]).toMatchObject({ status: "error", error: "rate limited", answer: "part" });
  });

  test("a stream that throws at once ends the thread error", async () => {
    const { core } = setup();
    const session: BtwSession = {
      modelName: () => "m",
      forkContext: () => "",
      stream: () => {
        throw new Error("no auth");
      },
    };
    await core.callAction("btw.ask", { question: "q" }, session);
    await core.idle();
    expect(core.state().threads[0]).toMatchObject({ status: "error", error: "no auth" });
  });

  test("refuses without a model, and rejects bad params", async () => {
    const { core } = setup();
    expect((await rejection(core.callAction("btw.ask", { question: "q" }, fakeSession("", null).session))).code).toBe("refused");
    const { session } = fakeSession();
    expect((await rejection(core.callAction("btw.ask", { question: "  " }, session))).code).toBe("invalid");
    expect((await rejection(core.callAction("btw.ask", "q", session))).code).toBe("invalid");
    expect((await rejection(core.callAction("btw.nope", {}, session))).code).toBe("invalid");
    expect((await rejection(core.callAction("btw.ask", { question: "q", threadId: "btw-9" }, session))).code).toBe("not_found");
    expect(core.state().threads).toEqual([]);
  });

  test("a follow-up reuses the thread's forked conversation and earlier exchange", async () => {
    const { core, session, streams, forks } = setup();
    await core.callAction("btw.ask", { question: "first?" }, session);
    streams[0].push("one");
    streams[0].end();
    await core.idle();
    const { threadId } = await core.callAction("btw.ask", { question: "second?", threadId: "btw-1" }, session);
    expect(threadId).toBe("btw-1");
    expect(forks()).toBe(1);
    expect(streams[1].context.messages.map((message) => [message.role, message.content[0].text])).toEqual([
      ["user", "<conversation>\nUser: hi\n\nAssistant: hello\n</conversation>\n\nSide question: first?"],
      ["assistant", "one"],
      ["user", "second?"],
    ]);
    expect(core.state().threads[0]).toMatchObject({ status: "streaming", answer: "one" });
    streams[1].push("two");
    streams[1].end();
    await core.idle();
    const thread = core.state().threads[0];
    expect(thread.status).toBe("done");
    expect(thread.followUps).toEqual([{ question: "second?", answer: "two", status: "done", createdAt: "2025-01-01T00:00:00.000Z" }]);
  });

  test("a follow-up waits for the thread's answer: busy while streaming", async () => {
    const { core, session } = setup();
    await core.callAction("btw.ask", { question: "q" }, session);
    expect((await rejection(core.callAction("btw.ask", { question: "more", threadId: "btw-1" }, session))).code).toBe("busy");
  });

  test(`keeps ${MAX_THREADS} threads, dropping the oldest finished one; busy when all stream`, async () => {
    const { core, session, streams } = setup();
    for (let index = 0; index < MAX_THREADS; index += 1) await core.callAction("btw.ask", { question: `q${index}` }, session);
    expect((await rejection(core.callAction("btw.ask", { question: "one too many" }, session))).code).toBe("busy");
    streams[1].end();
    await tick();
    await core.callAction("btw.ask", { question: "next" }, session);
    expect(core.state().threads.map((thread) => thread.id)).toEqual(["btw-1", "btw-3", "btw-4", "btw-5", "btw-6"]);
  });

  test("published states are copies", async () => {
    const { core, published, session } = setup();
    await core.callAction("btw.ask", { question: "q" }, session);
    published[0].threads[0].question = "changed";
    expect(core.state().threads[0].question).toBe("q");
  });
});

describe("btw.cancel and btw.dismiss", () => {
  test("cancel keeps the partial answer and ignores later deltas", async () => {
    const { core, session, streams } = setup();
    await core.callAction("btw.ask", { question: "q" }, session);
    streams[0].push("partial");
    await tick();
    const { state } = await core.callAction("btw.cancel", { id: "btw-1" }, session);
    expect(state.threads[0]).toMatchObject({ status: "cancelled", answer: "partial" });
    expect(streams[0].signal.aborted).toBe(true);
    streams[0].push(" more");
    await core.idle();
    expect(core.state().threads[0]).toMatchObject({ status: "cancelled", answer: "partial" });
    expect((await rejection(core.callAction("btw.cancel", { id: "btw-1" }, session))).code).toBe("refused");
    expect((await rejection(core.callAction("btw.cancel", { id: "btw-7" }, session))).code).toBe("not_found");
  });

  test("a follow-up right after a cancel is not ended by the cancelled run", async () => {
    const { core, session, streams } = setup();
    await core.callAction("btw.ask", { question: "q" }, session);
    await core.callAction("btw.cancel", { id: "btw-1" }, session);
    await core.callAction("btw.ask", { question: "again", threadId: "btw-1" }, session);
    await tick();
    expect(core.state().threads[0].status).toBe("streaming");
    streams[1].push("yes");
    streams[1].end();
    await core.idle();
    expect(core.state().threads[0]).toMatchObject({ status: "done", followUps: [{ answer: "yes", status: "done" }] });
  });

  test("dismiss cancels a streaming thread and removes it", async () => {
    const { core, session, streams } = setup();
    await core.callAction("btw.ask", { question: "q" }, session);
    const { state } = await core.callAction("btw.dismiss", { id: "btw-1" }, session);
    expect(state.threads).toEqual([]);
    expect(streams[0].signal.aborted).toBe(true);
    await core.idle();
    expect(core.state().threads).toEqual([]);
    expect((await rejection(core.callAction("btw.dismiss", { id: "btw-1" }, session))).code).toBe("not_found");
  });

  test("btw.list returns the state; reset cancels and empties it", async () => {
    const { core, session, streams } = setup();
    await core.callAction("btw.ask", { question: "q" }, session);
    expect((await core.callAction("btw.list", {}, session)).state.threads).toHaveLength(1);
    core.reset();
    expect(streams[0].signal.aborted).toBe(true);
    expect(core.state()).toEqual({ threads: [] });
    await core.idle();
  });
});

describe("plain helpers", () => {
  test("ACTIONS lists the four actions", () => {
    expect(Object.keys(ACTIONS)).toEqual(["btw.ask", "btw.cancel", "btw.dismiss", "btw.list"]);
  });

  test("the btw_state event wraps the state", () => {
    expect(btwStateEvent({ threads: [] })).toEqual({ type: BTW_STATE_EVENT, version: 1, state: { threads: [] } });
  });

  test("buildCompletionContext leaves out an empty conversation and fills empty answers", () => {
    const context = buildCompletionContext(" ", [{ question: "a", answer: "" }], "b", 5);
    expect(context.messages.map((message) => message.content[0].text)).toEqual(["a", "(no answer)", "b"]);
  });

  const thread = (id: string, status: "streaming" | "done") => ({ id, question: "q", answer: "", status, followUps: [], createdAt: "" });
  const state: BtwState = { threads: [thread("btw-1", "streaming"), thread("btw-2", "done")] };

  test("commandCall maps commands to actions with default ids", () => {
    expect(commandCall("btw", " hi ", state)).toEqual({ name: "btw.ask", params: { question: "hi" } });
    expect(commandCall("btw", "", state)).toEqual({ error: "usage: /btw <question>" });
    expect(commandCall("btw-followup", "and then?", state)).toEqual({ name: "btw.ask", params: { question: "and then?", threadId: "btw-2" } });
    expect(commandCall("btw-followup", "btw-1 and then?", state)).toEqual({ name: "btw.ask", params: { question: "and then?", threadId: "btw-1" } });
    expect(commandCall("btw-followup", "q", { threads: [] })).toHaveProperty("error");
    expect(commandCall("btw-cancel", "", state)).toEqual({ name: "btw.cancel", params: { id: "btw-1" } });
    expect(commandCall("btw-cancel", "", { threads: [thread("btw-2", "done")] })).toEqual({ error: "no btw answer is streaming" });
    expect(commandCall("btw-dismiss", "", state)).toEqual({ name: "btw.dismiss", params: { id: "btw-2" } });
    expect(commandCall("btw-dismiss", "btw-1", state)).toEqual({ name: "btw.dismiss", params: { id: "btw-1" } });
    expect(commandCall("btw-list", "", state)).toEqual({ name: "btw.list", params: {} });
    expect(commandCall("btw-action", '{"action":"btw.ask","params":{"question":"x","threadId":"btw-1"}}', state)).toEqual({
      name: "btw.ask",
      params: { question: "x", threadId: "btw-1" },
    });
    expect(commandCall("btw-action", '{"action":"btw.list"}', state)).toEqual({ name: "btw.list", params: {} });
    expect(commandCall("btw-action", "not json", state)).toHaveProperty("error");
    expect(commandCall("btw-action", '{"action":"rm"}', state)).toHaveProperty("error");
  });

  test("escapeCall cancels a streaming newest thread, else dismisses it", () => {
    expect(escapeCall(state)).toEqual({ name: "btw.dismiss", params: { id: "btw-2" } });
    expect(escapeCall({ threads: [thread("btw-1", "streaming")] })).toEqual({ name: "btw.cancel", params: { id: "btw-1" } });
    expect(escapeCall({ threads: [] })).toBeNull();
  });

  test("listLines", () => {
    expect(listLines({ threads: [] })).toEqual(["no btw threads"]);
    expect(listLines(state)).toEqual(["btw-1 [streaming] q", "btw-2 [done] q"]);
  });
});
