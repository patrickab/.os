#!/usr/bin/env bash
# Set up and run a bidirectional Nextcloud sync with nextcloudcmd.
#
# Usage: nextcloud-sync.sh
set -euo pipefail
umask 077

SYNC_ROOT="$HOME/Nextcloud"
UNIT_DIR="$HOME/.config/systemd/user"
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"
EXCLUDE_FILE="$SCRIPT_DIR/nextcloud-sync.exclude"
SYNC_INTERVAL="${NEXTCLOUD_SYNC_INTERVAL:-5m}"

ok() { printf '[OK] %s\n' "$*"; }
die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

install_deps() {
    command -v nextcloudcmd >/dev/null && return

    if command -v pacman >/dev/null; then
        sudo pacman -S --needed --noconfirm nextcloud-client
    elif command -v apt >/dev/null; then
        sudo apt update
        sudo apt install -y --no-install-recommends nextcloud-desktop-cmd
    else
        die 'Install nextcloudcmd, then run this again.'
    fi
}

remote_dir() {
    local remote="${1#/}"
    [[ -z "$remote" ]] && { printf '%s' "$SYNC_ROOT"; return; }
    [[ "$remote" != *'..'* && "$remote" != *$'\n'* ]] || die 'Remote folder cannot contain .. or a newline.'
    printf '%s/%s' "$SYNC_ROOT" "$remote"
}

load_credentials() {
    [[ -n ${NEXTCLOUD_URL:-} && -n ${NEXTCLOUD_USER:-} && -n ${NEXTCLOUD_PASSWORD:-} && -n ${NEXTCLOUD_RSYNC:-} ]] \
        || die 'Set NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_PASSWORD, and NEXTCLOUD_RSYNC in Bitwarden.'
    [[ "$NEXTCLOUD_URL" == https://* ]] || die 'NEXTCLOUD_URL must use HTTPS.'
    NEXTCLOUD_URL="${NEXTCLOUD_URL%/}"
    NEXTCLOUD_RSYNC="/${NEXTCLOUD_RSYNC#/}"
    NEXTCLOUD_RSYNC="${NEXTCLOUD_RSYNC%/}"
    [[ "$NEXTCLOUD_RSYNC" != / ]] || die 'NEXTCLOUD_RSYNC must name a remote folder.'
}

import_credentials() {
    # User services inherit the user manager environment, not this shell. This
    # keeps the Bitwarden values in the manager rather than a plaintext file.
    systemctl --user import-environment NEXTCLOUD_URL NEXTCLOUD_USER NEXTCLOUD_PASSWORD NEXTCLOUD_RSYNC
}

install_units() {
    systemctl --user stop nextcloud-sync.timer 2>/dev/null || true
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT_DIR/nextcloud-sync.service" <<EOF
[Service]
Type=oneshot
PassEnvironment=NEXTCLOUD_URL NEXTCLOUD_USER NEXTCLOUD_PASSWORD NEXTCLOUD_RSYNC
ExecStart=${SCRIPT_PATH} --service
EOF
    cat > "$UNIT_DIR/nextcloud-sync.timer" <<EOF
[Timer]
OnUnitInactiveSec=${SYNC_INTERVAL}
AccuracySec=30s

[Install]
WantedBy=timers.target
EOF
    systemctl --user daemon-reload
    systemctl --user reset-failed nextcloud-sync.service
    systemctl --user enable --now nextcloud-sync.timer
}

sync() {
    local dir
    load_credentials
    [[ "$(nextcloudcmd --help 2>&1)" == *NC_PASSWORD* ]] \
        || die 'This nextcloudcmd is too old for environment-based authentication. Upgrade it first.'
    [[ -r "$EXCLUDE_FILE" ]] || die "Missing exclude list: $EXCLUDE_FILE"
    dir="$(remote_dir "$NEXTCLOUD_RSYNC")"
    mkdir -p "$dir"
    export NC_USER="$NEXTCLOUD_USER" NC_PASSWORD="$NEXTCLOUD_PASSWORD"
    nextcloudcmd --non-interactive --exclude "$EXCLUDE_FILE" --path "$NEXTCLOUD_RSYNC" "$dir" "$NEXTCLOUD_URL"
}

if [[ ${1:-} == --service ]]; then
    sync
elif [[ -z ${1:-} ]]; then
    install_deps
    load_credentials
    import_credentials
    install_units
    systemctl --user start nextcloud-sync.service
    ok "Setup complete. Sync repeats ${SYNC_INTERVAL} after each run."
else
    die "Unknown option: $1"
fi
