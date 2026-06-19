---
name: diff-commit
description: Show unstaged git diff and propose a commit message
disable-model-invocation: true
user-invocable: true
---

Run `git diff -- . ':(exclude)uv.lock'` to see the unstaged changes (uv.lock is excluded). Propose a Conventional Commits message (type(scope): subject) with a short body explaining the why. Use concise imperative language. Present the message in a fenced code block. Do NOT run `git commit`. If there are no unstaged changes, say so.
