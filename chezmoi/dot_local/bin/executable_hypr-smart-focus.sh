#!/usr/bin/env bash
# Unify movefocus and group-cycling (Pop!_OS style), split by axis to match
# how a group actually reads on screen (a horizontal tab strip):
# - Left/Right: grouped -> cycle tabs, but don't wrap past the first/last tab;
#   at the edge tab, fall through to real movefocus to escape the group.
#   Otherwise (not grouped) -> real movefocus.
# - Up/Down: always real movefocus, regardless of grouping, so a group never
#   blocks reaching a genuinely different tile above/below it.
# movefocus is gated on an actual geometric neighbor existing in that
# direction, since Hyprland's own movefocus otherwise falls back to an
# unrelated window when the exact direction is empty.
set -euo pipefail

dir="$1"

active=$(hyprctl activewindow -j)
grouped_count=$(echo "$active" | jq '.grouped | length')

if [ "$grouped_count" -gt 1 ] && { [ "$dir" = "l" ] || [ "$dir" = "r" ]; }; then
  addr=$(echo "$active" | jq -r '.address')
  idx=$(echo "$active" | jq --arg addr "$addr" '.grouped | index($addr)')
  last=$((grouped_count - 1))
  if [ "$dir" = "r" ] && [ "$idx" -lt "$last" ]; then
    hyprctl dispatch "hl.dsp.group.next()"
    exit 0
  elif [ "$dir" = "l" ] && [ "$idx" -gt 0 ]; then
    hyprctl dispatch "hl.dsp.group.prev()"
    exit 0
  fi
  # else: already on the edge tab in that direction -> fall through to movefocus
fi

addr=$(echo "$active" | jq -r '.address')
ws=$(echo "$active" | jq '.workspace.id')

has_neighbor=$(hyprctl clients -j | jq --arg addr "$addr" --argjson ws "$ws" --arg dir "$dir" --argjson a "$active" '
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
')

if [ "$has_neighbor" = "true" ]; then
  hyprctl dispatch "hl.dsp.focus({direction = \"$dir\"})"
fi
