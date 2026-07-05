---
name: diff-staged
description: Show staged git diff and propose a commit message
disable-model-invocation: true
user-invocable: true
---

Run `git diff --staged -- . ':(exclude)uv.lock'` to see the staged changes (uv.lock is excluded). Propose a Conventional Commits message (type(scope): subject) with a short body explaining the why. Use concise imperative language. Present the message in a fenced code block. Do NOT run `git commit`. If nothing is staged, say so.
