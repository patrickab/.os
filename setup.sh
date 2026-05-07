#!/bin/bash
set -e

cd ~/.os
export PATH="$HOME/.local/bin:$PATH"

echo "==> Pulling latest config..."
git pull origin main 2>/dev/null || echo "(no git remote yet, skipping pull)"

if [ -f /etc/debian_version ]; then
    TARGET_OS="debian"
    echo "==> Detected Debian — installing prerequisites..."
    sudo apt update
    sudo apt install -y curl git python3-pip build-essential procps file
    pip3 install --user ansible
elif [ -f /etc/arch-release ]; then
    TARGET_OS="omarchy"
    echo "==> Detected Arch/Omarchy — installing prerequisites..."
    sudo pacman -Syu --noconfirm --needed ansible curl git flatpak base-devel procps-ng file ruby-erb
else
    echo "Unsupported OS"; exit 1
fi

if ! command -v chezmoi &> /dev/null; then
    echo "==> Installing chezmoi..."
    sudo sh -c "$(curl -fsLS get.chezmoi.io)" -- -b /usr/local/bin
fi

CHEZMOI_BIN="$(command -v chezmoi || true)"
if [ -z "$CHEZMOI_BIN" ] && [ -x "/usr/local/bin/chezmoi" ]; then
    CHEZMOI_BIN="/usr/local/bin/chezmoi"
fi

echo "==> Running Ansible playbook: ${TARGET_OS}.yaml"
ansible-playbook ~/.os/ansible/${TARGET_OS}.yaml --ask-become-pass

echo "==> Applying chezmoi dotfiles..."
"$CHEZMOI_BIN" init --source ~/.os/chezmoi --working-tree ~/.os --apply

echo "==> Done."
