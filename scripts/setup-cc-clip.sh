#!/usr/bin/env bash
# cc-clip setup: paste images from the local clipboard into remote AI coding
# agents (Claude Code, opencode, Codex) over SSH. Runs on the LAPTOP (the
# machine whose clipboard you want to paste from).
#
# Usage: setup-cc-clip.sh [--claude|--codex|--opencode|--all] <host>
#
# <host> is the SSH Host alias (must be reachable, e.g. via Tailscale DNS).
# Edit REMOTE_HOSTNAME / REMOTE_USER below (or override via env) to point at
# your target machine.
#
# Target flags (mutually exclusive, pick at most one; default --all):
#   --claude    Claude Code clipboard shim + claude-notify
#   --codex     Codex CLI only (Xvfb + x11-bridge on the remote; no Claude shim)
#   --opencode  opencode clipboard shim + opencode-notify
#   --all       All of the above (Claude + Codex + opencode + notifications)
#
# Steps:
#   1. Ensures a ~/.ssh/config Host entry exists for <host> (created if missing).
#   2. Installs cc-clip locally (~/.local/bin/cc-clip) if not present.
#   3. Verifies a local clipboard tool (wl-paste / xclip) is available.
#   4. On Linux, starts `cc-clip serve` in the background if it isn't already
#      running (cc-clip has no launchd-equivalent auto-start there).
#   5. Runs `cc-clip setup <host> <target>`, which:
#        - starts/reuses the local cc-clip daemon (clipboard bridge on 127.0.0.1:18339),
#        - adds RemoteForward 18339 to the SSH config for <host>,
#        - deploys the xclip/wl-paste shim on the remote host.
#
# After this, open a fresh `ssh <host>` session — the RemoteForward is live only
# while an SSH connection owns it. Paste as usual in the remote agent.

set -euo pipefail

# --- Editable defaults -------------------------------------------------------
# Remote coordinates for the Host entry created in ~/.ssh/config (step 1).
# Override per-invocation with e.g. `REMOTE_HOSTNAME=1.2.3.4 setup-cc-clip.sh ...`.
REMOTE_HOSTNAME="${REMOTE_HOSTNAME:-100.89.120.40}"
REMOTE_USER="${REMOTE_USER:-noob}"
# Default target when no --claude/--codex/--opencode/--all flag is passed.
DEFAULT_TARGET="${DEFAULT_TARGET:---all}"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

HOST=""
TARGET=""

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      sed -n '2,25p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    --claude|--codex|--opencode|--all)
      [[ -n "$TARGET" && "$TARGET" != "$arg" ]] && { red "Error: target flags are mutually exclusive (already have '$TARGET')."; exit 1; }
      TARGET="$arg" ;;
    -*) red "Unknown flag: $arg"; exit 1 ;;
    *) [[ -z "$HOST" ]] && HOST="$arg" || { red "Only one <host> positional allowed (got '$arg')."; exit 1; } ;;
  esac
done

if [[ -z "$HOST" ]]; then
  red "Error: <host> is required."
  echo "Run with --help for usage."
  exit 1
fi

TARGET="${TARGET:-$DEFAULT_TARGET}"

# --- 1. Ensure ~/.ssh/config has a Host entry for $HOST ---------------------
SSH_DIR="$HOME/.ssh"
SSH_CONFIG="$SSH_DIR/config"

mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"

if [[ ! -f "$SSH_CONFIG" ]] || ! grep -qE "^Host ${HOST}\$" "$SSH_CONFIG"; then
  echo "==> Adding SSH config entry for ${HOST}..."
  cat >> "$SSH_CONFIG" <<EOF

Host ${HOST}
    HostName ${REMOTE_HOSTNAME}
    User ${REMOTE_USER}
EOF
  chmod 600 "$SSH_CONFIG"
  green "Added Host ${HOST} → ${REMOTE_USER}@${REMOTE_HOSTNAME}"
else
  green "SSH config already has a Host ${HOST} entry."
fi

# --- 2. Install cc-clip ------------------------------------------------------
if command -v cc-clip &>/dev/null; then
  green "cc-clip already installed: $(cc-clip --version 2>&1 | head -n1)"
else
  echo "==> Installing cc-clip..."
  curl -fsSL https://raw.githubusercontent.com/ShunmeiCho/cc-clip/main/scripts/install.sh | sh
  # Installer puts the binary in ~/.local/bin; surface it for this shell.
  export PATH="$HOME/.local/bin:$PATH"
fi

if ! command -v cc-clip &>/dev/null; then
  red "Error: cc-clip not found after install."
  red "Add ~/.local/bin to your PATH and re-run."
  exit 1
fi

# --- 3. Ensure a local clipboard tool is available ---------------------------
if ! command -v wl-paste &>/dev/null && ! command -v xclip &>/dev/null; then
  red "Error: neither wl-paste nor xclip is installed locally."
  red "Install wl-clipboard (Wayland) or xclip (X11), then re-run."
  exit 1
fi

# --- 4. Start the local cc-clip daemon (Linux has no launchd auto-start) ----
if [[ "$(uname -s)" == "Linux" ]] && ! curl -fsS -o /dev/null "http://127.0.0.1:18339/health" 2>/dev/null; then
  echo "==> Starting cc-clip daemon (cc-clip serve) in the background..."
  nohup cc-clip serve >/tmp/cc-clip-serve.log 2>&1 &
  disown
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -fsS -o /dev/null "http://127.0.0.1:18339/health" 2>/dev/null && break
    sleep 0.5
  done
  if ! curl -fsS -o /dev/null "http://127.0.0.1:18339/health" 2>/dev/null; then
    red "Error: cc-clip serve did not come up; check /tmp/cc-clip-serve.log"
    exit 1
  fi
  green "cc-clip daemon is up."
else
  green "cc-clip daemon already running."
fi

# --- 5. Run cc-clip setup ----------------------------------------------------
echo "==> Running: cc-clip setup ${HOST} ${TARGET}..."
cc-clip setup "$HOST" "$TARGET"

green "==> cc-clip setup complete for ${HOST} (target: ${TARGET})."
echo "    Open a fresh 'ssh ${HOST}' session — the RemoteForward is live only"
echo "    while an SSH connection owns it. Paste as usual in the remote agent."
