# Pi btw plugin

`/btw <question>` asks a side question about the current conversation without disturbing the main run. The answer
comes from the session's current model through a separate completion, streams into a widget, can be cancelled, and
can be followed up in the same thread. Nothing is written to the main session: no entry, no message, no context.

## How a question is answered

- At `/btw` the main conversation is forked once: the compaction-aware projection of the current branch
  (`ctx.sessionManager.buildSessionProjection()`), converted with `convertToLlm` and serialized as text with
  `serializeConversation`. The thread keeps that text in memory; its follow-ups send the same text again, so later
  turns of the main run do not show up in an open thread (ask a new `/btw` for that)
- The completion is `ctx.modelRegistry.streamSimple(ctx.model, context, {signal})`: a btw system prompt (context only,
  no tools, answer concisely), one user message `<conversation>…</conversation>\n\nSide question: <q>`, then the thread's
  earlier exchanges as user/assistant messages and the follow-up question. The model is the session's at the time of
  each question; no tools are sent
- Extension commands run at once even while the agent streams, and `/btw` returns as soon as the thread exists, so the
  main run is never waited on or interrupted
- A new or switched session starts with no threads; shutdown cancels every stream

## The core (`core.ts`)

- `ACTIONS` (name -> `{summary, params (JSON schema), mutates}`) and `createBtwCore({onState})` with
  `callAction(name, params, session)`, plain JSON in and out. A failure throws `BtwError(code, message)`, one sentence,
  `code` one of `invalid`, `not_found`, `busy`, `refused`, `failed`. It imports nothing
- `session` is the host side (`hostSession(ctx)` in `index.ts`): `modelName()`, `forkContext()` (read only),
  `stream(context, signal)` (text deltas)
- Actions:
  - `btw.ask {question, threadId?}` -> `{threadId, state}`. Without `threadId` a new thread `btw-<n>`; with it a
    follow-up in that thread. Returns at once, the answer streams. `refused` without a model, `busy` for a follow-up on a
    thread that is still streaming, `not_found` for an unknown thread. The history keeps `MAX_THREADS` (5) threads: a
    new question drops the oldest one that is not streaming, `busy` when all stream
  - `btw.cancel {id}` -> `{state}`: the thread ends `cancelled` at once, its partial answer stays. `refused` when it is not
    streaming
  - `btw.dismiss {id}` -> `{state}`: removes the thread (a streaming one is cancelled first)
  - `btw.list {}` -> `{state}`
- Pure helpers the clients use instead of logic of their own: `commandCall` (a command and its text -> an action),
  `escapeCall` (what Esc does), `listLines`, `btwStateEvent`

## State

```ts
interface BtwState { threads: BtwThread[] }            // oldest first, at most 5
interface BtwThread {
  id: string;                                          // "btw-1", "btw-2", ... per Pi process
  question: string; answer: string;                    // the first exchange
  status: "streaming" | "done" | "error" | "cancelled"; // of the thread's latest exchange (first one or last follow-up)
  error?: string;                                      // of the latest exchange, when status is "error"
  followUps: { question: string; answer: string; status: BtwThread["status"]; error?: string; createdAt: string }[];
  createdAt: string;                                   // ISO time
}
```

A thread with `status: "streaming"` is busy: its latest exchange (the last follow-up, else the thread itself) is growing.

## Commands

- `/btw <question>`: `btw.ask {question}`
- `/btw-followup [id] <question>`: `btw.ask {question, threadId}`; the first word is the id when it names a thread, else
  the newest thread
- `/btw-cancel [id]`: `btw.cancel`, default the newest streaming thread
- `/btw-dismiss [id]`: `btw.dismiss`, default the newest thread
- `/btw-list`: `btw.list`; notifies one line per thread and publishes the state again at once
- `/btw-action <json>`: `{"action": "<ACTIONS name>", "params": {...}}`, any action with explicit params
- Errors are notifications (`notify`, level `error`, text `btw: <message>`)

## TUI

- The widget `btw` above the editor shows the newest thread: a header `btw <id> <status>` with `[x]` at its right, the
  questions (`> …`) and answers (Markdown), errors, and a hint line. The body shows its last 16 lines, so a streaming
  answer scrolls
- Esc cancels the newest thread while it streams, else closes (dismisses) it; only while the main agent is idle and the
  editor is empty, so Esc still aborts a main run. Otherwise use `/btw-cancel`, `/btw-dismiss`
- In fullscreen mode a left click on `[x]` does what Esc does. Dismissing the newest thread shows the next older one

## Contract with gigachad

A client in RPC mode (`pi --mode rpc`) renders the state and calls the actions through Pi's RPC protocol only.

**State: the `btw_state` event.** Every state change is published as

```json
{"type": "btw_state", "version": 1, "state": {"threads": [ /* BtwThread, see State */ ]}}
```

- In RPC mode it arrives as an extension UI widget record whose `widgetKey` is `btw_state` and whose `widgetLines` is
  one line, that event as JSON (a widget is fire-and-forget UI, never part of the session or the LLM context):

  ```json
  {"type": "extension_ui_request", "id": "…", "method": "setWidget", "widgetKey": "btw_state",
   "widgetLines": ["{\"type\":\"btw_state\",\"version\":1,\"state\":{\"threads\":[…]}}"]}
  ```

- A record without `widgetLines` (the widget cleared) means `{"threads": []}`
- Each record is the whole state: replace, do not merge. While an answer streams, records come at most every 100 ms
  (`RPC_PUBLISH_INTERVAL_MS`); the last state always follows. Do not show the `btw_state` widget as text
- To get the current state (after attaching, or to resync) send `/btw-list`: it publishes the state at once
- Extensions in the same Pi process get the same event object on `pi.events`, channel `btw_state`

**Actions: commands through `prompt`.** Extension commands run at once, also while the agent streams, and answer with
`disposition: "handled"`; no `streamingBehavior` is needed:

```json
{"id": "q1", "type": "prompt", "message": "/btw what does parseConfig return?"}
{"id": "q2", "type": "prompt", "message": "/btw-action {\"action\":\"btw.ask\",\"params\":{\"question\":\"and on error?\",\"threadId\":\"btw-1\"}}"}
{"id": "q3", "type": "prompt", "message": "/btw-cancel btw-1"}
{"id": "q4", "type": "prompt", "message": "/btw-dismiss btw-1"}
```

- `/btw-action` takes any action with explicit params; the other commands are shorthands (see Commands)
- Results come only as `btw_state` records; a failure comes as a `notify` extension UI request with
  `notifyType: "error"` and `message` `btw: <message>`
- `get_commands` lists the commands (`source: "extension"`)

## Development

- `bun install`, then `bun run types` and `bun test` in this directory. Tests use a fake `pi`, `ctx` and model stream;
  no model is called. The fake `pi` throws on `appendEntry`, `sendMessage` and `sendUserMessage`
