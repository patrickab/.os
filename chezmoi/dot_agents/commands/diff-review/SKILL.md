---
name: diff-review
description: Review unstaged changes for size and runtime performance risks
disable-model-invocation: true
user-invocable: true
---

Run `git diff -- . ':(exclude)uv.lock'` to see unstaged changes (uv.lock is excluded). Review the diff for two risks: (1) excessive LOC or complexity in any single function/block, and (2) runtime performance regressions in hot paths. For each finding, cite file:line and propose a concrete fix. Use concise imperative language. Do NOT modify any files.
