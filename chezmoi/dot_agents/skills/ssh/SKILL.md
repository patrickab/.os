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

Check progress by `tail`ing the remote log over another `ssh` call, not by
polling in a loop.

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

To detach without killing the job: `Ctrl+B` then `D` — **never `Ctrl+C`**,
that sends SIGINT to the foreground process (kills the training run), not to
tmux. If a job dies mid-run with `KeyboardInterrupt` in its log, this is the
usual cause.
