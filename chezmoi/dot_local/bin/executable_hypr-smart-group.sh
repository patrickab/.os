#!/usr/bin/env bash
# SUPER+SHIFT+arrow: unify group join/eject on one key (Pop!_OS style).
# If the active window is grouped, eject it in the pressed direction.
# Otherwise, merge it into whatever's in that direction.
#
# Hyprland's moveoutofgroup has no direction argument and lands the ejected
# window wherever its tree default puts it (empirically inconsistent - left
# or right depending on prior layout history, not the key you pressed), and
# the resulting split can be on the wrong axis entirely (e.g. left/right when
# you pressed Down). So after ejecting:
#   1. Check if a sibling exists anywhere on the requested axis (either side).
#      If not, the split is on the wrong axis - layoutmsg togglesplit (same
#      dispatcher behind SUPER+J) flips that node's orientation.
#   2. Check if a sibling now sits specifically in the pressed direction.
#      If so, swapwindow flips the two into place (a pure position exchange,
#      unlike movewindow which can re-merge two windows back into a group).
#      If not, we're already on that edge - nothing to do.
set -euo pipefail

dir="$1"

has_neighbor() {
  local check_dir="$1"
  local active addr ws
  active=$(hyprctl activewindow -j)
  addr=$(echo "$active" | jq -r '.address')
  ws=$(echo "$active" | jq '.workspace.id')

  hyprctl clients -j | jq --arg addr "$addr" --argjson ws "$ws" --arg dir "$check_dir" --argjson a "$active" '
    ($a.at[0]) as $ax
    | ($a.at[1]) as $ay
    | ($ax + $a.size[0]) as $ax2
    | ($ay + $a.size[1]) as $ay2
    | [ .[] | select(.address != $addr and .mapped and (.floating|not) and .workspace.id == $ws) ] as $cands
    | any($cands[];
        (.at[0]) as $cx | (.at[1]) as $cy | ($cx + .size[0]) as $cx2 | ($cy + .size[1]) as $cy2 |
        if $dir == "r" then ($cx >= $ax2) and ($ay < $cy2) and ($cy < $ay2)
        elif $dir == "l" then ($cx2 <= $ax) and ($ay < $cy2) and ($cy < $ay2)
        elif $dir == "d" then ($cy >= $ay2) and ($ax < $cx2) and ($cx < $ax2)
        else ($cy2 <= $ay) and ($ax < $cx2) and ($cx < $ax2)
        end
      )
  '
}

same_axis_has_neighbor() {
  case "$dir" in
    l|r) [ "$(has_neighbor l)" = "true" ] || [ "$(has_neighbor r)" = "true" ] ;;
    u|d) [ "$(has_neighbor u)" = "true" ] || [ "$(has_neighbor d)" = "true" ] ;;
  esac
}

grouped_count=$(hyprctl activewindow -j | jq '.grouped | length')

if [ "$grouped_count" -gt 1 ]; then
  hyprctl dispatch moveoutofgroup

  if ! same_axis_has_neighbor; then
    hyprctl dispatch layoutmsg togglesplit
  fi

  if [ "$(has_neighbor "$dir")" = "true" ]; then
    hyprctl dispatch swapwindow "$dir"
  fi
else
  hyprctl dispatch moveintogroup "$dir"
fi
