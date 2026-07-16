---
name: ssh
description: Connect to the user's remote machines over SSH with password auth (sshpass) to edit files, run commands, or offload GPU work. Use when the user asks to run something "on the other machine", "on the GPU box", or similar remote execution requests.
---

# SSH to remote machines

Password auth only. The password is already in the `SSHPASS` env var — never
hardcode, echo it to the terminal, or write it to a file; pipe it into
`sshpass` over stdin (`-d0`) rather than passing it as an arg.

## Known hosts

| Nickname | Address | User | Notes |
|---|---|---|---|
| imperator | `100.89.120.40` (Tailscale) | `noob` | GPU box. No git remote access — sync via `scp`, not `git pull`. |

## Connecting

```bash
echo "$SSHPASS" | sshpass -d0 ssh -o StrictHostKeyChecking=accept-new noob@100.89.120.40 '<cmd>'
```

## Syncing files

No deploy key on imperator, so don't `git pull`/`push` or `git diff`/`apply`.
Just `scp` the changed files (or whole dir) over:

```bash
echo "$SSHPASS" | sshpass -d0 scp -o StrictHostKeyChecking=accept-new -r <local_path> noob@100.89.120.40:<remote_path>
```

## Long jobs

Run training/long jobs in a `tmux` session named after the repo (the current
folder's basename, not its path) — don't block a foreground SSH command on
them. Create it if missing, else attach to the existing one:

```bash
echo "$SSHPASS" | sshpass -d0 ssh ... noob@100.89.120.40 "tmux new -d -s <reponame> '<cmd>' || tmux attach -t <reponame>"
```

Two gotchas, both learned the hard way:

- **The redirect target dir must already exist.** `tmux new -d '... > repo/logs/x.log'`
  dies instantly and silently if `logs/` is missing — `tmux ls` even shows the
  session for a moment. `mkdir -p` the log dir in the same ssh call, *before*
  `tmux new`.
- **Don't plain-redirect a progress-bar program to a log file.** Rich/tqdm/TUI
  output detects the non-tty and buffers until the run ends, so the tmux window
  *and* the log stay blank for the whole run. Wrap the command in `script`,
  which gives it a pty — progress renders live in the tmux window and is logged:

```bash
script -qec "<cmd>" logs/run.log        # inside the tmux session / driver script
```

The log then contains ANSI escapes — read it with `less -R` or
`sed 's/\x1b\[[0-9;]*[a-zA-Z]//g'`, not raw `cat`.

Check progress by `tail`ing the remote log over another `ssh` call, not by
polling in a loop.

## Waking yourself when the job finishes

Don't leave a finished remote job waiting for the user to ask about it. Have
the driver script end with a distinct marker (e.g. `echo "ALL DONE"`), then —
right after launching — arm a watcher that polls the remote and exits on any
terminal state, so the harness re-invokes you exactly once:

- Job under ~10 min → `Bash` with `run_in_background: true` and an `until`
  loop (its 10-min timeout cap applies even in background).
- Longer → the `Monitor` tool (timeout up to 1 h; `persistent: true` beyond).

The watcher must fire on **failure too, not just success** — silence looks
identical to "still running". Cover the marker *and* the tmux session dying:

```bash
while true; do
  out=$(echo "$SSHPASS" | sshpass -d0 ssh -o ConnectTimeout=15 noob@100.89.120.40 \
    'cat <repo>/logs/driver.log 2>/dev/null; tmux has-session -t <reponame> 2>/dev/null && echo TMUX_ALIVE' 2>/dev/null) || true
  echo "$out" | grep -q "ALL DONE" && { echo "JOB COMPLETE"; echo "$out" | tail -40; exit 0; }
  [ -n "$out" ] && ! echo "$out" | grep -q TMUX_ALIVE && { echo "JOB DIED — session gone, no ALL DONE"; echo "$out" | tail -15; exit 0; }
  sleep 60
done
```

(`|| true` on the ssh: one dropped connection must not kill the watcher.)

## Letting the user watch/attach

Plain `ssh host cmd` has no pty, so `tmux attach` over it just hangs/fails —
attaching needs `-t`:

```bash
ssh -t noob@100.89.120.40 tmux attach -t <reponame>
```

Default to **read-only** attach so stray keystrokes can't reach the job:

```bash
ssh -t noob@100.89.120.40 tmux attach -t <reponame> -r
```

Read-only (`-r`) blocks keystrokes, so to **interact** with a TUI running in
the session (e.g. the HPO dashboard — `Tab` toggles overview/event-log,
`q` quits) attach without `-r`:

```bash
ssh -t noob@100.89.120.40 tmux attach -t <reponame>
```

To detach without killing the job: `Ctrl+B` then `D` — **never `Ctrl+C`**,
that sends SIGINT to the foreground process (kills the training run), not to
tmux. If a job dies mid-run with `KeyboardInterrupt` in its log, this is the
usual cause.
