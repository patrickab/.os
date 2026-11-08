#!/usr/bin/env bash
# Keeps the Hyprland groupbar's colors matching the active Omarchy theme, so
# a grouped window's tab strip reads as a continuation of the top bar rather
# than a separate overlay. Called by the theme-set hook (`omarchy theme
# set`) and post-boot hook (cold starts) in dot_config/omarchy/hooks/*.d/.
set -euo pipefail

COLORS="$HOME/.local/state/omarchy/current/theme/colors.toml"
[ -f "$COLORS" ] || exit 0

bg=$(sed -n 's/^background = "#\(......\)"/\1/p' "$COLORS" | head -1)
fg=$(sed -n 's/^foreground = "#\(......\)"/\1/p' "$COLORS" | head -1)
[ -n "$bg" ] && [ -n "$fg" ] || exit 0

# Active tab title: the top bar's own text color, so the two read the same.
# `text` under [bar] in shell.toml ([bar] active is the alert color, not this);
# fall back to colors.toml foreground.
SHELL_TOML="$HOME/.local/state/omarchy/current/theme/shell.toml"
hi=$(awk '/^\[bar\]/{b=1;next} /^\[/{b=0} b' "$SHELL_TOML" 2>/dev/null |
  sed -n 's/^text *= *"#\(......\)".*/\1/p' | head -1)
[ -n "$hi" ] || hi=$fg
# Inactive tab title: a dimmer solid color rather than an alpha, so the bar
# stays fully opaque.
dim=$(sed -n 's/^dark_foreground = "#\(......\)"/\1/p' "$COLORS" | head -1)
[ -n "$dim" ] || dim=$(sed -n 's/^muted = "#\(......\)"/\1/p' "$COLORS" | head -1)
[ -n "$dim" ] || dim=$fg

# This config uses Hyprland's Lua backend - `hyprctl keyword` only works
# with the legacy parser, so use `hyprctl eval` + hl.config() instead (same
# as hypr-groupbar-flash.sh).
# Only the colors here; the repaint that makes them take effect is forced by
# hypr-groupbar-flash.sh, which is the only thing that ever shows the bar.
hyprctl eval "hl.config({ group = { groupbar = {
  blur = true,
  col = {
    active = \"rgba(${bg}ff)\",
    inactive = \"rgba(${bg}ff)\",
  },
  text_color = \"rgba(${hi}ff)\",
  text_color_inactive = \"rgba(${dim}ff)\",
} } })" >/dev/null
