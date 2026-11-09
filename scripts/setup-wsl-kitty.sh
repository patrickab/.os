#!/usr/bin/env bash
# WSL only: launch WSL straight into kitty (via WSLg) instead of Windows Terminal.
#   1. Creates ~/.config/kitty/kitty.conf including personal.conf if missing
#      (on Omarchy, Omarchy's kitty.conf does that include)
#   2. Adds a "Kitty (WSL)" shortcut to the Start menu and Desktop that runs
#      wslg.exe -d <distro> --cd ~ -- kitty   (no console window)
# Usage: setup-wsl-kitty.sh   (then right-click the shortcut > Pin to taskbar)

set -euo pipefail

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

case "${1:-}" in
  "") ;;
  -h|--help) sed -n '2,7p' "$0" | sed 's/^# \?//'; exit 0 ;;
  *) red "Unknown argument: $1"; exit 1 ;;
esac

if ! grep -qi microsoft /proc/version 2>/dev/null; then
  red "Not running under WSL; nothing to do."
  exit 1
fi
if ! command -v kitty &>/dev/null; then
  red "kitty is not installed. Run the Ansible playbook first."
  exit 1
fi

WSLG_EXE='C:\Program Files\WSL\wslg.exe'
if [[ ! -x "$(wslpath -u "$WSLG_EXE")" ]]; then
  red "wslg.exe not found at $WSLG_EXE. Update WSL: run 'wsl --update' in Windows."
  exit 1
fi
DISTRO="${WSL_DISTRO_NAME:?WSL_DISTRO_NAME not set}"

echo "==> Ensuring kitty loads personal.conf..."
KITTY_DIR="$HOME/.config/kitty"
mkdir -p "$KITTY_DIR"
if [[ ! -f "$KITTY_DIR/kitty.conf" ]]; then
  printf '# Created by setup-wsl-kitty.sh (Omarchy provides this file elsewhere)\ninclude personal.conf\n' \
    >"$KITTY_DIR/kitty.conf"
  green "Created $KITTY_DIR/kitty.conf"
elif ! grep -q '^include personal.conf' "$KITTY_DIR/kitty.conf"; then
  printf '\ninclude personal.conf\n' >>"$KITTY_DIR/kitty.conf"
  green "Added include to $KITTY_DIR/kitty.conf"
else
  green "kitty.conf already includes personal.conf"
fi

WIN_LOCALAPPDATA="$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')"
WIN_APPDATA="$(cmd.exe /c 'echo %APPDATA%' 2>/dev/null | tr -d '\r')"

echo "==> Preparing kitty icon..."
ICON_DIR_WIN="$WIN_LOCALAPPDATA\\kitty-wsl"
ICON_WIN="$ICON_DIR_WIN\\kitty.ico"
mkdir -p "$(wslpath -u "$ICON_DIR_WIN")"
PNG=""
for size in 256x256 128x128; do
  candidate="/usr/share/icons/hicolor/$size/apps/kitty.png"
  [[ -f "$candidate" ]] && PNG="$candidate" && break
done
if [[ -n "$PNG" ]]; then
  # An .ico may embed a PNG directly (Vista+): 6-byte header + 16-byte entry + PNG.
  python3 - "$PNG" "$(wslpath -u "$ICON_WIN")" <<'EOF'
import struct, sys
png = open(sys.argv[1], "rb").read()
w, h = struct.unpack(">II", png[16:24])
entry = struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(png), 22)
open(sys.argv[2], "wb").write(struct.pack("<HHH", 0, 1, 1) + entry + png)
EOF
else
  yellow "kitty icon not found; shortcut will use the default icon."
  ICON_WIN="$WSLG_EXE"
fi

echo "==> Creating Start menu and Desktop shortcuts..."
WIN_TEMP="$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')"
PS1_UNIX="$(wslpath -u "$WIN_TEMP")/kitty-wsl-shortcut.ps1"
cat >"$PS1_UNIX" <<EOF
\$shell = New-Object -ComObject WScript.Shell
\$targets = @(
  (Join-Path '$WIN_APPDATA' 'Microsoft\Windows\Start Menu\Programs\Kitty (WSL).lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Kitty (WSL).lnk')
)
foreach (\$path in \$targets) {
  \$lnk = \$shell.CreateShortcut(\$path)
  \$lnk.TargetPath = '$WSLG_EXE'
  \$lnk.Arguments = '-d $DISTRO --cd ~ -- kitty'
  \$lnk.IconLocation = '$ICON_WIN'
  \$lnk.Description = 'kitty in WSL ($DISTRO)'
  \$lnk.Save()
  "  \$path"
}
EOF
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WIN_TEMP\\kitty-wsl-shortcut.ps1" | tr -d '\r'
rm -f "$PS1_UNIX"

green "==> Done. Open 'Kitty (WSL)' from Start; right-click it > Pin to taskbar."
