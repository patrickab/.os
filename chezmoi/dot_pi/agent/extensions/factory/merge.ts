/**
 * The merge step of a passed task.
 *
 * - Consumes the task, the repo's `FactoryConfig` and two `Exec`s: `exec` is killed by a cancel, `cleanup` is not
 * - Commit, rebase onto the target branch, gates again (`merge_gates`, skipped when the rebase moved nothing), then
 *   under the merge lock (a cancel ends the wait for it, never the update): a target checked out in a worktree (the
 *   primary or another one) is fast-forwarded there, and `hooks.after_merge` run when that is the primary and the
 *   merge changed a lockfile (`config.lockfiles`); a target checked out nowhere is moved with a compare-and-swap
 *   `update-ref`, no hooks
 * - A conflicting rebase is aborted and reported with its files (`MergeResult` `conflict`), not as a failure. A merge
 *   gate that fails on the rebased branch is reported with its command (`MergeResult` `gate_failed`): the rebase stays,
 *   so the coder fixes the change on top of the target branch
 * - Provides `rebaseWorktree`, which a run that opens uses to bring the task branch up to date the same way. It
 *   squashes the task branch onto its base first (`taskBase`): the rebase replays one commit, the task's net change.
 *   A merge request's branch is never committed to nor squashed: the rebase replays its commits and the target gets
 *   every one of them and nothing else
 * - The factory's own commits run no commit hooks and are not signed (`--no-verify --no-gpg-sign`)
 * - Reports the step that cannot be undone (`intent`) right before it, so a resume can tell whether it happened
 * - Provides `mergeTask`: the `MergeResult` and the `factory-gate` data of the commands it ran. It never throws, a
 *   failure is a `failed` result whose `factory-merge` data is `ok: false` with the reason
 * - The merge commit carries `MergeInput.message` (default: the task title)
 */
import { basename, join } from "node:path";
import { commitMessageFallback, commitText, type CommitMessage } from "./commitmsg.ts";
import type { FactoryConfig } from "./config.ts";
import { addAllArgs, assertCheckoutReady, git, nulList, primaryCheckout, rebaseInProgress, targetMoved, taskBase } from "./git.ts";
import { joinQueue, leaveQueue, queueAhead } from "./queue.ts";
import type { CommandResult, Exec } from "./run.ts";
import { gateData, isMergeRequest, passed, type GateData, type MergeData, type MergeIntentData, type Task } from "./state.ts";
import { ERROR_TAIL_CHARS, errorText, outputTail } from "./util.ts";

/** How long a merge waits for the merge lock, polling once a second. */
const LOCK_WAIT_MS = 60_000;
/** `flock -n -E` exit code of a lock someone else holds. */
const LOCK_BUSY_EXIT = 75;
const AFTER_MERGE_TIMEOUT_MS = 10 * 60_000;
/** How often a queued merge looks whether it is its turn, or the target moved. */
const QUEUE_POLL_MS = 2_000;
/** Exit code of `MOVE_TARGET_SCRIPT` when the main branch moved past the task's base: rebase again and retry. */
const TARGET_MOVED_EXIT = 4;
/** How often a merge rebases again after the main branch moved during its merge gates. */
export const MERGE_ATTEMPTS = 3;
/**
 * Moves the main branch to the task's commit in one lock holder: `$1` primary, `$2` main branch, `$3` task branch,
 * `$4` the task's commit, `$5` the main branch's commit as the merge read it. A main branch that is no longer an
 * ancestor of the task's commit (another merge landed meanwhile) exits `TARGET_MOVED_EXIT`, nothing moved. Checked
 * out in a worktree (the primary or another one, by `git worktree list`): fast-forward there. Else compare-and-swap of
 * the ref. Prints the commit before and `primary`, `checkout` (another worktree) or `ref`.
 */
