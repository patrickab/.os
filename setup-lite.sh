#!/bin/bash
set -e

cd ~/.os

echo "==> Pulling latest config..."
git pull origin main 2>/dev/null || echo "(no git remote yet, skipping pull)"

if ! command -v chezmoi &>/dev/null; then
  echo "==> Installing chezmoi..."
  sudo sh -c "$(curl -fsLS get.chezmoi.io)" -- -b /usr/local/bin
fi

CHEZMOI_BIN="$(command -v chezmoi || true)"
if [ -z "$CHEZMOI_BIN" ] && [ -x "/usr/local/bin/chezmoi" ]; then
  CHEZMOI_BIN="/usr/local/bin/chezmoi"
fi

# On Omarchy, tmux.conf is owned by Omarchy and patched in place on update
# (see the reapply-chezmoi-overlays.sh hook). Capture that authoritative copy
# back into the repo before applying, so the exact same tmux.conf -- Omarchy's
# base plus our personal.conf override -- gets deployed on every OS via
# chezmoi, with no per-OS patching needed.
if command -v omarchy &>/dev/null; then
  TMUX_CONF="$HOME/.config/tmux/tmux.conf"
  if [ -f "$TMUX_CONF" ]; then
    if ! grep -q 'source-file .*tmux/personal\.conf' "$TMUX_CONF"; then
      echo "" >> "$TMUX_CONF"
      echo "# Personal overrides (later directives win)" >> "$TMUX_CONF"
      echo "source-file -q ~/.config/tmux/personal.conf" >> "$TMUX_CONF"
    fi
    echo "==> Writing Omarchy's tmux.conf back into the repo..."
    cp "$TMUX_CONF" ~/.os/chezmoi/dot_config/tmux/tmux.conf
  fi
fi

echo "==> Applying chezmoi dotfiles (Lite Mode)..."
"$CHEZMOI_BIN" init --source ~/.os/chezmoi --apply

# Seed ~/.os/assets wallpapers into every installed theme's backgrounds dir,
# so they're available as a background choice regardless of the active theme.
# The theme-set.d hook (deployed above) keeps covering themes switched to
# later; this just backfills themes that are already installed right now.
if command -v omarchy &>/dev/null; then
  SYNC_HOOK="$HOME/.config/omarchy/hooks/theme-set.d/sync-asset-backgrounds.sh"
  if [ -x "$SYNC_HOOK" ]; then
    echo "==> Syncing ~/.os/assets wallpapers into installed themes..."
    for theme_dir in /usr/share/omarchy/themes/*/ "$HOME/.config/omarchy/themes"/*/; do
      [ -d "$theme_dir" ] || continue
      "$SYNC_HOOK" "$(basename "$theme_dir")"
    done
  fi
fi

# Enable and start the auto-apply watcher so future edits to ~/.os/chezmoi/
# take effect without re-running this script. Reloading every time also
# recovers an enabled-but-stopped unit after a failed earlier run.
echo "==> Enabling chezmoi auto-apply watcher..."
systemctl --user daemon-reload
systemctl --user enable --now chezmoi-watch.path

echo "==> Done."
