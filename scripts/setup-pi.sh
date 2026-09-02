#!/usr/bin/env bash
set -euo pipefail

if ! command -v pi >/dev/null 2>&1; then
  echo "Error: pi is not installed or not on PATH." >&2
  exit 1
fi

packages=(
  "git:github.com/asp345/pi-copilot-auto"
  "npm:@pi-kaush/pi-tool-call-markers"
  "npm:@tintinweb/pi-subagents"
  "npm:@tintinweb/pi-tasks"
  "npm:pi-web-access"
  "npm:pi-rounded-tools"
  "npm:pi-undo-redo"
)

for package in "${packages[@]}"; do
  echo "Installing ${package}..."
  pi install "${package}"
done

echo "Pi extensions installed. Run 'pi update --extensions' later to update them."
