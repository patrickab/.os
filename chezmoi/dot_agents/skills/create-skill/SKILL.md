---
name: create-skill
description: Create or update agent skills and slash commands in the ~/.os dotfiles source tree. Use when the user asks to add, author, or scaffold a skill or command for cursor, codex, opencode, or claude.
---

# Create skill or command in ~/.os

All personal agent config lives in the dotfiles repo. **Never** write skills directly to `~/.cursor/skills`, `~/.codex/skills`, `~/.claude/skills`, or `~/.config/opencode/`. Those paths are **generated** by sync.

## Source of truth

```
~/.os/chezmoi/dot_agents/
├── AGENTS.md
├── skills/<name>/SKILL.md       # agent may auto-invoke
└── commands/<name>/SKILL.md     # user-only slash command (/name)
```

OpenCode tool config (watcher ignores, etc.) stays in `~/.os/chezmoi/dot_config/opencode/opencode.jsonc`. Slash-command prompts belong in `dot_agents/commands/`, not in jsonc.

## Skills vs commands

Ask once if unclear. Default from context:

| Type | Folder | When to use |
|------|--------|-------------|
| **Skill** | `dot_agents/skills/` | Agent should discover and use when relevant |
| **Command** | `dot_agents/commands/` | User runs `/name` only; avoid OpenCode skill-index pollution |

**Command** frontmatter — always user-invoked only:

```yaml
---
name: my-command
description: One line: what it does and when the user should run it
disable-model-invocation: true
user-invocable: true
---
```

Sync strips invocation flags for OpenCode `command/*.md` (native slash commands, no skill index). Other tools receive the flags above.

**Skill** frontmatter:

```yaml
---
name: my-skill
description: One line: what it does and when the agent should use it
---
```

Optional on skills: `user-invocable: false` for background knowledge the user should not slash-invoke.

Rules:

- `name` must match the directory name (lowercase, hyphens, max 64 chars)
- `description` is required — tools use it for discovery
- Body is markdown instructions below the closing `---`

## Directory layout

```
my-skill/
├── SKILL.md              # required
├── REFERENCE.md          # optional supporting docs
└── scripts/              # optional helpers
```

Reference extra files from `SKILL.md`; do not duplicate long content inline.

## Workflow

1. **Gather** purpose, skill vs command, and any verbatim wording from the user (use verbatim text in the body when provided).
2. **Check** `~/.os/chezmoi/dot_agents/skills/` and `commands/` for an existing name; update in place instead of duplicating.
3. **Write** the file under the correct folder:

   - Skill: `~/.os/chezmoi/dot_agents/skills/<name>/SKILL.md`
   - Command: `~/.os/chezmoi/dot_agents/commands/<name>/SKILL.md`

4. **Sync** so all tools receive the change. Either:

   - Run `~/.os/setup-lite.sh` (chezmoi apply — triggers sync automatically via `run_onchange` hook)
   - Or run `~/.os/scripts/sync-agent-configs.sh` directly for immediate sync without full chezmoi apply

5. **Report** what was created, the path, skill vs command, and remind the user to restart agent sessions if needed.

## Quality bar

- Keep `SKILL.md` focused; move reference material to sibling files
- Description must say **what** and **when** — vague descriptions cause misfires or missed triggers
- Do not edit generated deploy targets under `~/.config/opencode/`, `~/.cursor/skills/`, etc.
- Do not commit unless the user explicitly asks

## Examples in this repo

- Agent skill: `chezmoi/dot_agents/skills/to-prd/SKILL.md`
- User command: `chezmoi/dot_agents/commands/repomix/SKILL.md`
- User command: `chezmoi/dot_agents/commands/diff-commit/SKILL.md`
