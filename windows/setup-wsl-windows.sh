#!/usr/bin/env bash
# WSL only: set up the Windows desktop around WSL from ~/.os/windows/.
#   1. Installs komorebi + whkd (tiling), AutoHotkey, WezTerm, Claude Code, FFmpeg via winget
#   2. Copies the configs and helpers from ~/.os/windows/ into the Windows user profile
#      (komorebi.json, whkdrc, .wezterm.lua, helper scripts) and removes files of older versions
#   3. Fetches komorebi's per-app rules, enables autostart (komorebi + whkd, watchdog)
#   4. Starts whatever is not running and reloads what is (no komorebi restart)
# Safe to re-run any time: edit configs in ~/.os/windows/, then re-run. Usage: setup-wsl-windows.sh
#
# What runs on Windows afterwards:
#   komorebi + whkd          tiling + hotkeys (win+enter opens WezTerm via komorebi-terminal.ahk)
#   komorebi-watchdog.ahk    after dock/undock, unlock, resume: re-tiles lost windows and moves
#                            them back to their saved workspaces (komorebi-layout.ps1); restarts
#                            komorebi only when its monitor sizes are stale.
#   Logs: %LOCALAPPDATA%\komorebi\{watchdog,hotkeys}.log

set -euo pipefail

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

case "${1:-}" in
  "") ;;
  -h|--help) sed -n '2,14p' "$0" | sed 's/^# \?//'; exit 0 ;;
  *) red "Unknown argument: $1"; exit 1 ;;
esac

if ! grep -qi microsoft /proc/version 2>/dev/null; then
  red "Not running under WSL; nothing to do."
  exit 1
fi
DISTRO="${WSL_DISTRO_NAME:?WSL_DISTRO_NAME not set}"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"   # this script lives next to the configs
# cmd.exe can't use a \\wsl.localhost\ working directory (and winget list then fails)
cd /mnt/c

win_env() { cmd.exe /c "echo %$1%" 2>/dev/null | tr -d '\r'; }
WIN_HOME="$(wslpath -u "$(win_env USERPROFILE)")"
WIN_BIN="$WIN_HOME/.local/bin"
WIN_STARTUP="$(wslpath -u "$(win_env APPDATA)")/Microsoft/Windows/Start Menu/Programs/Startup"
AHK_EXE="$(win_env LOCALAPPDATA)\\Programs\\AutoHotkey\\v2\\AutoHotkey64.exe"

ps() { powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$1" | tr -d '\r'; }
running() { tasklist.exe /FI "IMAGENAME eq $1" /NH 2>/dev/null | grep -qi "$1"; }
# Stop AutoHotkey instances whose command line matches $1
stop_ahk() {
  ps "Get-CimInstance Win32_Process -Filter \"Name like 'AutoHotkey%'\" | Where-Object CommandLine -match '$1' | Invoke-CimMethod -MethodName Terminate | Out-Null"
}

echo "==> Installing Windows apps via winget..."
for package_id in LGUG2Z.komorebi LGUG2Z.whkd AutoHotkey.AutoHotkey wez.wezterm Anthropic.ClaudeCode Gyan.FFmpeg; do
  if cmd.exe /c winget list --id "$package_id" -e --accept-source-agreements >/dev/null 2>&1; then
    green "  $package_id already installed"
  else
    cmd.exe /c winget install --id "$package_id" -e --silent \
      --accept-package-agreements --accept-source-agreements | tr -d '\r'
  fi
done

echo "==> Copying configs from $SOURCE_DIR..."
mkdir -p "$WIN_HOME/.config" "$WIN_BIN"
whkdrc_changed=0
cmp -s "$SOURCE_DIR/whkdrc" "$WIN_HOME/.config/whkdrc" || whkdrc_changed=1
install -m 644 "$SOURCE_DIR/komorebi.json"         "$WIN_HOME/komorebi.json"
install -m 644 "$SOURCE_DIR/whkdrc"                "$WIN_HOME/.config/whkdrc"
install -m 644 "$SOURCE_DIR/komorebi-terminal.ahk" "$WIN_BIN/komorebi-terminal.ahk"
install -m 644 "$SOURCE_DIR/komorebi-watchdog.ahk" "$WIN_BIN/komorebi-watchdog.ahk"
install -m 644 "$SOURCE_DIR/komorebi-layout.ps1"   "$WIN_BIN/komorebi-layout.ps1"
# Batch files need CRLF line endings, or cmd misparses blocks
for f in komorebi-smart-group.cmd komorebi-cycle-stack.cmd; do
  sed 's/\r*$/\r/' "$SOURCE_DIR/$f" >"$WIN_BIN/$f"
done
# WezTerm opens straight into this distro
sed "s/'WSL:[^']*'/'WSL:$DISTRO'/" "$SOURCE_DIR/wezterm.lua" >"$WIN_HOME/.wezterm.lua"
green "  Copied to $WIN_HOME"

echo "==> Removing files of older versions..."
# win+enter used to be an AutoHotkey hotkey; whkd swallows that combo, so whkd handles it now
stop_ahk 'kitty-hotkey|terminal-hotkey'
rm -f "$WIN_STARTUP/kitty-hotkey.ahk" "$WIN_STARTUP/terminal-hotkey.ahk" \
      "$WIN_BIN/komorebi-smart-group.ps1"

echo "==> Configuring komorebi..."
# Windows-side user env var: komorebi reads komorebi.json from the user profile
ps "[Environment]::SetEnvironmentVariable('KOMOREBI_CONFIG_HOME', \$env:USERPROFILE, 'User')"
komorebic.exe fetch-asc | tr -d '\r' | head -1
komorebic.exe enable-autostart --whkd | tr -d '\r'
ps "\$s = (New-Object -ComObject WScript.Shell).CreateShortcut('$(wslpath -w "$WIN_STARTUP")\\komorebi-watchdog.lnk'); \$s.TargetPath = '$(wslpath -w "$WIN_BIN/komorebi-watchdog.ahk")'; \$s.Save()"
green "  Autostart: komorebi + whkd, komorebi-watchdog"

echo "==> Starting / reloading..."
if running komorebi.exe; then
  if komorebic.exe reload-configuration >/dev/null 2>&1; then
    green "  komorebi: configuration reloaded"
  else
    yellow "  komorebi: could not reach it to reload; run 'komorebic reload-configuration' on Windows"
  fi
else
  ps "Start-Process komorebic.exe -ArgumentList 'start','--whkd' -WindowStyle Hidden"
  green "  komorebi: started"
fi
if running whkd.exe && [[ "$whkdrc_changed" -eq 0 ]]; then
  green "  whkd: running, whkdrc unchanged"
else
  taskkill.exe /IM whkd.exe /F >/dev/null 2>&1 || true
  ps "Start-Process whkd.exe -WindowStyle Hidden"
  green "  whkd: started"
fi
# #SingleInstance Force: replaces a running watchdog with the new version
ps "Start-Process '$AHK_EXE' -ArgumentList '\"$(wslpath -w "$WIN_BIN/komorebi-watchdog.ahk")\"'"
green "  komorebi-watchdog: (re)started"

green "==> Done."
