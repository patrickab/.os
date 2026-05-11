#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# register-mcp-server.sh
#
# Register an MCP (or OpenAPI) tool server with OpenWebUI programmatically.
# Authenticates via the OpenWebUI API, fetches current tool-server config,
# appends the new server (if not already present), and verifies the connection.
#
# The server then appears in OpenWebUI chat → tool selector (wrench icon)
# under the name you provide, alongside "Code Interpreter" and other tools.
#
# Requirements:
#   - OpenWebUI must be running (base service from ./setup.sh)
#   - The target server must be reachable from the OpenWebUI container
#   - You need an admin account on OpenWebUI
#
# Usage:
#   ./scripts/register-mcp-server.sh --name "Deep Research" \
#       --url http://host.docker.internal:8000/mcp --type mcp
#
#   ./scripts/register-mcp-server.sh --name "My API" \
#       --url http://host.docker.internal:9000 --type openapi \
#       --spec-path openapi.json
#
# Environment variables:
#   OWUI_EMAIL          OpenWebUI admin email (avoids prompt)
#   OWUI_PASSWORD       OpenWebUI admin password (avoids prompt)
#   OPENWEBUI_URL       OpenWebUI base URL (default: http://localhost:3000)
#
# ---------------------------------------------------------------------------

OPENWEBUI_URL="${OPENWEBUI_URL:-http://localhost:3000}"
OWUI_EMAIL="${OWUI_EMAIL:-}"
OWUI_PASSWORD="${OWUI_PASSWORD:-}"

# ── helpers ───────────────────────────────────────────────────────────────
red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
cyan()   { printf '\033[36m%s\033[0m\n' "$*"; }

print_help() {
    cat <<'HELP'
register-mcp-server.sh — register a tool server with OpenWebUI

Usage:
  register-mcp-server.sh [OPTIONS]

Options:
  --name <NAME>        Display name shown in OpenWebUI (required)
  --url <URL>          Server base URL, reachable from OpenWebUI container (required)
  --type <TYPE>        Server type: mcp | openapi (default: mcp)
  --description <DESC> Short description shown in the tool picker
  --spec-path <PATH>   OpenAPI spec path, relative to base URL (default: openapi.json)
                       Only used when --type openapi
  --enable             Enable the server immediately (default)
  --disable            Add the server but keep it disabled
  --help               Show this message and exit

Examples:
  # Register GPT Researcher MCP server
  register-mcp-server.sh --name "Deep Research" \
      --url http://host.docker.internal:8000/mcp --type mcp

  # Register a custom OpenAPI tool server
  register-mcp-server.sh --name "Weather API" \
      --url http://host.docker.internal:9000 --type openapi \
      --description "Fetch current weather data" \
      --spec-path /api/openapi.json

  # Non-interactive: credentials from environment
  OWUI_EMAIL=admin@example.com OWUI_PASSWORD=secret \
      register-mcp-server.sh --name "Deep Research" \
      --url http://host.docker.internal:8000/mcp

Notes:
  - MCP servers MUST expose a Streamable HTTP endpoint (not raw SSE).
    The URL should be the base path (e.g. http://host.docker.internal:8000/mcp).
  - OpenAPI servers MUST expose a spec at {url}/{spec-path}.
  - The URL must be reachable from inside the OpenWebUI Docker container.
    Use host.docker.internal for host services, or the container name
    for other compose services on the same Docker network.
HELP
}

# ── defaults ──────────────────────────────────────────────────────────────
SERVER_NAME=""
SERVER_URL=""
SERVER_TYPE="mcp"
SERVER_DESC=""
SPEC_PATH="openapi.json"
ENABLE=true

# ── parse args ────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --name)        SERVER_NAME="$2"; shift 2 ;;
        --url)         SERVER_URL="$2";  shift 2 ;;
        --type)        SERVER_TYPE="$2"; shift 2 ;;
        --description) SERVER_DESC="$2"; shift 2 ;;
        --spec-path)   SPEC_PATH="$2";  shift 2 ;;
        --enable)      ENABLE=true;      shift ;;
        --disable)     ENABLE=false;     shift ;;
        --help)        print_help; exit 0 ;;
        *) red "Unknown option: $1"; print_help; exit 1 ;;
    esac
done

# ── validate ──────────────────────────────────────────────────────────────
if [ -z "$SERVER_NAME" ]; then
    red "Missing --name"
    print_help
    exit 1
fi

if [ -z "$SERVER_URL" ]; then
    red "Missing --url"
    print_help
    exit 1
fi

if [ "$SERVER_TYPE" != "mcp" ] && [ "$SERVER_TYPE" != "openapi" ]; then
    red "Invalid --type: must be 'mcp' or 'openapi'"
    exit 1
fi

