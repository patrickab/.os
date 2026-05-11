#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# register-mcp-openwebui.sh
#
# Programmatically register the GPT Researcher MCP server in OpenWebUI
# via the admin API. Requires OpenWebUI admin credentials.
#
# Usage:
#   ./scripts/register-mcp-openwebui.sh
#   OWUI_EMAIL=you@example.com OWUI_PASSWORD=pass ./scripts/register-mcp-openwebui.sh
# ---------------------------------------------------------------------------

OPENWEBUI_URL="${OPENWEBUI_URL:-http://localhost:3000}"
MCP_URL="${GPT_RESEARCHER_MCP_URL:-http://host.docker.internal:8000/mcp}"
OWUI_EMAIL="${OWUI_EMAIL:-}"
OWUI_PASSWORD="${OWUI_PASSWORD:-}"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

if ! docker ps --format '{{.Names}}' | grep -q '^openwebui$'; then
    red "OpenWebUI not running. Start it first: openwebui"
    exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q '^gpt-researcher$'; then
    yellow "GPT Researcher not running. Start it first: launch-gpt-research"
    exit 1
fi

MCP_STATUS=$(docker exec openwebui curl -s -o /dev/null -w "%{http_code}" "$MCP_URL" -H "Accept: application/json, text/event-stream" --max-time 5 2>/dev/null || echo "000")
if [ "$MCP_STATUS" = "000" ]; then
    red "MCP endpoint unreachable from OpenWebUI: $MCP_URL"
    exit 1
fi

if [ -z "$OWUI_EMAIL" ]; then
    echo -n "OpenWebUI admin email: "
    read -r OWUI_EMAIL
fi

if [ -z "$OWUI_PASSWORD" ]; then
    echo -n "OpenWebUI admin password: "
    read -rs OWUI_PASSWORD
    echo ""
fi

TOKEN=$(curl -s -X POST "$OPENWEBUI_URL/api/v1/auths/signin" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$OWUI_EMAIL\", \"password\": \"$OWUI_PASSWORD\"}" \
    2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
    red "Login failed. Check email/password."
    exit 1
fi

CURRENT=$(curl -s "$OPENWEBUI_URL/api/v1/configs/tool_servers" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)

ALREADY=$(echo "$CURRENT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data.get('TOOL_SERVER_CONNECTIONS', []):
    if '$MCP_URL' in c.get('url', ''):
        print('yes')
        sys.exit(0)
print('no')
" 2>/dev/null)

if [ "$ALREADY" = "yes" ]; then
    yellow "MCP tool server already registered in OpenWebUI."
    exit 0
fi

UPDATED=$(echo "$CURRENT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
conns = data.get('TOOL_SERVER_CONNECTIONS', [])
conns.append({
    'url': '$MCP_URL',
    'path': '',
    'type': 'mcp',
    'auth_type': 'none',
    'headers': None,
    'key': None,
    'config': {'enable': true},
    'info': {'id': 'gpt-researcher'})
data['TOOL_SERVER_CONNECTIONS'] = conns
json.dump(data, sys.stdout)
" 2>/dev/null)

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$OPENWEBUI_URL/api/v1/configs/tool_servers" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$UPDATED" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    green "MCP tool server registered in OpenWebUI."
else
    red "Failed to register (HTTP $HTTP_CODE)."
    exit 1
fi