---
name: diff-commit
description: Show unstaged git diff and propose a commit message
disable-model-invocation: true
user-invocable: true
---

Run `git diff -- . ':(exclude)uv.lock'` to see the unstaged changes (uv.lock is excluded). Propose a Conventional Commits message (type(scope): subject) with a short body explaining the why. Use concise imperative language. Present the message in a fenced code block. Do NOT run `git commit`. If there are no unstaged changes, say so.

Emit a criticality assessment using this exact markdown format:

## <Category>
#### Severity: <High|Medium|Low>
**<Problem-Name>**
Description:
<concise-problem-description>

Fix:
<concise-fix-suggestion>

Affected Files:
- <file:line>

Categories: Complexity | Performance | Code-Quality | Extensibility.
Rules:
- A category section appears only if it has at least one finding rated
  Medium or High; Low-only findings do not trigger a section.
- Within a shown section, list all severities present (High, then Medium,
  then Low), each as its own `#### Severity:` block.
- Omit the entire assessment if no category qualifies.
- No preamble, no closing summary, no definitions.
