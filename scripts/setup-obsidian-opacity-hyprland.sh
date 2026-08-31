#!/bin/bash
# setup-obsidian-opacity-hyprland.sh
# Sets up the Obsidian-side CSS snippet for glassy transparency on Hyprland (Omarchy).
# Run again to re-apply after Obsidian updates reset appearance.json.
#
# The Hyprland-side windowrule and blur settings live directly in the
# chezmoi-managed ~/.config/hypr/hyprland.lua and looknfeel.lua (Omarchy 4.0+
# uses Lua config; there's no conf file left for this script to patch).
#
# Usage:
#   ./setup-obsidian-opacity-hyprland.sh                    # defaults, all known vaults
#   CSS_WINDOW_ALPHA_DARK=0.30 ./setup-obsidian-opacity-hyprland.sh  # custom values via env
#   OBSIDIAN_VAULTS="$HOME/vault-a:$HOME/vault-b" ./setup-obsidian-opacity-hyprland.sh  # explicit list

set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════
# Hyperparameters — override via env vars or edit below
# ═══════════════════════════════════════════════════════════════════════════

# ── Obsidian CSS background alpha (0.0 = fully see-through, 1.0 = solid)
CSS_WINDOW_ALPHA_DARK="${CSS_WINDOW_ALPHA_DARK:-0.35}"
CSS_WINDOW_ALPHA_LIGHT="${CSS_WINDOW_ALPHA_LIGHT:-0.35}"
CSS_MODAL_ALPHA_DARK="${CSS_MODAL_ALPHA_DARK:-0.92}"
CSS_MODAL_ALPHA_LIGHT="${CSS_MODAL_ALPHA_LIGHT:-0.92}"
CSS_MENU_ALPHA_DARK="${CSS_MENU_ALPHA_DARK:-0.92}"
CSS_MENU_ALPHA_LIGHT="${CSS_MENU_ALPHA_LIGHT:-0.92}"
CSS_INTERACTIVE_DARK="${CSS_INTERACTIVE_DARK:-0.50}"
CSS_INTERACTIVE_HOVER_DARK="${CSS_INTERACTIVE_HOVER_DARK:-0.35}"
CSS_INTERACTIVE_LIGHT="${CSS_INTERACTIVE_LIGHT:-0.50}"
CSS_INTERACTIVE_HOVER_LIGHT="${CSS_INTERACTIVE_HOVER_LIGHT:-0.35}"

# ═══════════════════════════════════════════════════════════════════════════

MASTER_CSS="$HOME/.config/obsidian-transparency/transparency.css"
FLATPAK_ID="md.obsidian.Obsidian"
FLATPAK_OBSIDIAN_JSON="$HOME/.var/app/$FLATPAK_ID/config/obsidian/obsidian.json"
NATIVE_OBSIDIAN_JSON="$HOME/.config/obsidian/obsidian.json"

echo "==> Setting up Obsidian blurry transparency on Hyprland"

# ── 1. Shared master CSS snippet ───────────────────────────────────────
echo "    Writing master CSS snippet to $MASTER_CSS"
mkdir -p "$(dirname "$MASTER_CSS")"
cat > "$MASTER_CSS" << CSSEOF
.theme-dark {
  --background-window: rgba(0,0,0,${CSS_WINDOW_ALPHA_DARK});
  --background-modal: rgba(30,30,30,${CSS_MODAL_ALPHA_DARK});
  --background-menu: rgba(0,0,0,${CSS_MENU_ALPHA_DARK});
  --text-primary: rgba(255,255,255,1);
  --text-secondary: rgba(255,255,255,0.68);
  --text-tertiary: rgba(255,255,255,0.42);
  --text-faint: rgba(255,255,255,0.25);
  --interactive-normal: rgba(0,0,0,${CSS_INTERACTIVE_DARK});
  --interactive-hover: rgba(0,0,0,${CSS_INTERACTIVE_HOVER_DARK});
}

.theme-light {
  --background-window: rgba(255,255,255,${CSS_WINDOW_ALPHA_LIGHT});
  --background-modal: rgba(246,246,246,${CSS_MODAL_ALPHA_LIGHT});
  --background-menu: rgba(255,255,255,${CSS_MENU_ALPHA_LIGHT});
  --text-primary: rgba(0,0,0,1);
  --text-secondary: rgba(0,0,0,0.68);
  --text-tertiary: rgba(0,0,0,0.42);
  --text-faint: rgba(0,0,0,0.25);
  --interactive-normal: rgba(255,255,255,${CSS_INTERACTIVE_LIGHT});
  --interactive-hover: rgba(255,255,255,${CSS_INTERACTIVE_HOVER_LIGHT});
}

