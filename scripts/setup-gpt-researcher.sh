#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# setup-gpt-researcher.sh
#
# One-shot setup for the GPT Researcher MCP server alongside OpenWebUI.
# Deploys chezmoi-managed configs, detects environment variables for API keys
# and model config, builds the container image, and starts the stack.
#
# Prerequisite: OpenWebUI must be running (installed by ./setup.sh).
# API keys must be exported in your shell environment.
#
# Usage:
#   ./scripts/setup-gpt-researcher.sh
#   TAVILY_API_KEY=... OPENAI_API_KEY=... ./scripts/setup-gpt-researcher.sh
# ---------------------------------------------------------------------------

COMPOSE_FILE="$HOME/.config/gpt-research/docker-compose.yml"
MCP_CONFIG="$HOME/.config/gpt-research/mcp/openwebui-mcp.json"

# --- helpers ---------------------------------------------------------------

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
echo ""
green "=== GPT Researcher Setup ==="
echo ""

# ── Step 1 – prerequisite checks ────────────────────────────────────────
echo "==> Checking prerequisites..."

if ! command -v docker &>/dev/null; then
    red "ERROR: docker not found. Run the base setup first:"
    echo "  ./setup.sh"
    exit 1
fi
echo "    docker:     $(docker --version)"

if ! systemctl is-active --quiet docker 2>/dev/null; then
    red "ERROR: docker daemon not running. Start it:"
    echo "  sudo systemctl enable --now docker"
    exit 1
fi

if ! groups | grep -qw docker; then
    red "ERROR: your user is not in the 'docker' group."
    echo "  sudo usermod -aG docker $USER"
    echo "  Then log out and back in (or run: newgrp docker)"
    exit 1
fi

if ! docker compose version &>/dev/null && ! command -v docker-compose &>/dev/null; then
    red "ERROR: docker compose not available."
    exit 1
fi

if ! command -v chezmoi &>/dev/null; then
    red "ERROR: chezmoi not found in PATH."
    echo "Install: curl -fsLS get.chezmoi.io | sh"
    exit 1
fi
echo "    chezmoi:    $(chezmoi --version | head -1)"

if ! docker ps --format '{{.Names}}' | grep -q '^openwebui$'; then
    red "ERROR: OpenWebUI not running. Start it:"
    echo "  openwebui"
    exit 1
fi
echo "    openwebui:  running"

# ── Step 2 – deploy dotfiles ────────────────────────────────────────────
echo ""
echo "==> Deploying GPT Research dotfiles with chezmoi..."

CHEZMOI_SOURCE="$(chezmoi source-path 2>/dev/null || echo "$HOME/.os/chezmoi")"
if [ ! -f "$CHEZMOI_SOURCE/dot_config/gpt-research/docker-compose.yml" ]; then
    CHEZMOI_SOURCE="$HOME/.os/chezmoi"
fi
if [ ! -f "$CHEZMOI_SOURCE/dot_config/gpt-research/docker-compose.yml" ]; then
    red "ERROR: cannot find chezmoi source with gpt-research files."
    exit 1
fi

chezmoi apply
echo "    Config files deployed to ~/.config/gpt-research/"

# ── Step 3 – environment variable detection ─────────────────────────────
echo ""
echo "==> Environment variable status:"
    echo "    (Export these in your shell — see launch-gpt-research --help)"

check_var() { [ -n "${!1:-}" ] && echo "    $1  ✓ ${!1}" || echo "    $1  ✗"; }

check_var TAVILY_API_KEY
check_var OPENAI_API_KEY
check_var ANTHROPIC_API_KEY

echo ""
echo "    FAST_LLM  = ${FAST_LLM:-deepseek-v4-pro:cloud}  (default)"
echo "    SMART_LLM = ${SMART_LLM:-deepseek-v4-pro:cloud}  (default)"
echo "    BASE_URL  = ${OPENAI_BASE_URL:-https://api.openai.com/v1}  (default)"

# TAVILY_API_KEY is the only hard requirement
if [ -z "${TAVILY_API_KEY:-}" ]; then
    echo ""
    yellow "TAVILY_API_KEY is required but not set."
    echo "  Export it: export TAVILY_API_KEY=tvly-..."
    echo "  Then re-run this script."
fi

# ── Step 4 – build and start ────────────────────────────────────────────
echo ""
echo "==> Building and starting GPT Researcher..."

docker-compose -f "$COMPOSE_FILE" build
docker-compose -f "$COMPOSE_FILE" up -d

# ── Step 5 – done ───────────────────────────────────────────────────────
echo ""
green "=== Setup Complete ==="
echo ""
echo "  OpenWebUI:          http://localhost:3000"
echo "  GPT Researcher MCP: http://localhost:8000/mcp"
echo ""
echo "  Register MCP in OpenWebUI:"
echo "    ~/.os/scripts/register-mcp-openwebui.sh"
echo ""
echo "  Shell commands:"
echo "    launch-gpt-research --help"
echo "    launch-gpt-research               Start with env defaults"
echo "    launch-gpt-research --fastllm X   Override fast model"
echo "    stop-gpt-research                 Stop the stack"
echo "    logs-gpt-research                 Follow service logs"
echo ""
