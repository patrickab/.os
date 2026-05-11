#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# llm/setup.sh
#
# One-shot setup for the LLM stack: OpenWebUI + GPT Researcher (Deep Research)
# MCP server. Builds containers and registers the MCP tool server in OpenWebUI.
#
# Prerequisites (handled by root ./setup.sh):
#   - Docker + docker-compose installed and daemon running
#   - Ollama installed (native systemd service)
#   - User in docker group
#
# Usage:
#   ./llm/setup.sh
#   TAVILY_API_KEY=tvly-... ./llm/setup.sh
#
# See llm/README.md for the full guide.
# ---------------------------------------------------------------------------

LLM_DIR="$(cd "$(dirname "$0")" && pwd)"
MCP_NAME="Deep Research"
MCP_URL="http://host.docker.internal:8000/mcp"

# --- helpers ----------------------------------------------------------------

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
cyan()   { printf '\033[36m%s\033[0m\n' "$*"; }

check_var() { [ -n "${!1:-}" ] && green "    $1  ✓" || yellow "    $1  ✗${2:-  (optional)}"; }

# ---------------------------------------------------------------------------
echo ""
cyan "=== LLM Stack Setup ==="
echo ""

# ── Step 1 – prerequisites ────────────────────────────────────────────────
echo "==> Checking prerequisites..."

if ! command -v docker &>/dev/null; then
    red "ERROR: docker not found. Run ./setup.sh first."; exit 1
fi
echo "    docker:     $(docker --version)"

if ! systemctl is-active --quiet docker 2>/dev/null; then
    red "ERROR: docker daemon not running. Start it: sudo systemctl start docker"; exit 1
fi

if ! groups | grep -qw docker; then
    red "ERROR: not in docker group. Run: sudo usermod -aG docker \$USER; newgrp docker"; exit 1
fi

if ! docker compose version &>/dev/null && ! command -v docker-compose &>/dev/null; then
    red "ERROR: docker compose not available."; exit 1
fi

if ! command -v ollama &>/dev/null; then
    yellow "WARNING: ollama not found. Run ./setup.sh to install it."
fi
echo "    ollama:     $(command -v ollama && ollama --version 2>&1 | head -1 || echo 'not found')"

# ── Step 2 – detect compose command ───────────────────────────────────────
COMPOSE_CMD="docker-compose"
if docker compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
fi

# ── Step 3 – environment variables ─────────────────────────────────────────
echo ""
echo "==> Environment variables:"
check_var TAVILY_API_KEY "  REQUIRED"
check_var OPENAI_API_KEY
check_var ANTHROPIC_API_KEY
check_var OPENAI_BASE_URL
check_var FAST_LLM
check_var SMART_LLM
check_var OLLAMA_HOST

if [ -z "${TAVILY_API_KEY:-}" ]; then
    echo ""
    yellow "TAVILY_API_KEY is required but not set."
    echo "  Export it: export TAVILY_API_KEY=tvly-..."
    echo "  Then re-run this script."
fi

# ── Step 4 – start OpenWebUI ─────────────────────────────────────────────
echo ""
echo "==> Starting OpenWebUI..."
$COMPOSE_CMD -f "$LLM_DIR/openwebui/docker-compose.yml" up -d 2>/dev/null \
    || echo "  (docker group not active yet — run 'newgrp docker' then 'openwebui')"

# ── Step 5 – build and start GPT Researcher ──────────────────────────────
echo ""
echo "==> Building GPT Researcher image..."
$COMPOSE_CMD -f "$LLM_DIR/gpt-researcher/docker-compose.yml" build

echo "==> Starting GPT Researcher..."
$COMPOSE_CMD -f "$LLM_DIR/gpt-researcher/docker-compose.yml" up -d

# ── Step 6 – verify MCP endpoint ─────────────────────────────────────────
echo ""
echo "==> Verifying MCP endpoint..."
for i in $(seq 1 10); do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/mcp \
         -H "Accept: application/json, text/event-stream" --max-time 3 2>/dev/null \
         | grep -qE '200|400|406'; then
        green "    MCP endpoint responding on http://localhost:8000/mcp"
        break
    fi
    if [ "$i" = "10" ]; then
        yellow "    MCP endpoint not responding yet (may need TAVILY_API_KEY)"
    else
        sleep 2
    fi
done

# ── Step 7 – register MCP in OpenWebUI ────────────────────────────────────
echo ""
echo "==> Registering '$MCP_NAME' MCP in OpenWebUI..."

if docker ps --format '{{.Names}}' | grep -q '^openwebui$'; then
    MCP_STATUS=$(docker exec openwebui curl -s -o /dev/null -w "%{http_code}" \
        "$MCP_URL" -H "Accept: application/json, text/event-stream" --max-time 5 2>/dev/null || echo "000")

    if echo "$MCP_STATUS" | grep -qE '200|400|406'; then
        green "    MCP reachable from OpenWebUI container"
        echo ""
        echo "    Run the registration script to enable it in OpenWebUI:"
        echo "      $LLM_DIR/scripts/register-mcp-openwebui.sh"
    else
        yellow "    MCP endpoint not yet reachable from OpenWebUI container."
        echo "    Register later with: $LLM_DIR/scripts/register-mcp-server.sh"
    fi
else
    yellow "    OpenWebUI not running. Start it with: openwebui"
    echo "    Then register with: $LLM_DIR/scripts/register-mcp-server.sh"
fi

# ── Done ───────────────────────────────────────────────────────────────────
echo ""
green "=== LLM Stack Setup Complete ==="
echo ""
echo "  OpenWebUI:          http://localhost:3000"
echo "  GPT Researcher MCP: http://localhost:8000/mcp"
echo ""
echo "  Shell commands:"
echo "    launch-gpt-research               Start with env defaults"
echo "    launch-gpt-research --fastllm X   Override fast model"
echo "    stop-gpt-research                 Stop the stack"
echo "    logs-gpt-research                 Follow service logs"
echo "    openwebui                         Start OpenWebUI"
echo "    openwebui-down                     Stop OpenWebUI"
echo ""
echo "  Register MCP in OpenWebUI:"
echo "    $LLM_DIR/scripts/register-mcp-openwebui.sh"
echo ""