const MOVE_TARGET_SCRIPT =
  `git -C "$1" merge-base --is-ancestor "refs/heads/$2" "$4" || { echo "$2 moved past the task's base" >&2; exit ${TARGET_MOVED_EXIT}; }; ` +
  'list=$(git -C "$1" worktree list --porcelain) || exit; ' +
  'where=$(printf "%s\\n" "$list" | awk -v ref="branch refs/heads/$2" ' +
  "'/^worktree /{path=substr($0,10);n++} $0==ref{print (n==1?\"primary\":\"checkout\") \" \" path; exit}'); " +
  'if test -n "$where"; then kind=${where%% *}; dir=${where#* }; ' +
  'before=$(git -C "$dir" rev-parse HEAD) && git -C "$dir" merge --ff-only "$3" >&2 && echo "$before $kind"; exit; fi; ' +
  'git -C "$1" merge-base --is-ancestor "$5" "$4" || { echo "$4 does not descend from $5" >&2; exit 3; }; ' +
  'git -C "$1" update-ref -m "factory: merge $3" "refs/heads/$2" "$4" "$5" >&2 && echo "$5 ref"';

export interface MergeInput {
  exec: Exec;
  /** Runs what a cancel must not stop or prevent. */
  cleanup: Exec;
  root: string;
  round: number;
  task: Task;
  config: FactoryConfig;
  /** Called with the intent right before the merge's irreversible step. */
  intent: (data: MergeIntentData) => void;
  /** Called with what the merge does next. */
  status?: (text: string) => void;
  /** The merge commit's message. Default: the task title. */
  message?: CommitMessage;
}

export type GateFailure = { argv: string[]; result: CommandResult };

/**
 * How a merge ended. `merged`: the main branch is at the task's commit (`merge.ok`). `failed`: nothing was merged, the
 * `factory-merge` data says why. `conflict`: the rebase onto the main branch conflicted on `files` and was aborted.
 * `gate_failed`: a merge gate failed on the rebased branch. Nothing was merged after a `conflict` or a `gate_failed`.
 */
export type MergeResult =
  | { kind: "merged"; merge: MergeData }
  | { kind: "failed"; merge: MergeData }
  | { kind: "conflict"; files: string[] }
  | { kind: "gate_failed"; gate: GateFailure };

export interface MergeOutcome {
  gates: GateData[];
  result: MergeResult;
}

/**
 * Brings the task branch up to date: commits the worktree as `commitWorktree` does and squashes the branch onto its
 * base (neither for a merge request), then rebases it onto the target branch. A conflicting rebase is aborted with `cleanup` and its conflicting files
 * returned, else null. Any other failure throws. `--autostash` carries what the commit leaves out (protected paths)
 * over the rebase.
 */
export async function rebaseWorktree(exec: Exec, cleanup: Exec, root: string, task: Task, protectedGlobs: string[], message = task.title): Promise<string[] | null> {
  if (!isMergeRequest(task)) {
    await commitWorktree(exec, root, message, protectedGlobs);
    await squashOntoBase(exec, root, task, message);
  }
  const rebase = await exec(["git", "rebase", "--autostash", `refs/heads/${task.mainBranch}`], { cwd: root });
  if (passed(rebase)) {
    // An autostash that did not apply cleanly leaves conflict markers, which the next commit would take.
    const unmerged = nulList(await git(exec, root, ["diff", "--name-only", "--diff-filter=U", "-z"]));
    if (unmerged.length > 0) throw new Error(`the autostash did not apply after the rebase onto ${task.mainBranch} (kept in git stash list): ${unmerged.join(", ")}`);
    return null;
  }
  const open = await rebaseInProgress(cleanup, root);
  const conflicts = open ?? [];
  if (open !== null || rebase.killed) await cleanup(["git", "rebase", "--abort"], { cwd: root });
  if (conflicts.length > 0 && !rebase.killed) return conflicts;
  throw new Error(`rebase onto ${task.mainBranch} failed: ${outputTail(rebase.output)}`);
}

/**
 * Makes the task branch one commit on top of its base (`taskBase`), of the tree it holds now. A rebase then conflicts
 * only on what the task changes in net, and a merge of the main branch the coder made is folded in.
 */
async function squashOntoBase(exec: Exec, root: string, task: Task, message: string): Promise<void> {
  const head = await git(exec, root, ["rev-parse", "HEAD"]);
  const base = await taskBase(exec, root, task);
  if (head === base) return;
  const oneCommit = (await git(exec, root, ["rev-list", "--parents", "-n", "1", "HEAD"])) === `${head} ${base}`;
  if (oneCommit && (await git(exec, root, ["show", "-s", "--format=%B", "HEAD"])) === message) return;
  const commit = await git(exec, root, ["commit-tree", "--no-gpg-sign", `${head}^{tree}`, "-p", base, "-m", message]);
  await git(exec, root, ["update-ref", "-m", `factory: squash ${task.branch}`, "HEAD", commit, head]);
}

