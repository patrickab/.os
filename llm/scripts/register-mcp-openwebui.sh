#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# register-mcp-openwebui.sh
#
# Convenience wrapper that registers the "Deep Research" (GPT Researcher)
# MCP tool server in OpenWebUI. Delegates to register-mcp-server.sh.
#
# Usage:
#   ./llm/scripts/register-mcp-openwebui.sh
#   OWUI_EMAIL=you@example.com OWUI_PASSWORD=pass ./llm/scripts/register-mcp-openwebui.sh
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec "$SCRIPT_DIR/register-mcp-server.sh" \
    --name "Deep Research" \
    --url "http://host.docker.internal:8000/mcp" \
    --type mcp \
    --description "Performs deep research and quick lookups via GPT Researcher" \
    "$@"