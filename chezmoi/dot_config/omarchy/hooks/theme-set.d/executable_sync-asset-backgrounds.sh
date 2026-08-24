#!/bin/bash

# Make every image in ~/.os/assets available as a background choice for
# whichever theme is active. Omarchy's own bg cycling (omarchy-theme-bg-next)
# only scans ~/.config/omarchy/backgrounds/<theme-slug>/, so the assets are
# copied in per-theme rather than to one shared location.

set -euo pipefail

THEME_SLUG="${1:?usage: sync-asset-backgrounds.sh <theme-slug>}"
ASSETS_DIR="$HOME/.os/assets"
DEST_DIR="$HOME/.config/omarchy/backgrounds/$THEME_SLUG"

[[ -d $ASSETS_DIR ]] || exit 0

mkdir -p "$DEST_DIR"
find "$ASSETS_DIR" -maxdepth 1 -type f \
  \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.gif' -o -iname '*.bmp' -o -iname '*.webp' \) \
  -exec cp -f {} "$DEST_DIR/" \;
