import { describe, expect, test } from "bun:test";
import { COMMIT_BODY_MAX_CHARS, COMMIT_BODY_MAX_LINES, commitMessageFallback, commitText, isConventionalTitle, parseCommitMessage } from "./commitmsg.ts";
import { commitAnswerDrafts, runRound, type PipelineSteps } from "./pipeline.ts";
import type { Snapshot } from "./state.ts";

describe("commit message", () => {
  test("a conventional title is recognised, scope and ! included", () => {
    expect(isConventionalTitle("feat(api)!: drop v1")).toBe(true);
    expect(isConventionalTitle("fix: x")).toBe(true);
    expect(isConventionalTitle("Add a file")).toBe(false);
    expect(isConventionalTitle("feature: x")).toBe(false);
  });

  test("a valid answer: title, blank line, bullets; a code fence around it is dropped", () => {
    expect(parseCommitMessage("feat(ui): add a button\n\n- adds the button\n- wires it")).toEqual({ title: "feat(ui): add a button", body: "- adds the button\n- wires it" });
    expect(parseCommitMessage("```\nfix: a\n\n- b\n```")).toEqual({ title: "fix: a", body: "- b" });
  });

  test("an invalid answer is null", () => {
    expect(parseCommitMessage("Add a button\n\n- x")).toBeNull();
    expect(parseCommitMessage(`feat: ${"x".repeat(70)}\n\n- x`)).toBeNull();
    expect(parseCommitMessage("feat: a\n- x")).toBeNull();
    expect(parseCommitMessage("feat: a\n\nprose")).toBeNull();
    expect(parseCommitMessage("feat: a")).toBeNull();
    expect(parseCommitMessage("")).toBeNull();
  });

  test("a body over the limits, or a control character, is null: the message goes to git as one argument", () => {
    const bullets = (count: number, chars = 10) => Array.from({ length: count }, () => `- ${"x".repeat(chars)}`).join("\n");
    expect(parseCommitMessage(`feat: a\n\n${bullets(COMMIT_BODY_MAX_LINES)}`)).not.toBeNull();
    expect(parseCommitMessage(`feat: a\n\n${bullets(COMMIT_BODY_MAX_LINES + 1)}`)).toBeNull();
    expect(parseCommitMessage(`feat: a\n\n${bullets(2, COMMIT_BODY_MAX_CHARS)}`)).toBeNull();
    expect(parseCommitMessage(`feat: a\n\n- ${"y".repeat(200_000)}`)).toBeNull();
    expect(parseCommitMessage("feat: a\n\n- b\u0000c")).toBeNull();
    expect(parseCommitMessage("feat: a\u001b[31m\n\n- b")).toBeNull();
    expect(parseCommitMessage("feat: a\n\n- b\rc")).toBeNull();
  });

  test("the fallback is the task title, and the text joins title and body", () => {
    expect(commitMessageFallback("Add a button")).toEqual({ title: "Add a button", body: "" });
    expect(commitText({ title: "Add a button", body: "" })).toBe("Add a button");
    expect(commitText({ title: "fix: a", body: "- b" })).toBe("fix: a\n\n- b");
  });
});

const snapshot = (title: string): Snapshot => ({
  task: { title, request: "r", settings: { branch: "main", merge: "auto", maxRounds: 3, review: false, models: {} }, branch: "task", mainBranch: "main", baseSha: "abc" },
  state: "running",
  round: 1,
  runFirstRound: 1,
  reason: "start",
  mergeIntent: null,
  mergeError: null,
  mergedCommit: null,
  commitMessage: null,
});

const steps = (ask: boolean): PipelineSteps => ({
  status: () => undefined,
  cancelled: () => false,
  pendingMessages: () => false,
  config: () => ({ hooks: { after_create: [], after_code: [], after_merge: [] }, gates: [], merge_gates: [], protected: [], lockfiles: [] }),
  runCommand: async () => ({ exitCode: 0, killed: false, timedOut: false, durationMs: 1, stdout: "", stdoutTruncated: false, output: "" }),
  diff: async () => ({ base: "b", paths: ["a"], patch: "p" }),
  review: async () => {
    throw new Error("no review");
  },
  merge: async () => {
    throw new Error("no merge");
  },
  openRebase: async () => null,
  askCommitMessage: () => ask,
});

describe("the commit message ask in a round", () => {
  test("a passed round asks before it ends merging; the answer gives the message and the state", async () => {
    const asked = await runRound(snapshot("Add a"), steps(true));
    expect(asked.continue).toBe(true);
    expect(asked.commitAsk).toBe("merging");
    expect(asked.entries.at(-1)).toMatchObject({ type: "custom_message", customType: "factory-commit-ask" });
    const answered = commitAnswerDrafts(snapshot("Add a"), "feat: add a\n\n- adds a", "merging", false);
    expect(answered).toEqual({
      entries: [
        { type: "custom", customType: "factory-commit-message", data: { title: "feat: add a", body: "- adds a" } },
        { type: "custom", customType: "factory-state", data: { state: "merging", round: 1, reason: "passed" } },
      ],
      continue: false,
    });
  });

  test("an invalid answer falls back to the task title", () => {
    const answered = commitAnswerDrafts(snapshot("Add a"), "sure, here it is", "waiting_approve", false);
    expect(answered.entries[0]).toMatchObject({ data: { title: "Add a", body: "" } });
    expect(answered.entries[1]).toMatchObject({ data: { state: "waiting_approve" } });
  });

  test("no ask: the round ends merging at once", async () => {
    const result = await runRound(snapshot("feat: a"), steps(false));
    expect(result.continue).toBe(false);
    expect(result.commitAsk).toBeUndefined();
  });
});
