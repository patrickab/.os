#!/usr/bin/env bash
# Installs one embedded SSH key and configures a persistent user ssh-agent.
# Intended for systemd-based Arch, Debian, Fedora, and derivative systems.
#
# Security: this file contains the private key after you fill it in. Keep it
# private, never commit it, and remove the key text after running if possible.

set -euo pipefail

# Edit these values before running the script.
KEY_NAME="id_ed25519"
HOST_PATTERNS="*" # Example: "github.com git.work.example"

PRIVATE_KEY=$(cat <<'PRIVATE_KEY_EOF'
PASTE_PRIVATE_KEY_HERE
PRIVATE_KEY_EOF
)

PUBLIC_KEY=$(cat <<'PUBLIC_KEY_EOF'
PASTE_PUBLIC_KEY_HERE
PUBLIC_KEY_EOF
)

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

[[ "$KEY_NAME" =~ ^[A-Za-z0-9._-]+$ ]] || fail "KEY_NAME may contain only letters, numbers, dots, underscores, and hyphens"
[[ "$PRIVATE_KEY" != "PASTE_PRIVATE_KEY_HERE" ]] || fail "paste the private key into PRIVATE_KEY"
[[ "$PUBLIC_KEY" != "PASTE_PUBLIC_KEY_HERE" ]] || fail "paste the public key into PUBLIC_KEY"
command -v ssh-add >/dev/null 2>&1 || fail "OpenSSH client tools are not installed"
command -v systemctl >/dev/null 2>&1 || fail "systemd is required"

SSH_DIR="$HOME/.ssh"
CONFIG_DIR="$SSH_DIR/config.d"
KEY_PATH="$SSH_DIR/$KEY_NAME"
PUBLIC_KEY_PATH="$KEY_PATH.pub"
AGENT_SOCKET="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/ssh-agent.socket"
UNIT_DIR="$HOME/.config/systemd/user"

umask 077
mkdir -p "$SSH_DIR" "$CONFIG_DIR" "$UNIT_DIR"
chmod 700 "$SSH_DIR" "$CONFIG_DIR"

printf '%s\n' "$PRIVATE_KEY" > "$KEY_PATH"
printf '%s\n' "$PUBLIC_KEY" > "$PUBLIC_KEY_PATH"
chmod 600 "$KEY_PATH"
chmod 644 "$PUBLIC_KEY_PATH"

cat > "$CONFIG_DIR/$KEY_NAME.conf" <<EOF
Host $HOST_PATTERNS
    AddKeysToAgent yes
    IdentityFile ~/.ssh/$KEY_NAME
EOF
chmod 600 "$CONFIG_DIR/$KEY_NAME.conf"

touch "$SSH_DIR/config"
chmod 600 "$SSH_DIR/config"
include_found=false
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" == "Include config.d/*" ]] && include_found=true
done < "$SSH_DIR/config"
if [[ "$include_found" == false ]]; then
  config_tmp=$(mktemp)
  printf 'Include config.d/*\n\n' > "$config_tmp"
  cat "$SSH_DIR/config" >> "$config_tmp"
  mv "$config_tmp" "$SSH_DIR/config"
  chmod 600 "$SSH_DIR/config"
fi

cat > "$UNIT_DIR/ssh-agent.service" <<'EOF'
[Unit]
Description=OpenSSH authentication agent

[Service]
Type=simple
Environment=SSH_AUTH_SOCK=%t/ssh-agent.socket
ExecStart=/usr/bin/ssh-agent -D -a %t/ssh-agent.socket

[Install]
WantedBy=default.target
EOF
chmod 600 "$UNIT_DIR/ssh-agent.service"

systemctl --user daemon-reload
systemctl --user enable --now ssh-agent.service
SSH_AUTH_SOCK="$AGENT_SOCKET" ssh-add "$KEY_PATH"

printf 'Installed SSH key: %s\n' "$KEY_PATH"
printf 'Configured hosts: %s\n' "$HOST_PATTERNS"
printf 'Open a new shell before using the key from another process.\n'
