#!/usr/bin/env bash
# Tailscale setup for any Linux distro (uses official universal installer).
# Run as normal user; sudo will be prompted as needed.
#
# Usage: setup-tailscale.sh [--enable-ssh]
#
# --enable-ssh does two things:
#   1. Enables Tailscale SSH (tailscale up --ssh) — passwordless SSH via tailscaled.
#   2. Installs/starts the system OpenSSH server (sshd) so standard `ssh` on
#      port 22 also works over the tailnet.

set -euo pipefail

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

ENABLE_SSH=0
for arg in "$@"; do
  case "$arg" in
    --enable-ssh) ENABLE_SSH=1 ;;
    -h|--help)
      sed -n '2,5p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *) red "Unknown argument: $arg"; exit 1 ;;
  esac
done

INSTALL_URL="https://tailscale.com/install.sh"
STATE_DIR="/var/lib/tailscale"
SOCKET_DIR="/var/run/tailscale"
STATE_FILE="$STATE_DIR/tailscaled.state"
SOCKET_FILE="$SOCKET_DIR/tailscaled.sock"
LOG_FILE="/var/log/tailscaled.log"

if ! command -v curl &>/dev/null; then
  red "Error: curl is required but not installed."
  exit 1
fi

echo "==> Checking for existing Tailscale installation..."
if command -v tailscale &>/dev/null; then
  green "Tailscale is already installed: $(tailscale version | head -n1)"
  echo "==> Re-running installer to update if available..."
  curl -fsSL "$INSTALL_URL" | sh
else
  echo "==> Installing Tailscale via official universal installer..."
  curl -fsSL "$INSTALL_URL" | sh
fi

TAILSCALE_BIN="$(command -v tailscale || true)"
if [[ -z "$TAILSCALE_BIN" ]]; then
  if [[ -x "/home/linuxbrew/.linuxbrew/bin/tailscale" ]]; then
    TAILSCALE_BIN="/home/linuxbrew/.linuxbrew/bin/tailscale"
  else
    red "Error: tailscale binary not found after install."
    exit 1
  fi
fi

TAILSCALED_BIN="$(command -v tailscaled || true)"
if [[ -z "$TAILSCALED_BIN" ]]; then
  candidate="${TAILSCALE_BIN%/tailscale}/tailscaled"
  [[ -x "$candidate" ]] && TAILSCALED_BIN="$candidate"
fi
if [[ -z "$TAILSCALED_BIN" ]]; then
  for p in /usr/sbin/tailscaled /sbin/tailscaled /usr/local/sbin/tailscaled; do
    [[ -x "$p" ]] && TAILSCALED_BIN="$p" && break
  done
fi
if [[ -z "$TAILSCALED_BIN" ]]; then
  red "Error: tailscaled binary not found."
  exit 1
fi

echo "  tailscale:  $TAILSCALE_BIN"
echo "  tailscaled: $TAILSCALED_BIN"

USE_SYSTEMD=0
if command -v systemctl &>/dev/null; then
  if systemctl list-unit-files 2>/dev/null | grep -q 'tailscaled\.service'; then
    USE_SYSTEMD=1
  fi
fi

start_daemon_systemd() {
  echo "==> Enabling and starting tailscaled.service..."
  sudo systemctl enable --now tailscaled
}

start_daemon_direct() {
  echo "==> No systemd unit for tailscaled; starting daemon directly..."
  if sudo test -S "$SOCKET_FILE"; then
    green "tailscaled socket already present at $SOCKET_FILE"
    return
  fi
  sudo mkdir -p "$STATE_DIR" "$SOCKET_DIR"
  sudo touch "$LOG_FILE"
  sudo setsid "$TAILSCALED_BIN" \
    --state="$STATE_FILE" \
    --socket="$SOCKET_FILE" \
    >>"$LOG_FILE" 2>&1 < /dev/null &
  disown || true
  for _ in $(seq 1 10); do
    if sudo test -S "$SOCKET_FILE"; then
      green "tailscaled started (socket: $SOCKET_FILE, log: $LOG_FILE)"
      return
    fi
    sleep 0.5
  done
  red "Error: tailscaled socket did not appear at $SOCKET_FILE within 5s."
  red "Check $LOG_FILE for details."
  exit 1
}

