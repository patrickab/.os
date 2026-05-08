#!/usr/bin/env bash
# ==============================================================================
# MODULE: setup_wifi_redirect.sh
# 
# DESCRIPTION:
#   Installs and configures an automated captive portal detection and bypass 
#   system for iwd/impala on Wayland setups.
#
# HOW IT WORKS:
#   1. Builds 'captive-browser' from source. This utility creates a SOCKS5 
#      proxy that routes DNS directly to the AP's DHCP-provided DNS server, 
#      bypassing 'systemd-resolved' which otherwise breaks captive redirects.
#   2. Configures Chrome to run in isolated incognito mode via this proxy.
#   3. Deploys 'impala-captive', a background daemon that monitors iwd.
#   4. When an "Open" network is joined, the daemon automatically launches 
#      'captive-browser' to handle the sign-in portal.
# ==============================================================================

set -euo pipefail

# Exit early if already installed to maintain idempotency.
if [ -f "$HOME/.local/bin/captive-browser" ] && [ -f "$HOME/.local/bin/impala-captive" ]; then
    echo "Captive browser setup already exists. Skipping."
    exit 0
fi

echo "Setting up captive-browser and impala-captive..."

# Prepare local user directories.
mkdir -p "$HOME/.local/bin" "$HOME/.config/systemd/user" "$HOME/.config"

# Build captive-browser from source to avoid root/AUR dependency issues.
if ! command -v captive-browser &> /dev/null; then
    echo "Building captive-browser..."
    TMP_DIR=$(mktemp -d)
    cd "$TMP_DIR"
    
    # Download standalone Go toolchain if missing to keep setup unprivileged.
    if ! command -v go &> /dev/null; then
        wget https://go.dev/dl/go1.22.3.linux-amd64.tar.gz -O go.tar.gz
        tar -xzf go.tar.gz
        export PATH="$TMP_DIR/go/bin:$PATH"
    fi

    git clone https://github.com/FiloSottile/captive-browser.git
    cd captive-browser
    
    # Initialize local module and strip vendor directory to fix build errors on modern Go.
    go mod init captive-browser || true
    go mod tidy || true
    rm -rf vendor
    go build
    
    cp captive-browser "$HOME/.local/bin/"
    
    cd "$HOME"
    rm -rf "$TMP_DIR"
fi

# Write captive-browser config.
# Use isolated data dir and strict proxy rules to force AP DNS usage.
# Extract raw IPv4 DNS server from the current lease, bypassing systemd-resolved cache.
cat << 'EOF' > "$HOME/.config/captive-browser.toml"
browser = """
    google-chrome-stable \
    --user-data-dir="$HOME/.google-chrome-captive" \
    --proxy-server="socks5://$PROXY" \
    --host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE localhost" \
    --no-first-run --new-window --incognito \
    http://captive.apple.com
"""
dhcp-dns = "resolvectl dns wlan0 | grep -oP '\\b\\d{1,3}(\\.\\d{1,3}){3}\\b' | head -n 1"
socks5-addr = "localhost:1666"
EOF

# Write the polling daemon.
cat << 'EOF' > "$HOME/.local/bin/impala-captive"
#!/usr/bin/env bash
set -euo pipefail

CHECK_INTERVAL="${CHECK_INTERVAL:-2}"
DEBUG="${DEBUG:-0}"
PREV_SSID=""

# Force Wayland and DBus environments since systemd user services lack them.
if [ -z "${WAYLAND_DISPLAY:-}" ] && [ -z "${DISPLAY:-}" ]; then
    export WAYLAND_DISPLAY="wayland-1"
fi
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"
fi

log() {
    if [ "$DEBUG" = "1" ]; then
        echo "$(date '+%H:%M:%S') $*" >&2
    fi
}

# Extract SSID and Security from iwctl, stripping ANSI color codes.
get_ssid() {
    iwctl station wlan0 show 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | grep 'Connected network' | awk '{print $NF}' || true
}

get_security() {
    iwctl station wlan0 show 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | grep 'Security' | awk '{print $NF}' || true
}

handle_connected() {
    local ssid="$1"
    local security="$2"
    
    log "New connection detected: $ssid (Security: $security)"
    notify-send -u normal "Connected to ${ssid}" "Network security: $security" -i network-wireless 2>/dev/null || true
    
    # Allow time for DHCP lease acquisition before attempting captive routing.
    sleep 3
    
    # Only auto-launch on Open networks; PSK captive portals must be triggered manually.
    if [ "$security" = "Open" ]; then
        log "Open network detected, starting captive-browser immediately"
        notify-send -u normal "Captive Portal" "Opening sign-in page for ${ssid}" -i network-wireless 2>/dev/null || true
        captive-browser &
    elif [ "$security" = "WPA2-Personal" ] || [ "$security" = "WPA3-Personal" ] || [ "$security" = "WEP" ]; then
        log "PSK network. Skipping auto-captive-browser."
    fi
}

while true; do
    ssid=$(get_ssid)
    if [ -n "$ssid" ] && [ "$ssid" != "network" ] && [ "$ssid" != "$PREV_SSID" ]; then
        security=$(get_security)
        handle_connected "$ssid" "$security"
    fi
    PREV_SSID="$ssid"
    sleep "$CHECK_INTERVAL"
done
EOF
chmod +x "$HOME/.local/bin/impala-captive"

# Write the manual trigger CLI.
cat << 'EOF' > "$HOME/.local/bin/captive-now"
#!/usr/bin/env bash
notify-send -u normal "Captive Portal" "Manually opening captive-browser" -i network-wireless 2>/dev/null || true
captive-browser &
EOF
chmod +x "$HOME/.local/bin/captive-now"

# Register and enable the systemd user service.
cat << 'EOF' > "$HOME/.config/systemd/user/impala-captive.service"
[Unit]
Description=Impala Captive Portal Detection Daemon
After=network.target

[Service]
ExecStart=%h/.local/bin/impala-captive
Restart=always
RestartSec=3
Environment=WAYLAND_DISPLAY=wayland-1

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now impala-captive.service

echo "Setup complete!"
