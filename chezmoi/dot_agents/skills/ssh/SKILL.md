---
name: ssh
description: Run commands on remote machines over SSH. Hosts are defined per device in ~/.ssh/config.local. Use for any remote execution or file access.
---

# SSH

Hosts come from `~/.ssh/config` and the device-local `~/.ssh/config.local` (list: `grep -h '^Host ' ~/.ssh/config*`). Never hardcode hosts or secrets in this skill.

## Run

Password for host `<alias>` is in env var `SSH_PW_<ALIAS>` (uppercase, `-` as `_`), loaded from `~/.secrets`. If unset, the host uses key login.

```bash
# key login
ssh -o BatchMode=yes <alias> '<command>'
# password login
SSHPASS="$SSH_PW_<ALIAS>" sshpass -e ssh -o StrictHostKeyChecking=accept-new <alias> '<command>'
```

- Connections are shared for 8h (`ControlMaster`), so after the first call no password is needed
- Never print password variables
- Unknown alias or missing variable: tell the user to add the host to `~/.ssh/config.local` / the variable to `~/.secrets`

## Long-running processes

Launch anything that outlives one command in a detached `screen` (or tmux if present) session named `<alias>-<job>`, logging to `~/agent-jobs/<job>.log`.

```bash
ssh -o BatchMode=yes <alias> 'mkdir -p ~/agent-jobs && cd <workdir> && screen -dmS <alias>-<job> bash -c "<cmd> > ~/agent-jobs/<job>.log 2>&1; echo exit=\$? >> ~/agent-jobs/<job>.log"'
ssh -o BatchMode=yes <alias> 'screen -ls; tail -n 50 ~/agent-jobs/<job>.log'
ssh -o BatchMode=yes <alias> 'screen -S <alias>-<job> -X quit'
```

- Job names unique; a listed session is still running; last log line `exit=N` when done
- Attach only from a human terminal
