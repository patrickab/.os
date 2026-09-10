#!/usr/bin/env bash
# Set up and run a bidirectional Nextcloud sync with nextcloudcmd.
#
# Usage:
#   nextcloud-sync.sh --setup   configure once, then enable automatic sync
#   nextcloud-sync.sh --login   replace the saved login
#   nextcloud-sync.sh           run one sync now
set -euo pipefail
umask 077

CONF="$HOME/.config/nextcloud-sync.conf"
SYNC_ROOT="$HOME/Nextcloud"
UNIT_DIR="$HOME/.config/systemd/user"
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SYNC_INTERVAL="${NEXTCLOUD_SYNC_INTERVAL:-1s}"

info() { printf '[INFO] %s\n' "$*"; }
ok() { printf '[OK] %s\n' "$*"; }
die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

install_deps() {
    command -v nextcloudcmd >/dev/null && command -v curl >/dev/null && command -v jq >/dev/null && return

    if command -v pacman >/dev/null; then
        sudo pacman -S --needed --noconfirm nextcloud-client curl jq
    elif command -v apt >/dev/null; then
        sudo apt update
        sudo apt install -y --no-install-recommends nextcloud-desktop-cmd curl jq
    else
        die 'Install nextcloudcmd, curl, and jq, then run this again.'
    fi
}

remote_dir() {
    local remote="${1#/}"
    [[ -z "$remote" ]] && { printf '%s' "$SYNC_ROOT"; return; }
    [[ "$remote" != *'..'* && "$remote" != *$'\n'* ]] || die 'Remote folder cannot contain .. or a newline.'
    printf '%s/%s' "$SYNC_ROOT" "$remote"
}

login() {
    command -v nextcloudcmd >/dev/null || die 'nextcloudcmd is not installed.'
    [[ "$(nextcloudcmd --help 2>&1)" == *NC_PASSWORD* ]] \
        || die 'This nextcloudcmd is too old for this setup script. Upgrade the client first.'

    local url response token endpoint browser server user password remote dir
    read -rp 'Nextcloud URL (https://cloud.example.com): ' url
    [[ "$url" == https://* ]] || die 'Use an HTTPS URL.'
    url="${url%/}"

    response="$(curl -fsS -X POST "${url}/index.php/login/v2")" \
        || die "Could not start login at ${url}."
    token="$(jq -er '.poll.token' <<<"$response")"
    endpoint="$(jq -er '.poll.endpoint' <<<"$response")"
    browser="$(jq -er '.login' <<<"$response")"

    info "Approve this login in your browser: ${browser}"
    command -v xdg-open >/dev/null && xdg-open "$browser" >/dev/null 2>&1 || true
    while :; do
        response="$(curl -fsS -X POST --data-urlencode "token=$token" "$endpoint" 2>/dev/null || true)"
        [[ -n "$response" ]] && break
        sleep 2
    done

    server="$(jq -er '.server' <<<"$response")"
    user="$(jq -er '.loginName' <<<"$response")"
    password="$(jq -er '.appPassword' <<<"$response")"
    read -rp 'Remote folder to sync [/]: ' remote
    remote="/${remote#/}"
    remote="${remote%/}"
    [[ -n "$remote" ]] || remote=/
    dir="$(remote_dir "$remote")"
    mkdir -p "$(dirname "$CONF")"
    printf 'NEXTCLOUD_URL=%q\nNEXTCLOUD_USER=%q\nNEXTCLOUD_PASSWORD=%q\nNEXTCLOUD_REMOTE=%q\n' \
        "$server" "$user" "$password" "$remote" > "$CONF"
    ok "Saved ${server}${remote} -> ${dir}"
}

install_units() {
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT_DIR/nextcloud-sync.service" <<EOF
[Service]
Type=oneshot
ExecStart=${SCRIPT_PATH}
EOF
    cat > "$UNIT_DIR/nextcloud-sync.timer" <<EOF
[Timer]
OnUnitInactiveSec=${SYNC_INTERVAL}
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now nextcloud-sync.timer
}

sync() {
    [[ -f "$CONF" ]] || die "Run $0 --setup first."
    # shellcheck source=/dev/null
    source "$CONF"
    local dir
    dir="$(remote_dir "$NEXTCLOUD_REMOTE")"
    mkdir -p "$dir"
    export NC_USER="$NEXTCLOUD_USER" NC_PASSWORD="$NEXTCLOUD_PASSWORD"
    nextcloudcmd --non-interactive --path "$NEXTCLOUD_REMOTE" "$dir" "$NEXTCLOUD_URL"
}

case "${1:-}" in
    --setup)
        install_deps
        [[ -f "$CONF" ]] || login
        install_units
        systemctl --user start nextcloud-sync.service
        ok "Setup complete. Sync repeats ${SYNC_INTERVAL} after each run."
        ;;
    --login)
        install_deps
        login
        install_units
        systemctl --user start nextcloud-sync.service
        ok "Login updated. Sync repeats ${SYNC_INTERVAL} after each run."
        ;;
    '') sync ;;
    *) die "Unknown option: $1" ;;
esac
