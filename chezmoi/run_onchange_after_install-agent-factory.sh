#!/bin/bash
# The agent factory (github.com/patrickab/agent-factory): one clone that Pi loads as a package
# (dot_pi/agent/modify_settings.json) and whose binaries are linked into ~/.local/bin. An existing clone is left as it
# is: update it with `git pull`.
set -euo pipefail

dir="$HOME/git/agent-factory"
if [[ ! -d "$dir/.git" ]]; then
    mkdir -p "$HOME/git"
    git clone https://github.com/patrickab/agent-factory "$dir"
fi
(cd "$dir" && "$HOME/.local/bin/mise" exec -- bun install --frozen-lockfile)
mkdir -p "$HOME/.local/bin"
ln -sfn "$dir/src/cli.ts" "$HOME/.local/bin/factory"
ln -sfn "$dir/src/mcp.ts" "$HOME/.local/bin/factory-mcp"