echo ""
cyan "=== Register Tool Server ==="
echo ""
echo "  Name:        $SERVER_NAME"
echo "  URL:         $SERVER_URL"
echo "  Type:        $SERVER_TYPE"
[ -n "$SERVER_DESC" ] && echo "  Description: $SERVER_DESC"
[ "$SERVER_TYPE" = "openapi" ] && echo "  Spec path:   $SPEC_PATH"
echo "  Enabled:     $ENABLE"
echo ""

# ── check prerequisites ───────────────────────────────────────────────────
if ! docker ps --format '{{.Names}}' | grep -q '^openwebui$'; then
    red "OpenWebUI not running. Start it first: openwebui"
    exit 1
fi
green "  ✓ OpenWebUI container running"

if ! docker exec openwebui curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL" -H "Accept: application/json, text/event-stream" --max-time 5 2>/dev/null | grep -qE '200|400|401|406'; then
    yellow "  ⚠ Server URL not responding from OpenWebUI container: $SERVER_URL"
    yellow "    Continuing anyway — the server may start later."
else
    green "  ✓ Server URL reachable from OpenWebUI container"
fi

# ── authenticate ──────────────────────────────────────────────────────────
if [ -z "$OWUI_EMAIL" ]; then
    echo -n "OpenWebUI admin email: "
    read -r OWUI_EMAIL
fi

if [ -z "$OWUI_PASSWORD" ]; then
    echo -n "OpenWebUI admin password: "
    read -rs OWUI_PASSWORD
    echo ""
fi

echo "  → Authenticating..."

TOKEN=$(curl -s -X POST "$OPENWEBUI_URL/api/v1/auths/signin" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$OWUI_EMAIL\", \"password\": \"$OWUI_PASSWORD\"}" \
    2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
    red "  ✗ Login failed. Check email/password."
    exit 1
fi
green "  ✓ Authenticated"

# ── fetch current config ──────────────────────────────────────────────────
echo "  → Fetching current tool-server config..."

CURRENT=$(curl -s "$OPENWEBUI_URL/api/v1/configs/tool_servers" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null)

# ── check for duplicate ─────────────────────────────────────────────────
ALREADY=$(echo "$CURRENT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data.get('TOOL_SERVER_CONNECTIONS', []):
    if '$SERVER_URL' == c.get('url', ''):
        print('duplicate')
        sys.exit(0)
print('new')
" 2>/dev/null)

if [ "$ALREADY" = "duplicate" ]; then
    yellow "  ⚠ A server with URL '$SERVER_URL' is already registered."
    echo "    To rename it, remove it first in OpenWebUI Settings → Connections."
    exit 0
fi

# ── build new server entry ────────────────────────────────────────────────
# Generate a URL-safe ID from the name
SERVER_ID=$(echo "$SERVER_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g; s/^-//; s/-$//')

# Convert bash true/false to Python True/False
PY_ENABLE=$(python3 -c "print(str('$ENABLE').lower() == 'true')")

if [ "$SERVER_TYPE" = "mcp" ]; then
    NEW_ENTRY=$(python3 -c "
import json
print(json.dumps({
    'url': '$SERVER_URL',
    'path': '',
    'type': 'mcp',
    'auth_type': 'none',
    'headers': None,
    'key': None,
    'config': {'enable': $PY_ENABLE},
    'info': {'id': '$SERVER_ID', 'name': '$SERVER_NAME', 'description': '$SERVER_DESC'}
}))
")
else
    NEW_ENTRY=$(python3 -c "
import json
print(json.dumps({
    'url': '$SERVER_URL',
    'path': '$SPEC_PATH',
    'type': 'openapi',
    'auth_type': 'none',
    'headers': None,
    'key': None,
    'config': {'enable': $PY_ENABLE},
    'info': {'id': '$SERVER_ID', 'name': '$SERVER_NAME', 'description': '$SERVER_DESC'}
}))
")
fi

# ── merge and POST ───────────────────────────────────────────────────────
UPDATED=$(echo "$CURRENT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
conns = data.get('TOOL_SERVER_CONNECTIONS', [])
conns.append(json.loads('$NEW_ENTRY'))
data['TOOL_SERVER_CONNECTIONS'] = conns
json.dump(data, sys.stdout)
" 2>/dev/null)

echo "  → Registering..."

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$OPENWEBUI_URL/api/v1/configs/tool_servers" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$UPDATED" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    green "  ✓ Tool server '$SERVER_NAME' registered in OpenWebUI."
    echo ""
    echo "  It will appear in the chat tool selector (wrench icon)"
    echo "  after you refresh the page or start a new chat."
    echo ""
else
    red "  ✗ Failed to register (HTTP $HTTP_CODE)."
    exit 1
fi