.prompt-input::placeholder {
  color: var(--text-tertiary);
}

.app-container {
  background-color: var(--background-window) !important;
}

.theme-dark,
.theme-light {
  --background-primary: transparent !important;
  --background-primary-alt: transparent !important;
  --background-secondary: transparent !important;
  --background-secondary-alt: transparent !important;
  --workspace-background-translucent: transparent !important;
}

.modal,
.prompt,
.workspace-drawer .mod,
.workspace-drawer-inner {
  background-color: var(--background-modal) !important;
}

.menu,
.prompt-input-container:hover .prompt-input,
.subitem,
.x-color-picker-wrapper {
  background-color: var(--background-menu) !important;
}

.modal-container,
.modal-bg,
.modal-close-button,
.setting-item,
.vertical-tab-header,
.community-modal-details,
.suggestion-container,
.popover,
.workspace-leaf-content[data-type="search"] {
  background-color: var(--background-modal) !important;
}

.vertical-tab-content-container,
.setting-item-control {
  background-color: transparent !important;
}

.theme-dark,
.theme-light {
  --modal-background: var(--background-modal) !important;
  --modal-border-color: transparent !important;
  --prompt-background: var(--background-modal) !important;
  --menu-background: var(--background-menu) !important;
}
CSSEOF

# ── 2. Discover every vault Obsidian knows about ───────────────────────
declare -a VAULTS=()
if [[ -n "${OBSIDIAN_VAULTS:-}" ]]; then
  IFS=':' read -ra VAULTS <<< "$OBSIDIAN_VAULTS"
else
  for registry in "$FLATPAK_OBSIDIAN_JSON" "$NATIVE_OBSIDIAN_JSON"; do
    [[ -f "$registry" ]] || continue
    while IFS= read -r path; do
      VAULTS+=("$path")
    done < <(python3 -c "
import json
with open('$registry') as f:
    cfg = json.load(f)
for v in cfg.get('vaults', {}).values():
    print(v.get('path', ''))
" 2>/dev/null)
  done
fi

if [[ ${#VAULTS[@]} -eq 0 ]]; then
  echo "    ⚠ No vaults found in $FLATPAK_OBSIDIAN_JSON or $NATIVE_OBSIDIAN_JSON."
  echo "      Open each vault once in Obsidian first, or set OBSIDIAN_VAULTS=\"/path/a:/path/b\"."
  exit 1
fi

# ── 3. Apply the snippet to each vault ─────────────────────────────────
for VAULT in "${VAULTS[@]}"; do
  [[ -d "$VAULT" ]] || { echo "    ⚠ Skipping missing vault: $VAULT"; continue; }

  SNIPPETS_DIR="$VAULT/.obsidian/snippets"
  CSS_FILE="$SNIPPETS_DIR/transparency.css"
  APPEARANCE_FILE="$VAULT/.obsidian/appearance.json"

  echo "    Vault: $VAULT"
  mkdir -p "$SNIPPETS_DIR"
  ln -sf "$MASTER_CSS" "$CSS_FILE"

  if ! grep -q transparency "$APPEARANCE_FILE" 2>/dev/null; then
    if [[ -s "$APPEARANCE_FILE" ]] && [[ "$(cat "$APPEARANCE_FILE")" != "{}" ]]; then
      # Merge into existing JSON (naive but functional)
      python3 -c "
import json
with open('$APPEARANCE_FILE') as f:
    cfg = json.load(f)
snippets = cfg.get('enabledCssSnippets', [])
if 'transparency' not in snippets:
    snippets.insert(0, 'transparency')
cfg['enabledCssSnippets'] = snippets
with open('$APPEARANCE_FILE', 'w') as f:
    json.dump(cfg, f, indent=2)
"
    else
      cat > "$APPEARANCE_FILE" <<< '{
  "enabledCssSnippets": [
    "transparency"
  ]
}'
    fi
  fi
done

# ── 4. Flatpak Wayland override ────────────────────────────────────────
if command -v flatpak &>/dev/null && flatpak list 2>/dev/null | grep -q "$FLATPAK_ID"; then
  echo "    Enabling Wayland socket for $FLATPAK_ID"
  flatpak override --user "$FLATPAK_ID" \
    --socket=wayland \
    --env=ELECTRON_OZONE_PLATFORM_HINT=wayland
fi

# ── 5. Reload Hyprland ─────────────────────────────────────────────────
echo "    Reloading Hyprland config"
hyprctl reload 2>/dev/null || true
sleep 0.5
if hyprctl configerrors 2>&1 | grep -q .; then
  echo "    ⚠ Hyprland config has errors — check hyprctl configerrors"
fi

echo "==> Done. Restart Obsidian for all changes to take effect."
