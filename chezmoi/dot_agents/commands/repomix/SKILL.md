---
name: repomix
description: Run repomix and generate/update the four summary context docs
---

Generate the raw repomix output and create or update the cheap-to-inject summary context docs.

Steps:

1. Run repomix to generate the compressed codebase context:
   ```bash
   repomix --compress --style markdown --output .docs/repo-context.md
   ```
   If `repomix` is not on PATH, fall back to `npx repomix` (requires Node.js >= 18). If neither is available, tell the user to install repomix (`npm install -g repomix` or `npx -y repomix`) and stop.

2. Verify `.docs/repo-context.md` was created successfully and read its content.

3. For each of the four files below, check if it already exists. If it does, read it first and preserve all accurate details (build upon the existing content rather than starting from scratch):
   - `.docs/architecture.md`   — overall system architecture, components, data flow. Target ~2k tokens.
   - `.docs/module-map.md`     — directory/module layout and the responsibility of each module. Target ~2k tokens.
   - `.docs/conventions.md`    — language/framework choices, naming, testing, lint/format, commit style. Target ~1k tokens.
   - `.docs/current-focus.md`  — what is actively being worked on, recent changes, open questions. Target ~1k tokens.

4. Rewrite/update each of the four files in place with the updated context from `.docs/repo-context.md`. Update only the parts that have drifted; do not duplicate information across files.

5. Do not edit any source code. Only write the four `.md` files listed above.

6. Report which files changed and their new sizes.
