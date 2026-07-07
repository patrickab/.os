---
name: playwright
description: Browser automation and E2E testing with Playwright. Use when the user says "playwright", "e2e", "browser test", "automate browser", or "open playwright".
disable-model-invocation: true
user-invocable: true
---

# Playwright

## 1. Check installation

Run `npx playwright --version 2>/dev/null || echo NOT_FOUND`.

If `NOT_FOUND`, offer: "Playwright not found. Install with `npm init playwright@latest` or `pip install playwright && playwright install`?" Wait for confirmation before installing.

## 2. Detect project type

- If `playwright.config.*` exists → use it
- If no config exists, ask: headed or headless? which browser? (default: chromium, headless)

## 3. Run

| User intent | Command |
|-------------|---------|
| Run all tests | `npx playwright test` |
| Run specific file | `npx playwright test <file>` |
| Open UI mode / inspector | `npx playwright test --ui` |
| Debug a test | `npx playwright test --debug` |
| Show last report | `npx playwright show-report` |

Launch the app first if a dev server is needed (check `package.json` scripts for `dev`/`start`; run it in the background before testing).

## 4. Report results

- Summarize: tests passed / failed / skipped
- For failures: show the failing test name, error message, and file:line
- Offer: "Open the HTML report? (`npx playwright show-report`)"
