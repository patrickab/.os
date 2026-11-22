# Pi module

Pi config deployed by chezmoi to `~/.pi/agent`. Pi itself is installed by mise (`dot_config/mise/conf.d/agents.toml`).

## Layout

```text
chezmoi/
  dot_pi/agent/modify_settings.json                 pi packages (`packages`), installed by pi itself
  run_onchange_after_reconcile-pi-packages.sh.tmpl  reconcile now + the pix-models patch
  dot_config/mise/conf.d/agents.toml                pi itself and the agent-browser CLI, as mise tools
  run_onchange_after_install-omp-ui.sh.tmpl   npm install for extensions/omp-ui
  dot_pi/agent/
    modify_settings.json        theme, UI keys, defaultTools: ["+codemode"]
    modify_hashline.json        hashline for every model
    modify_web-search.json      brave, then exa
    modify_models-picker.json   hidden providers in /models
    themes/                     oh-lucy-evening-custom
    extensions/
      minimal-ui.ts       prompt + status line
      omp-ui/             omp Markdown and tool cards
      chips.ts            paste chips (image, text, video)
      models-picker.ts    /models with provider pane
      context-usage.ts    context status for pi-host clients
      video-paste.ts      video → 8 scene frames (needs ffmpeg)
      worktree.ts         /worktree
      factory/            agent factory: /factory commands and the task pipeline
  dot_omp/private_agent/themes/   omp theme, also read by omp-ui
scripts/pix-models-newest-first.patch   applied to pix-models by run_onchange_after_reconcile-pi-packages
```

## Setup

`./setup.sh` or `chezmoi apply`. Then once per machine:

- `pi auth login anthropic` (credentials stay out of the repo)
- `BRAVE_API_KEY` comes from `~/.secrets`

## Packages

| Package | Provides |
|---|---|
| `pi-subagents` | subagent delegation |
| `pi-intercom` | messages between pi sessions |
| `pi-interactive-shell` | PTY sessions for interactive/long commands |
| `@jangmanj/pi-hashline` | hashline `read` / `hashline_edit` |
| `pi-web-access` | `web_search`, `fetch_content` |
| `pi-agent-browser-native` | `agent_browser` tools |
| `@xynogen/pix-models` | source only, used by `models-picker.ts` |

## factory

Runs a coding task on its own in a Pi session: code, gates, optional review, merge queue. Works in any repo with a
`factory.yaml` (`/factory init` drafts one). gigachad-bot starts and monitors tasks on top of it and documents the
behaviour: [`.docs/agent-factory.md`](https://github.com/patrickab/gigachad-bot/blob/master/.docs/agent-factory.md).

- **Needs**: `git`, `flock`, and `agent-worktree` (`dot_local/bin/executable_agent-worktree`) for worktree tasks.
- **No runtime packages.** `package.json` is for development: `bun install`, `bun test`, `bun run types` in
  `chezmoi/dot_pi/agent/extensions/factory/`. Tests, `tsconfig.json`, `bun.lock` and `node_modules` are not deployed
  (`.chezmoiignore`).
- **Contract with gigachad-bot**: the `/factory` commands, the `factory-*` session entries and `draft.ts`'s
  `initDraft(root)`. Changing one needs a commit there too.
- **Loaded into every session**, inert until a `/factory` command or a `factory-task` entry.

## omp-ui

Renders assistant Markdown and the `bash`, `read`, `hashline_edit`, `write`, `grep`, `find` cards with omp's `@oh-my-pi/pi-tui`. Display only; on render error it falls back to pi's row. Needs the omp theme file.

- Add a tool: map it in `OMP_TOOL_RENDERERS`, adapt args/results like `toOmpArgs` / `toOmpResult`.
- Update omp: bump the version in `package.json`, check every mapped card.

## Rules

- **One owner per tool/component.** `read`/`hashline_edit` → pi-hashline, editor → `minimal-ui.ts`, cards → omp-ui.
- **Use `modify_*` for files pi writes** so chezmoi pins keys without prompting.
- **Edit the source, never `~/.pi`.** `chezmoi-watch` fails when targets diverge.
- **Removing:** `pi remove` leaves the package in `~/.pi/agent/npm`; chezmoi never deletes removed targets.
- **Restart pi** after changes; `/reload` may keep old code.
