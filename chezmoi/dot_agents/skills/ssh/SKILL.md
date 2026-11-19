---
name: ssh
description: Connect to the cool-frog remote server (cube1). Use for any remote execution, GPU work, or file access on cube1.
---

# SSH to cube1

## Connect

```bash
ssh bitzer@cube1.pbs.cit.tum.de
```

- `$SSH_CUBE_1` holds the password. Agents connect non-interactively via `sshpass`:

```bash
SSHPASS="$SSH_CUBE_1" sshpass -e ssh -o StrictHostKeyChecking=accept-new bitzer@cube1.pbs.cit.tum.de '<command>'
```

- Never print or echo `$SSH_CUBE_1`

## Long-running processes

cube1 has no tmux, use `screen`. ALWAYS launch processes that outlive one command in a detached screen session named `cool-frog-<job>`, never in the foreground of the SSH session.

```bash
# start (log in ~/cool-frog-jobs/<job>.log, session survives disconnect)
mkdir -p ~/cool-frog-jobs && cd <workdir> && \
screen -dmS cool-frog-<job> bash -c '<cmd> > ~/cool-frog-jobs/<job>.log 2>&1; echo "exit=$?" >> ~/cool-frog-jobs/<job>.log'

screen -ls                                  # list running jobs
tail -n 50 ~/cool-frog-jobs/<job>.log       # inspect output, last line `exit=N` once finished
screen -S cool-frog-<job> -X quit           # stop
```

- Session ends when the command ends, so a listed session means still running
- `<job>` is unique, never reuse a running name
- Attach interactively only from a human terminal: `TERM=xterm-256color screen -r cool-frog-<job>` (kitty's `xterm-kitty` has no terminfo on cube1)
- Linger is off on cube1, avoid `systemd-run --user`