if [[ "$USE_SYSTEMD" -eq 1 ]]; then
  start_daemon_systemd
else
  start_daemon_direct
fi

echo "==> Bringing Tailscale up..."
if "$TAILSCALE_BIN" status &>/dev/null; then
  green "Tailscale is already up and connected."
else
  UP_ARGS=()
  [[ "$ENABLE_SSH" -eq 1 ]] && UP_ARGS+=(--ssh)
  sudo "$TAILSCALE_BIN" up "${UP_ARGS[@]}"
fi

ensure_system_sshd() {
  echo "==> Ensuring system OpenSSH server (sshd) is installed and running..."
  if command -v sshd &>/dev/null || [[ -x /usr/sbin/sshd ]]; then
    green "sshd already installed: $(sshd -V 2>&1 | head -n1 || echo present)"
  else
    echo "  sshd not found; installing openssh-server..."
    if   command -v apt-get &>/dev/null; then
      sudo apt-get update -y && sudo apt-get install -y openssh-server
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y openssh-server
    elif command -v yum &>/dev/null; then
      sudo yum install -y openssh-server
    elif command -v pacman &>/dev/null; then
      sudo pacman -Sy --noconfirm openssh
    elif command -v apk &>/dev/null; then
      sudo apk add openssh
    elif command -v zypper &>/dev/null; then
      sudo zypper install -y openssh
    else
      red "Error: no supported package manager found to install openssh-server."
      red "Install openssh-server manually, then re-run this script."
      exit 1
    fi
  fi

  # sshd refuses to start without host keys. Generate them if missing
  # (covers cases where the binary exists but keys were never created,
  # e.g. a manual install that skipped the postinst keygen step).
  if ! ls /etc/ssh/ssh_host_*key &>/dev/null; then
    echo "  No SSH host keys found; generating via 'ssh-keygen -A'..."
    sudo ssh-keygen -A
  fi
  if ! sudo /usr/sbin/sshd -t &>/dev/null; then
    red "Error: sshd config test failed. Run 'sudo /usr/sbin/sshd -t' to debug."
    sudo /usr/sbin/sshd -t || true
    exit 1
  fi

  SSHD_SERVICE=""
  for svc in ssh sshd; do
    if command -v systemctl &>/dev/null && systemctl list-unit-files 2>/dev/null | grep -q "^${svc}\.service"; then
      SSHD_SERVICE="$svc"
      break
    fi
  done

  if [[ -n "$SSHD_SERVICE" ]]; then
    sudo systemctl enable --now "$SSHD_SERVICE"
    green "sshd enabled and started via systemd ($SSHD_SERVICE.service)."
  else
    echo "  No systemd sshd unit; starting sshd directly..."
    sudo mkdir -p /run/sshd
    if ! pgrep -x sshd &>/dev/null; then
      sudo "$(command -v sshd || echo /usr/sbin/sshd)"
      sleep 1
    fi
    if pgrep -x sshd &>/dev/null; then
      green "sshd started (pid: $(pgrep -x sshd | head -n1))."
    else
      red "Error: sshd failed to start. Check 'sudo /usr/sbin/sshd -t' and /var/log/auth.log."
      exit 1
    fi
  fi
}

if [[ "$ENABLE_SSH" -eq 1 ]]; then
  ensure_system_sshd
fi

echo "==> Health check:"
if "$TAILSCALE_BIN" status &>/dev/null; then
  green "OK — Tailscale is up."
  "$TAILSCALE_BIN" status | head -n20
else
  red "Tailscale is not connected. Run 'sudo $TAILSCALE_BIN up' manually."
  exit 1
fi

green "==> Tailscale setup complete."
