#!/usr/bin/env bash
# WSL: install Tailscale and enable tailscaled via systemd (wsl.conf has systemd=true),
# so the daemon starts on every WSL boot. Login (`sudo tailscale up`) is one-time.
set -euo pipefail
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
sudo systemctl enable --now tailscaled
if ! tailscale status >/dev/null 2>&1; then
    echo "==> Run once: sudo tailscale up"
fi
