#!/usr/bin/env bash
# Flash the hidden groupbar after cycling or joining a group.
# A token file debounces delayed hides during rapid presses.
set -euo pipefail

STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}"
TOKEN_FILE="$STATE_DIR/hypr-groupbar-flash.token"
HIDE_DELAY=1.6

# Lua configs require `hyprctl eval`; `keyword` supports legacy parsers only.
token=$(date +%s%N)
echo "$token" >"$TOKEN_FILE"

# Toggle a transparent border to force Hyprland to rebuild the bar background.
if [ $((token % 2)) -eq 0 ]; then poke=00000000; else poke=01010100; fi
hyprctl eval "hl.config({ group = {
  groupbar = { enabled = true },
  col = { border_active = \"rgba($poke)\", border_inactive = \"rgba($poke)\" },
} })" >/dev/null

(
  sleep "$HIDE_DELAY"
  if [ "$(cat "$TOKEN_FILE" 2>/dev/null || true)" = "$token" ]; then
    hyprctl eval 'hl.config({ group = { groupbar = { enabled = false } } })' >/dev/null
  fi
) & disown
