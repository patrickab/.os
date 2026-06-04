#!/usr/bin/env bash
# One-shot bootstrap of the Repomix-driven context pipeline for a repo.
#
# What it does:
#   1. Ensures repomix is available (via npx, no global install required).
#   2. Generates .docs/repo-context.md (compressed repomix output).
#   3. Instructs the user to run /repomix in opencode to generate the four
#      cheap-to-inject summary docs (architecture.md, module-map.md,
#      conventions.md, current-focus.md).
#
# After this, the only thing you do per-repo is run /repomix, then commit
# the four .docs/*.md files. The agent loads those on every task.
#
# Usage:  ctx-setup.sh [path-to-repo]
#         (defaults to current directory)

set -euo pipefail

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }
info() { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }

# ── Args ──
TARGET="${1:-$PWD}"
if [[ ! -d "$TARGET" ]]; then
    err "Not a directory: $TARGET"
    exit 1
fi
TARGET="$(cd "$TARGET" && pwd)"

DOCS_DIR="$TARGET/.docs"
CTX_FILE="$DOCS_DIR/repo-context.md"
SUMMARY_FILES=(architecture.md module-map.md conventions.md current-focus.md)

# ── Resolve repomix ──
REPOMIX_CMD=""
if command -v repomix &>/dev/null; then
    REPOMIX_CMD="repomix"
elif command -v npx &>/dev/null; then
    warn "repomix not on PATH; using 'npx repomix' (requires Node.js >= 18)"
    REPOMIX_CMD="npx -y repomix"
else
    err "Need 'repomix' or 'npx' on PATH. Install Node.js >= 18 first."
    exit 1
fi

# ── Generate compressed repomix output ──
mkdir -p "$DOCS_DIR"

info "Running repomix in: $TARGET"
info "Output: $CTX_FILE"

# shellcheck disable=SC2086
$REPOMIX_CMD \
    --compress \
    --style markdown \
    --output "$CTX_FILE"

if [[ ! -s "$CTX_FILE" ]]; then
    err "repomix did not produce $CTX_FILE"
    exit 1
fi

size=$(wc -c < "$CTX_FILE" | tr -d ' ')
ok "Wrote $CTX_FILE ($size bytes)"

# ── Print the follow-up instructions ──
echo ""
info "── Next step: run /repomix in opencode ──"
echo ""
printf '%s\n' "─────────────────────────────────────────────────────────────────"
cat <<EOF
Now open opencode and run:

  /repomix

This will automatically read the generated context and create or update the four
summary context files:
  - $DOCS_DIR/architecture.md
  - $DOCS_DIR/module-map.md
  - $DOCS_DIR/conventions.md
  - $DOCS_DIR/current-focus.md
EOF
printf '%s\n' "─────────────────────────────────────────────────────────────────"
echo ""

# ── Sanity check: warn if a repomix-style script lives in the repo ──
if [[ -x "$TARGET/scripts/ctx.sh" ]]; then
    warn "Found $TARGET/scripts/ctx.sh — this is redundant. Remove it;"
    warn "the script is now ~/.os/scripts/ctx-setup.sh."
fi
