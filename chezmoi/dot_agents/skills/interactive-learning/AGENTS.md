# Maintaining the interactive-learning skill

This file is for changing the skill itself. Building a lesson follows `SKILL.md` instead.

## Where to edit

- Edit the chezmoi source at `~/.os/chezmoi/dot_agents/skills/interactive-learning/`. `~/.agents/skills/interactive-learning/` is the deployed copy and is overwritten on `chezmoi apply`.
- chezmoi names in the source: `dot_gitignore` deploys as `.gitignore`, `executable_run.sh` as an executable `run.sh`. Keep these names. Dot-prefixed source files are never deployed.

## Shared shell

`template/` and `example/` run the identical shell. A UI or launcher change goes into both:

| Shared, identical in both | Per app |
|---|---|
| `executable_run.sh`, `dot_gitignore`, `pyproject.toml`, `uv.lock` | `README.md` |
| `frontend/` config: `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts` | `frontend/index.html` description |
| `frontend/src/`: `App.tsx`, `navigation.ts`, `main.tsx`, `style.css`, `components/`, `lib/` | `frontend/src/`: `lessons.tsx`, `content/`, `api.ts`, `chapters.tsx` (example) |
| | `backend/main.py` |

- `template/` stays empty: the placeholder `content/Introduction.tsx` and the `/api/health` endpoint only.
- Content, plot and explanation changes go into `example/` only.
- Dependencies are never committed or deployed. `run.sh` installs them from the lockfiles on every start, so update a lockfile with `npm install` or `uv lock` whenever a dependency changes.

## Before finishing

```sh
for f in executable_run.sh dot_gitignore pyproject.toml uv.lock \
         frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vite.config.ts \
         frontend/src/App.tsx frontend/src/navigation.ts frontend/src/main.tsx frontend/src/style.css \
         frontend/src/components frontend/src/lib; do
  diff -rq "example/$f" "template/$f"
done
npm --prefix example/frontend run build
npm --prefix template/frontend run build
```

- The diff prints nothing and both builds pass.
- For UI changes, run both apps with `./example/executable_run.sh` and `./template/executable_run.sh` (ports 5173 and 8000, one at a time) and check the changed surface in both themes and at a narrow viewport.
- Keep `SKILL.md`, `README.md`, `template/README.md` and `example/README.md` consistent with changed paths, components or rules.
