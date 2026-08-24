#!/bin/bash

# Re-apply personal customizations after an Omarchy update.
# Omarchy migrations force-overwrite some files (kitty.conf, etc).
# This hook patches Omarchy's deployed files idempotently.
# Files Omarchy owns and patches in place (kitty.conf) must stay out of
# chezmoi (see .chezmoiignore) -- `chezmoi apply` is a whole-file replace
# and would silently revert upstream improvements. tmux.conf is chezmoi-
# managed instead: setup-lite.sh captures Omarchy's copy back into the repo
# (see there) so the same file deploys on every OS.

set -euo pipefail

# 1. Deploy chezmoi-managed files (hypr/*.lua, kitty/personal.conf, etc).
#    Omarchy 4.0+ uses Lua for Hyprland config, which it only overwrites when
#    a file is still stock -- so bindings.lua/input.lua/monitors.lua/
#    looknfeel.lua/hyprland.lua are safe to track directly, no overlay dance.
chezmoi apply --source "$HOME/.os/chezmoi" || true

# 2. kitty.conf — ensure our personal include is present (idempotent).
#    Omarchy migrates kitty.conf on update, which strips the include line.
KITTY_CONF="$HOME/.config/kitty/kitty.conf"
if [[ -f "$KITTY_CONF" ]] && ! grep -q 'include .*personal\.conf' "$KITTY_CONF"; then
  echo "" >> "$KITTY_CONF"
  echo "# Personal overrides (later directives win)" >> "$KITTY_CONF"
  echo "include ~/.config/kitty/personal.conf" >> "$KITTY_CONF"
fi

# 3. hyprlock.conf — patch font_family to Thin Italic (idempotent).
#    hyprlock has no include directive for single lines, so we patch in place.
HYPRLLOCK_CONF="$HOME/.config/hypr/hyprlock.conf"
if [[ -f "$HYPRLLOCK_CONF" ]]; then
  sed -i 's|font_family = JetBrainsMono Nerd Font$|font_family = JetBrainsMono Nerd Font Thin Italic|' "$HYPRLLOCK_CONF"
fi

# 4. git config — add sshCommand (idempotent via git config --global).
git config --global core.sshCommand "ssh -o AddKeysToAgent=yes"

# 5. opencode.json — merge watcher.ignore into Omarchy's version (idempotent).
OPENCODE_CONF="$HOME/.config/opencode/opencode.json"
if [[ -f "$OPENCODE_CONF" ]] && command -v jq &>/dev/null; then
  tmp=$(mktemp)
  jq '.watcher.ignore = ((.watcher.ignore // []) + ["uv.lock"] | unique)' "$OPENCODE_CONF" > "$tmp" \
    && mv "$tmp" "$OPENCODE_CONF"
fi