/** 0 means nothing staged, 1 something. Any other exit is a git failure, never "nothing to commit". */
async function hasStagedChanges(exec: Exec, root: string): Promise<boolean> {
  const staged = await exec(["git", "diff", "--cached", "--quiet"], { cwd: root });
  if (staged.killed || (staged.exitCode !== 0 && staged.exitCode !== 1)) throw new Error(`git diff --cached: ${outputTail(staged.output)}`);
  return staged.exitCode === 1;
}

/** Commits everything in the task worktree but protected paths with `message`. Returns HEAD, also when there was nothing to commit. */
async function commitWorktree(exec: Exec, root: string, message: string, protectedGlobs: string[]): Promise<string> {
  await git(exec, root, [...(await addAllArgs(exec, root)), ...protectedGlobs.map((glob) => `:(exclude,glob)${glob}`)]);
  if (await hasStagedChanges(exec, root)) await git(exec, root, ["commit", "--quiet", "--no-verify", "--no-gpg-sign", "-m", message]);
  return git(exec, root, ["rev-parse", "HEAD"]);
}

function tryMoveTarget(cleanup: Exec, lock: string, root: string, primary: string, task: Task, head: string, before: string) {
  const argv = ["flock", "-n", "-E", String(LOCK_BUSY_EXIT), lock, "sh", "-c", MOVE_TARGET_SCRIPT, "sh", primary, task.mainBranch, task.branch, head, before];
  return cleanup(argv, { cwd: root, maxStdoutChars: 100 });
}

