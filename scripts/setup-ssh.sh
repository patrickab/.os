#!/usr/bin/env bash
# One entry point for the full remote-SSH dev stack across two machines.
# Role is chosen explicitly by flag — no hostname detection.
#
#   setup-ssh.sh --server [--claude|--codex|--opencode|--all]
#       Run on the REMOTE box (the one you SSH into).
#       Brings up Tailscale (+ Tailscale SSH) and the system sshd, then ensures
#       a local clipboard tool (xclip or wl-paste) is installed so cc-clip's
#       shim can wrap it. If the target includes Codex (--codex or --all), also
#       installs Xvfb (Codex reads X11 directly instead of invoking xclip).
#
#   setup-ssh.sh --client <host> [--claude|--codex|--opencode|--all]
#       Run on the LAPTOP (the machine whose clipboard you paste from).
#       Brings up Tailscale, then runs setup-cc-clip.sh <host> <target>, which
#       installs cc-clip locally and deploys the remote clipboard shim.
#
# Target flags (mutually exclusive, default --all):
#   --claude    Claude Code only
#   --codex     Codex CLI only (needs Xvfb on the remote)
#   --opencode  opencode only
#   --all       Claude + Codex + opencode + notifications (default)
#
# Typical flow on a fresh pair:
#   1. On the remote box:   setup-ssh.sh --server
#   2. On the laptop:        setup-ssh.sh --client <host>
#   3. From the laptop:      ssh <host>           # opens the RemoteForward
#   4. Paste images in the remote opencode/Claude session as usual.

set -euo pipefail

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

MODE=""
HOST=""
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)      MODE="server"; shift ;;
    --client)      MODE="client"; shift; [[ $# -eq 0 ]] && { red "--client requires a <host> argument"; exit 1; }; HOST="$1"; shift ;;
    --claude|--codex|--opencode|--all)
      [[ -n "$TARGET" && "$TARGET" != "$1" ]] && { red "Error: target flags are mutually exclusive (already have '$TARGET')."; exit 1; }
      TARGET="$1"; shift ;;
    -h|--help)
      sed -n '2,24p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *) red "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ -z "$MODE" ]]; then
  red "Error: a mode flag is required (--server or --client <host>)."
  echo "Run with --help for usage."
  exit 1
fi

TARGET="${TARGET:---all}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Distro-aware package install helpers (mirror setup-tailscale.sh style).
# ---------------------------------------------------------------------------
pkg_install() {
  if   command -v apt-get &>/dev/null; then sudo apt-get update -y && sudo apt-get install -y "$@"
  elif command -v dnf     &>/dev/null; then sudo dnf install -y "$@"
  elif command -v yum     &>/dev/null; then sudo yum install -y "$@"
  elif command -v pacman  &>/dev/null; then sudo pacman -Sy --noconfirm "$@"
  elif command -v apk     &>/dev/null; then sudo apk add "$@"
  elif command -v zypper  &>/dev/null; then sudo zypper install -y "$@"
  else
    red "Error: no supported package manager found to install $*."
    red "Install manually, then re-run this script."
    return 1
  fi
}

# ---------------------------------------------------------------------------
# --server: remote box. Tailscale+sshd, then ensure clipboard tool (+ Xvfb).
# ---------------------------------------------------------------------------
run_server() {
  echo "==> [server] Tailscale + sshd + remote clipboard tool (target: ${TARGET})..."
  "$SCRIPT_DIR/setup-tailscale.sh" --enable-ssh

  # Clipboard tool: prefer wl-clipboard (Wayland-capable), fall back to xclip.
  # cc-clip's shim wraps the real binary, so it must exist on the remote.
  if ! command -v wl-paste &>/dev/null && ! command -v xclip &>/dev/null; then
    echo "==> Installing wl-clipboard (preferred) or xclip for the remote shim..."
    if   command -v apt-get &>/dev/null; then pkg_install wl-clipboard || pkg_install xclip
    elif command -v pacman  &>/dev/null; then pkg_install wl-clipboard || pkg_install xclip
    elif command -v dnf || command -v yum || command -v zypper &>/dev/null; then pkg_install wl-clipboard || pkg_install xclip
    else pkg_install xclip
    fi
  fi
  command -v wl-paste &>/dev/null && green "wl-paste present"
  command -v xclip    &>/dev/null && green "xclip present"

  # Xvfb is needed when the target includes Codex (--codex or --all).
  # Codex reads X11 directly instead of invoking xclip, so it needs a virtual
  # display even on a headless server.
  if [[ "$TARGET" == "--codex" || "$TARGET" == "--all" ]]; then
    if ! command -v Xvfb &>/dev/null; then
      echo "==> ${TARGET}: installing Xvfb (Codex reads X11 directly)..."
      if   command -v apt-get &>/dev/null; then pkg_install xvfb
      elif command -v dnf || command -v yum &>/dev/null; then pkg_install xorg-x11-server-Xvfb
      elif command -v pacman &>/dev/null; then pkg_install xorg-server-xvfb
      elif command -v zypper &>/dev/null; then pkg_install xorg-x11-server-Xvfb
      else
        red "Error: could not install Xvfb automatically; install it manually for ${TARGET}."
        exit 1
      fi
    fi
    command -v Xvfb &>/dev/null && green "Xvfb present"
  fi

  green "==> [server] done. cc-clip itself is NOT installed here — the laptop"
  echo "      side runs 'setup-ssh.sh --client <this-host>' to deploy the shim."
}

# ---------------------------------------------------------------------------
# --client <host>: laptop. Tailscale, then cc-clip bridge to the remote.
# ---------------------------------------------------------------------------
run_client() {
  echo "==> [client] Tailscale + cc-clip bridge to '${HOST}' (target: ${TARGET})..."
  "$SCRIPT_DIR/setup-tailscale.sh"
  "$SCRIPT_DIR/setup-cc-clip.sh" "$HOST" "$TARGET"
}

if [[ "$MODE" == "server" ]]; then
  run_server
elif [[ "$MODE" == "client" ]]; then
  run_client
else
  red "Internal error: unknown mode '$MODE'."; exit 1
fi

green "==> setup-ssh.sh complete (${MODE}, target: ${TARGET})."
