#!/usr/bin/env bash
# WSL only: make the JetBrainsMono Nerd Font (installed on the Linux side via
# Homebrew) available to Windows Terminal, which renders with Windows fonts.
#   1. Copies JetBrainsMonoNerdFontMono-*.ttf into the Windows per-user fonts dir
#   2. Registers them under HKCU (no admin needed)
#   3. Sets the font on all WSL profiles in Windows Terminal (backs up settings.json)
# Usage: setup-wsl-fonts.sh   (then close ALL Windows Terminal windows and reopen)

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

FONT_FACE="JetBrainsMono Nerd Font Mono"
SRC_DIR="$HOME/.local/share/fonts"
shopt -s nullglob
fonts=("$SRC_DIR"/JetBrainsMonoNerdFontMono-*.ttf)
if [[ ${#fonts[@]} -eq 0 ]]; then
  red "No JetBrainsMonoNerdFontMono-*.ttf in $SRC_DIR. Run the Ansible playbook first (installs font-jetbrains-mono-nerd-font)."
  exit 1
fi

WIN_LOCALAPPDATA="$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')"
LOCALAPPDATA_UNIX="$(wslpath -u "$WIN_LOCALAPPDATA")"
WIN_FONT_DIR="$WIN_LOCALAPPDATA\\Microsoft\\Windows\\Fonts"
UNIX_FONT_DIR="$LOCALAPPDATA_UNIX/Microsoft/Windows/Fonts"
REG_KEY='HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts'

echo "==> Installing ${#fonts[@]} font files to $WIN_FONT_DIR..."
mkdir -p "$UNIX_FONT_DIR"
for f in "${fonts[@]}"; do
  name="$(basename "$f")"
  cp -u "$f" "$UNIX_FONT_DIR/$name"
  # e.g. JetBrainsMonoNerdFontMono-BoldItalic.ttf -> "JetBrainsMono Nerd Font Mono BoldItalic (TrueType)"
  style="${name#JetBrainsMonoNerdFontMono-}"; style="${style%.ttf}"
  reg.exe add "$REG_KEY" /v "$FONT_FACE $style (TrueType)" /t REG_SZ \
    /d "$WIN_FONT_DIR\\$name" /f >/dev/null
done
green "Fonts registered for the current Windows user."

# HKCU fonts are only loaded at logon; load them into this session now and
# broadcast WM_FONTCHANGE so a sign-out isn't needed.
echo "==> Loading fonts into the current Windows session..."
WIN_TEMP="$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')"
PS1_UNIX="$(wslpath -u "$WIN_TEMP")/load-nerd-fonts.ps1"
cat >"$PS1_UNIX" <<'EOF'
$sig = @'
[DllImport("gdi32.dll", CharSet=CharSet.Unicode)] public static extern int AddFontResource(string f);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, IntPtr l, uint f, uint t, out UIntPtr r);
'@
$api = Add-Type -MemberDefinition $sig -Name FontApi -Namespace Win32 -PassThru
$dir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
$n = 0
Get-ChildItem $dir -Filter 'JetBrainsMonoNerdFontMono-*.ttf' | ForEach-Object { $n += $api::AddFontResource($_.FullName) }
$r = [UIntPtr]::Zero
[void]$api::SendMessageTimeout([IntPtr]0xffff, 0x001D, [UIntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$r)
"  loaded $n font files"
EOF
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WIN_TEMP\\load-nerd-fonts.ps1" | tr -d '\r'
rm -f "$PS1_UNIX"

echo "==> Setting font on WSL profiles in Windows Terminal..."
settings=""
for pkg in Microsoft.WindowsTerminal_8wekyb3d8bbwe Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe; do
  candidate="$LOCALAPPDATA_UNIX/Packages/$pkg/LocalState/settings.json"
  [[ -f "$candidate" ]] && settings="$candidate" && break
done
if [[ -z "$settings" ]]; then
  yellow "Windows Terminal settings.json not found; set the font to \"$FONT_FACE\" manually."
  exit 0
fi

[[ -f "$settings.bak" ]] || cp "$settings" "$settings.bak"  # keep the original on re-runs
python3 - "$settings" "$FONT_FACE" <<'EOF'
import json, sys
path, face = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8-sig") as fh:
    data = json.load(fh)
changed = []
for profile in data.get("profiles", {}).get("list", []):
    if profile.get("source") in ("Microsoft.WSL", "Windows.Terminal.Wsl"):
        profile.setdefault("font", {})["face"] = face
        changed.append(profile.get("name", "?"))
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=4, ensure_ascii=False)
    fh.write("\n")
print("  updated profiles: " + (", ".join(changed) or "none"))
EOF
green "==> Done. Close ALL Windows Terminal windows and reopen (backup: settings.json.bak)."
