#!/usr/bin/env bash
set -euo pipefail

RCLONE_REMOTE_NAME="nextcloud"
SYNC_DIR="$HOME/Nextcloud"
CONFIG_FILE="$HOME/.config/rclone/rclone.conf"

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

# ── Check/install rclone ──
if ! command -v rclone &>/dev/null; then
    echo "rclone is required but not installed."
    read -rp "Install rclone now? [Y/n] " ans
    if [[ "$ans" =~ ^[Nn] ]]; then
        err "rclone is required. Exiting."
        exit 1
    fi

    if command -v apt &>/dev/null; then
        sudo apt update && sudo apt install -y rclone
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm rclone
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y rclone
    elif command -v brew &>/dev/null; then
        brew install rclone
    elif command -v zypper &>/dev/null; then
        sudo zypper install -y rclone
    else
        err "Could not detect package manager. Install rclone manually: https://rclone.org/install/"
        exit 1
    fi

    if ! command -v rclone &>/dev/null; then
        err "rclone installation failed."
        exit 1
    fi
    ok "rclone installed."
fi

mkdir -p "$SYNC_DIR" "$(dirname "$CONFIG_FILE")"

# ── Configure Nextcloud remote ──
if rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE_NAME}:"; then
    info "Remote '${RCLONE_REMOTE_NAME}' already configured."
else
    echo ""
    info "── Configuring Nextcloud remote ──"
    echo ""

    read -rp "Nextcloud URL (e.g. https://cloud.example.com): " NC_URL
    read -rp "Username: " NC_USER
    read -rsp "Password (input hidden): " NC_PASS
    echo ""

    if [[ -z "$NC_URL" || -z "$NC_USER" || -z "$NC_PASS" ]]; then
        err "All fields are required."
        exit 1
    fi

    # Remove trailing slash for consistency
    NC_URL="${NC_URL%/}"

    # Nextcloud WebDAV endpoint: /remote.php/dav/files/<USER>/
    WEBDAV_URL="${NC_URL}/remote.php/dav/files/${NC_USER}/"

    info "Trying WebDAV endpoint: $WEBDAV_URL"

    rclone config create "$RCLONE_REMOTE_NAME" webdav \
        url="$WEBDAV_URL" \
        vendor="nextcloud" \
        user="$NC_USER" \
        pass="$(rclone obscure "$NC_PASS")" 2>/dev/null || {
        info "Config create failed, trying rclone interactive fallback..."
        {
            echo "n"
            echo "$RCLONE_REMOTE_NAME"
            echo "webdav"
            echo "$WEBDAV_URL"
            echo "nextcloud"
            echo "$NC_USER"
            echo "$NC_PASS"
            echo "$NC_PASS"
            echo "n"
            echo "y"
            echo "q"
        } | rclone config 2>/dev/null
    }

    # Verify connection — show actual error if it fails
    CONN_OUTPUT="$(rclone lsd "${RCLONE_REMOTE_NAME}:" 2>&1)"
    if [[ $? -ne 0 ]]; then
        err "Failed to connect to Nextcloud."
        echo "Error details:"
        echo "$CONN_OUTPUT" | head -10
        err "Deleting broken config so you can retry."
        rclone config delete "$RCLONE_REMOTE_NAME" 2>/dev/null
        exit 1
    fi
    ok "Connected to Nextcloud at $NC_URL"
fi

# ── List and select folders ──
echo ""
info "── Fetching folder list from Nextcloud ──"
echo ""

FOLDERS_OUTPUT="$(rclone lsd "${RCLONE_REMOTE_NAME}:" 2>&1)"
RC=$?

mapfile -t FOLDERS < <(echo "$FOLDERS_OUTPUT" | awk '{for(i=1;i<=4;i++) $i=""; gsub(/^[[:space:]]+/,""); print}' | sort)

if [[ ${#FOLDERS[@]} -eq 0 ]]; then
    err "No folders found on Nextcloud."
    if [[ $RC -ne 0 ]]; then
        echo "rclone error:"
        echo "$FOLDERS_OUTPUT" | head -10
    fi
    exit 1
fi

echo "Available folders on Nextcloud:"
for i in "${!FOLDERS[@]}"; do
    printf "  %2d) %s\n" $((i + 1)) "${FOLDERS[$i]}"
done
echo ""

echo "Enter folder numbers to sync (space-separated, e.g. 1 3 5)"
echo "Type 'all' to sync everything, or press Enter to skip."
read -rp "Selection: " SELECTION

SELECTED=()
if [[ "$SELECTION" == "all" ]]; then
    SELECTED=("${FOLDERS[@]}")
elif [[ -n "$SELECTION" ]]; then
    for num in $SELECTION; do
        idx=$((num - 1))
        if [[ $idx -ge 0 && $idx -lt ${#FOLDERS[@]} ]]; then
            SELECTED+=("${FOLDERS[$idx]}")
        else
            warn "Invalid selection: $num (skipped)"
        fi
    done
else
    err "No folders selected. Exiting."
    exit 0
fi

if [[ ${#SELECTED[@]} -eq 0 ]]; then
    err "No valid folders selected. Exiting."
    exit 1
fi

echo ""
info "Selected folders: ${SELECTED[*]}"

# ── Choose sync direction ──
echo ""
echo "Sync direction:"
echo "  1) Download only (one-way: cloud -> local)"
echo "  2) Bidirectional sync (cloud <-> local, keep both in sync)"
read -rp "Choice [1] " SYNC_CHOICE
SYNC_CHOICE="${SYNC_CHOICE:-1}"

# ── Perform sync ──
echo ""

sync_folder() {
    local folder="$1"
    local remote="${RCLONE_REMOTE_NAME}:${folder}"
    local local_path="${SYNC_DIR}/${folder}"

    mkdir -p "$local_path"

    info "Syncing: $remote -> $local_path"

    if [[ "$SYNC_CHOICE" == "2" ]]; then
        rclone bisync "$remote" "$local_path" \
            --resync --progress
    else
        rclone sync "$remote" "$local_path" \
            --create-empty-src-dirs --progress
    fi

    local rc=$?
    if [[ $rc -eq 0 ]]; then
        ok "Synced: $folder"
    else
        warn "Sync for '$folder' exited with code $rc"
    fi
}

for folder in "${SELECTED[@]}"; do
    sync_folder "$folder"
done

echo ""
info "── Done ──"
echo "Your Nextcloud files are in: $SYNC_DIR"
echo ""
echo "Tip: Re-run this script anytime to sync. Add to cron for periodic sync:"
echo "  crontab -e"
echo "  0 */4 * * * $0"
