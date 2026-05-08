#!/bin/bash
set -e

cd ~/.os

echo "==> Pulling latest config..."
git pull origin main 2>/dev/null || echo "(no git remote yet, skipping pull)"

if ! command -v chezmoi &> /dev/null; then
    echo "==> Installing chezmoi..."
    sudo sh -c "$(curl -fsLS get.chezmoi.io)" -- -b /usr/local/bin
fi

CHEZMOI_BIN="$(command -v chezmoi || true)"
if [ -z "$CHEZMOI_BIN" ] && [ -x "/usr/local/bin/chezmoi" ]; then
    CHEZMOI_BIN="/usr/local/bin/chezmoi"
fi

echo "==> Applying chezmoi dotfiles only (Lite Mode)..."
"$CHEZMOI_BIN" init --source ~/.os/chezmoi --working-tree ~/.os --apply

echo "==> Done."
