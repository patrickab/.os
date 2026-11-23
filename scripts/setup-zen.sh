#!/usr/bin/env bash
# Opt-in Zen browser setup: install Zen, make it the default browser, and
# disable Local Network Access blocking (lets public sites such as
# gigachad-bot on Vercel call Tailnet addresses).
#
# Omarchy: native AUR package via `omarchy`. WSL: Windows Zen via winget. Elsewhere: Flatpak.
# Usage: setup-zen.sh
# Run as normal user; sudo will be prompted as needed.

set -euo pipefail

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

case "${1:-}" in
  "") ;;
  -h|--help) sed -n '2,8p' "$0" | sed 's/^# \?//'; exit 0 ;;
  *) red "Unknown argument: $1"; exit 1 ;;
esac

FLATPAK_ID="app.zen_browser.zen"
WIN_ZEN_DIR=""

if grep -qi microsoft /proc/version 2>/dev/null; then
  # WSL: Zen runs on Windows, so install and patch the Windows build
  if cmd.exe /c winget list --id Zen-Team.Zen-Browser -e --accept-source-agreements >/dev/null 2>&1; then
    green "Windows Zen already installed."
  else
    echo "==> Installing Windows Zen via winget..."
    cmd.exe /c winget install --id Zen-Team.Zen-Browser -e --silent \
      --accept-package-agreements --accept-source-agreements | tr -d '\r'
  fi
  WIN_ZEN_DIR="$(wslpath -u "$(cmd.exe /c 'echo %APPDATA%' 2>/dev/null | tr -d '\r')")/zen/Profiles"
  DESKTOP_FILE="Windows Zen (set it as default in Windows Settings > Default apps)"
elif command -v omarchy &>/dev/null; then
  echo "==> Installing native Zen via omarchy (AUR: zen-browser-bin)..."
  omarchy pkg aur add zen-browser-bin

  echo "==> Setting Zen as the default browser..."
  omarchy default browser zen
  DESKTOP_FILE="zen.desktop"
else
  if ! command -v flatpak &>/dev/null; then
    red "Error: flatpak is not installed. Run the Ansible playbook first."
    exit 1
  fi

  echo "==> Ensuring Flathub remote exists..."
  sudo flatpak remote-add --system --if-not-exists flathub \
    https://dl.flathub.org/repo/flathub.flatpakrepo

  if flatpak info "$FLATPAK_ID" &>/dev/null; then
    green "Zen Flatpak already installed."
  else
    echo "==> Installing Zen Flatpak ($FLATPAK_ID)..."
    sudo flatpak install --system -y flathub "$FLATPAK_ID"
  fi
  DESKTOP_FILE="$FLATPAK_ID.desktop"

  echo "==> Setting Zen as the default browser..."
  if command -v xdg-settings &>/dev/null; then
    xdg-settings set default-web-browser "$DESKTOP_FILE"
  else
    yellow "xdg-settings not found; falling back to xdg-mime."
  fi
  if command -v xdg-mime &>/dev/null; then
    for mime in x-scheme-handler/http x-scheme-handler/https text/html \
                application/xhtml+xml; do
      xdg-mime default "$DESKTOP_FILE" "$mime"
    done
  else
    yellow "xdg-mime not found; set the default browser manually."
  fi
fi

echo "==> Setting prefs in Zen profiles..."
# network.lna.enabled: no Local Network Access blocking
# zen.view.grey-out-inactive-windows: unfocused windows stay normal (looks off when tiled)
PREFS=(network.lna.enabled zen.view.grey-out-inactive-windows)
found=0
for base in \
  "$HOME/.config/zen" \
  "$HOME/.zen" \
  "$HOME/.var/app/$FLATPAK_ID/config/zen" \
  "$HOME/.var/app/$FLATPAK_ID/.zen" \
  ${WIN_ZEN_DIR:+"$WIN_ZEN_DIR"}; do
  [[ -d "$base" ]] || continue
  # Profile dirs are named <random>.<name>, e.g. abcd1234.Default (release)
  for profile in "$base"/*.*/; do
    [[ -d "$profile" ]] || continue
    found=1
    userjs="${profile%/}/user.js"
    touch "$userjs"
    for name in "${PREFS[@]}"; do
      pref="user_pref(\"$name\", false);"
      if grep -qF "\"$name\"" "$userjs"; then
        sed -i "s|^.*\"${name//./\\.}\".*$|$pref|" "$userjs"
      else
        printf '%s\n' "$pref" >>"$userjs"
      fi
    done
    echo "  $userjs"
  done
done
if [[ "$found" -eq 0 ]]; then
  yellow "No Zen profile yet. Launch Zen once, then re-run this script to apply the prefs."
fi

green "==> Zen setup complete (default browser: $DESKTOP_FILE)."