async function mergeWorktree(input: MergeInput, gates: GateData[]): Promise<MergeResult> {
  const { exec, cleanup, root, round, task, config, intent } = input;
  const status = input.status ?? (() => undefined);
  const message = input.message ?? commitMessageFallback(task.title);
  const text = commitText(message);
  const merged = (commit: string, error: string | null, depsSynced: boolean): MergeResult => ({ kind: "merged", merge: { ok: true, commit, error, depsSynced } });
  const fail = (error: string): MergeResult => ({ kind: "failed", merge: { ok: false, commit: null, error, depsSynced: false } });
  // Unlike `outputTail`, no "killed" for an empty output: these commands ran to their exit code.
  const tail = (output: string) => output.trim().slice(-ERROR_TAIL_CHARS);

  const { primary, gitDir } = await primaryCheckout(exec, root);
  const lock = join(gitDir, "factory-merge.lock");
  // A rebase in progress may hold the coder's resolution: it fails the merge here, it is never aborted.
  await assertCheckoutReady(exec, root, task.branch);

  // A merge request merges its source's commits and nothing else: what lies uncommitted stays so.
  if (!isMergeRequest(task)) {
    status("commit");
    await commitWorktree(exec, root, text, config.protected);
  }
  let ontoBefore = await taskBase(exec, root, task);
  const sameGates = JSON.stringify(config.merge_gates) === JSON.stringify(config.gates);

  // Rebased before it queues: a conflict goes to the coder at once, without a place in the queue.
  status(`rebase onto ${task.mainBranch}`);
  const conflicts = await rebaseWorktree(exec, cleanup, root, task, config.protected, text);
  if (conflicts) return { kind: "conflict", files: conflicts };

  /** The ticket's turn: rebase, merge gates, move the target. Again from the rebase when the target moved anyway. */
  const turn = async (): Promise<MergeResult> => {
    // Rebase, gates, move: again from the rebase while another merge lands on the main branch during the gates.
    let moveResult: CommandResult;
    let head: string;
    for (let attempt = 1; ; attempt++) {
      status(attempt === 1 ? `rebase onto ${task.mainBranch}` : `rebase onto ${task.mainBranch} again, it moved (attempt ${attempt})`);
      const conflicts = await rebaseWorktree(exec, cleanup, root, task, config.protected, text);
      if (conflicts) return { kind: "conflict", files: conflicts };
      head = await git(exec, root, ["rev-parse", "HEAD"]);
      // Merge gates that are the round's gates, on the base the round passed them on (the squash keeps the tree), would
      // only repeat that run.
      const onto = await taskBase(exec, root, task);
      for (const argv of onto === ontoBefore && sameGates ? [] : config.merge_gates) {
        status(`merge gate ${argv.join(" ")}`);
        const gate = await exec(argv, { cwd: root });
        gates.push(gateData(round, "merge_gates", argv, gate));
        if (!passed(gate)) return { kind: "gate_failed", gate: { argv, result: gate } };
      }
      ontoBefore = onto;

      status("fast-forward");
      await assertCheckoutReady(exec, root, task.branch);
      const target = await git(exec, primary, ["rev-parse", `refs/heads/${task.mainBranch}`]);
      intent({ commit: head, before: target, message });
      // Each try takes the lock or gives up at once. The update is not killed by a cancel: a fast-forward cut in half
      // leaves the target's checkout partly updated. The wait between tries is, and a lock holder that hangs ends in a timeout.
      const deadline = Date.now() + LOCK_WAIT_MS;
      moveResult = await tryMoveTarget(cleanup, lock, root, primary, task, head, target);
      while (moveResult.exitCode === LOCK_BUSY_EXIT) {
        if (Date.now() > deadline) return fail(`the merge lock ${lock} stayed taken for ${LOCK_WAIT_MS / 1000} s`);
        status("wait for the merge lock");
        if ((await exec(["sleep", "1"], { cwd: root })).killed) return fail("cancelled while waiting for the merge lock");
        moveResult = await tryMoveTarget(cleanup, lock, root, primary, task, head, target);
      }
      if (moveResult.exitCode === TARGET_MOVED_EXIT && attempt < MERGE_ATTEMPTS) continue;
      if (!passed(moveResult)) return fail(`update of ${task.mainBranch} refused: ${tail(moveResult.output)}`);
      break;
    }
    const [before, moved] = moveResult.stdout.trim().split(" ");
    const commit = await git(cleanup, primary, ["rev-parse", `refs/heads/${task.mainBranch}`]);
    if (commit !== head) return fail(`${task.mainBranch} is at ${commit} after the update, not at the task's commit ${head}`);

    // Hooks install into the primary only: another worktree, or a target checked out nowhere, gets none.
    if (moved !== "primary") return merged(commit, null, false);
    const changed = (await git(cleanup, primary, ["diff", "--name-only", before, commit])).split("\n");
    if (!changed.some((path) => config.lockfiles.includes(basename(path)))) return merged(commit, null, false);
    for (const argv of config.hooks.after_merge) {
      status(`after_merge ${argv.join(" ")}`);
      // Under the merge lock, so two tasks never install into the primary checkout at once. `-o`: a process the hook
      // leaves behind does not hold the lock.
      const hook = await exec(["flock", "-w", String(LOCK_WAIT_MS / 1000), "-o", lock, ...argv], { cwd: primary, timeoutMs: AFTER_MERGE_TIMEOUT_MS });
      gates.push(gateData(round, "after_merge", argv, hook));
      if (!passed(hook)) return merged(commit, `after_merge failed: ${argv.join(" ")}: ${tail(hook.output)}`, false);
    }
    return merged(commit, null, true);
  };

  const ticket = await joinQueue(gitDir);
  try {
    for (let ahead = await queueAhead(ticket); ahead > 0; ahead = await queueAhead(ticket)) {
      status(`queued for merge, ${ahead} ahead`);
      if ((await exec(["sleep", String(QUEUE_POLL_MS / 1000)], { cwd: root })).killed) return fail("cancelled while queued for merge");
      // A merge ahead landed: rebase onto it now, a conflict leaves the queue and goes to the coder.
      if (!(await targetMoved(exec, root, task))) continue;
      status(`rebase onto ${task.mainBranch}, a merge ahead landed`);
      const moved = await rebaseWorktree(exec, cleanup, root, task, config.protected, text);
      if (moved) return { kind: "conflict", files: moved };
    }
    return await turn();
  } finally {
    await leaveQueue(ticket);
  }
}

export async function mergeTask(input: MergeInput): Promise<MergeOutcome> {
  const gates: GateData[] = [];
  try {
    return { gates, result: await mergeWorktree(input, gates) };
  } catch (error) {
    return { gates, result: { kind: "failed", merge: { ok: false, commit: null, error: errorText(error), depsSynced: false } } };
  }
}
