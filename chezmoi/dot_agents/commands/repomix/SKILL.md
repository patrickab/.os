---
name: repomix
description: Run repomix and generate/update the two repository context docs
---

Generate a compressed repository context, then create or update the two cheap-to-inject context docs in `docs/`.

Steps:

1. Run repomix to generate the compressed codebase context in a temporary file:
   ```bash
   repomix --compress --style markdown --output /tmp/repomix-context.md
   ```
   If `repomix` is not on PATH, fall back to `npx repomix` (requires Node.js >= 18). If neither is available, tell the user to install repomix (`npm install -g repomix` or `npx -y repomix`) and stop.

2. Verify the temporary file was created successfully and read its content.

3. For each file below, check if it already exists. If it does, read it first and preserve all accurate details:
   - `docs/architecture.md` — system architecture, components, and data flow. Target ~2k tokens.
   - `docs/module-map.md` — directory/module layout and responsibilities. Target ~2k tokens.

4. Update the two files from the temporary context. Keep them complementary; do not duplicate information across them.

5. Do not edit source code. Only write the two `docs/*.md` files above.

6. Remove the temporary context file, then report which files changed and their new sizes.
