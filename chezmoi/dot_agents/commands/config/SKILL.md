---
name: config
description: Apply dotfiles from ~/.os/chezmoi to the home directory via setup-lite.sh. Use when the user asks to apply, deploy, or sync chezmoi configurations to their system.
disable-model-invocation: true
user-invocable: true
---

Apply personal dotfile configurations from the chezmoi source tree. This modifies files under `$HOME` — run only when the user explicitly requests it.

## Source of truth

All managed configuration lives in:

```
~/.os/chezmoi/
├── dot_agents/          → ~/.agents/          (agent skills, commands, AGENTS.md)
├── dot_config/          → ~/.config/          (nvim, hypr, opencode jsonc, …)
├── dot_gitconfig        → ~/.gitconfig
├── dot_bashrc_appendix  → appended bash config
└── …                    (other chezmoi-managed dotfiles)
```

The repo root is `~/.os`. Configurations are **not** edited in `$HOME` directly — change chezmoi source, then apply.

## Apply workflow

1. **Preflight — abort if a password would be required**

   The agent must not hang on interactive sudo or credential prompts. Check before running anything:

   ```bash
   # chezmoi must exist OR passwordless sudo must be available for bootstrap install
   if ! command -v chezmoi &>/dev/null; then
     if ! sudo -n true 2>/dev/null; then
       echo "ABORT: chezmoi is not installed and sudo requires a password."
       echo "Install chezmoi manually, then re-run /config."
       exit 1
     fi
   fi
   ```

   Also abort (do not run `setup-lite.sh`) if:
   - `~/.os` is not a git repo and the user expected `git pull`
   - `git pull` fails with authentication / credential errors
   - `chezmoi apply` would need a template secret the agent cannot supply

   On abort: **stop immediately**, tell the user what blocked the apply, and give the exact command to run manually in their terminal (e.g. `~/.os/setup-lite.sh`).

2. **Apply dotfiles (lite mode — no Ansible/full setup)**

   ```bash
   ~/.os/setup-lite.sh
   ```

   `setup-lite.sh` runs `chezmoi init --source ~/.os/chezmoi --working-tree ~/.os --apply`, then `scripts/sync-agent-configs.sh`. It does **not** run the full Ansible playbook.

3. **Report**

   Summarize:
   - Whether apply succeeded or was aborted (and why)
   - Which chezmoi targets likely changed (if `chezmoi diff` / apply output shows them)
   - Reminder to restart shells or agent sessions if bash, nvim, or agent configs changed

## Constraints

- Do **not** run `setup.sh` (full provisioner) unless the user explicitly asks — it requires sudo/Ansible and interactive passwords.
- Do **not** use `sudo` directly except what `setup-lite.sh` invokes internally for chezmoi bootstrap.
- Do **not** edit `$HOME` config files by hand when the chezmoi source exists — edit `~/.os/chezmoi/` instead, then apply.
- Do **not** commit or push unless the user explicitly asks.

## Manual fallback

If preflight aborts, tell the user:

```bash
~/.os/setup-lite.sh
```

Run that in an interactive terminal where they can enter a sudo or git password if needed.
