<#
.SYNOPSIS
  Remembers which window lives on which monitor/workspace and puts everything back after a
  screen is (dis)connected or komorebi is restarted. Called by komorebi-watchdog.ahk.

.DESCRIPTION
  save    Store the current layout. One file per monitor setup (docked, laptop only, ...),
          keyed by monitor serial / device id, in %LOCALAPPDATA%\komorebi\layouts.
  heal    1. Tile every normal app window that komorebi is not managing (komorebic manage).
          2. Move every window back to the monitor/workspace saved for this monitor setup.
          3. Restore the focused workspace on each monitor and the focused window.
  status  Print what heal would do, without changing anything.

  Known limits: stacks come back as separate tiles, floating windows are left where they are.
  Log: %LOCALAPPDATA%\komorebi\watchdog.log
#>
param([ValidateSet('save', 'heal', 'status')][string]$Action = 'status')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$dataDir   = Join-Path $env:LOCALAPPDATA 'komorebi'
$layoutDir = Join-Path $dataDir 'layouts'
$logFile   = Join-Path $dataDir 'watchdog.log'
New-Item -ItemType Directory -Force $layoutDir | Out-Null

function Log($msg) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    if ($Action -eq 'status') { Write-Host $line } else { Add-Content -Path $logFile -Value $line -Encoding UTF8 }
}
function Kc { & komorebic @args 2>$null | Out-Null }

function Get-State {
    for ($i = 0; $i -lt 3; $i++) {
        $json = (& komorebic state 2>$null) -join "`n"
        if ($json -match '"monitors"') { try { return $json | ConvertFrom-Json } catch { } }
        Start-Sleep -Milliseconds 800
    }
    return $null
}

# Laptop panels report serial "0", so fall back to the device id for those.
function MonKey($m) {
    if ($m.serial_number_id -and $m.serial_number_id -ne '0') { return [string]$m.serial_number_id }
    return [string]$m.device_id
}
function Signature($st) { (@($st.monitors.elements | ForEach-Object { MonKey $_ }) | Sort-Object) -join '+' }
function LayoutFile($sig) { Join-Path $layoutDir ((($sig -replace '[^A-Za-z0-9+_-]', '_')) + '.json') }

# hwnd -> location for every tiled window (containers + monocle). Floating windows are left alone.
function Get-Locations($st) {
    $map = @{}
    for ($mi = 0; $mi -lt $st.monitors.elements.Count; $mi++) {
        $m = $st.monitors.elements[$mi]
        for ($wi = 0; $wi -lt $m.workspaces.elements.Count; $wi++) {
            $w = $m.workspaces.elements[$wi]
            $containers = @($w.containers.elements)
            if ($w.monocle_container) { $containers += $w.monocle_container }
            $ci = 0
            foreach ($c in $containers) {
                foreach ($win in @($c.windows.elements)) {
                    $map[[long]$win.hwnd] = [pscustomobject]@{
                        hwnd = [long]$win.hwnd; exe = $win.exe; title = $win.title
                        monitor = $mi; key = (MonKey $m); workspace = $wi; container = $ci
                        visible = ($wi -eq $m.workspaces.focused)
                    }
                }
                $ci++
            }
        }
    }
    return $map
}
function Get-AllManaged($st) {
    $set = New-Object 'System.Collections.Generic.HashSet[long]'
    foreach ($m in $st.monitors.elements) { foreach ($w in $m.workspaces.elements) {
        $all = @($w.containers.elements | ForEach-Object { $_.windows.elements }) + @($w.floating_windows.elements)
        if ($w.monocle_container) { $all += @($w.monocle_container.windows.elements) }
        if ($w.maximized_window) { $all += $w.maximized_window }
        foreach ($x in $all) { if ($x) { [void]$set.Add([long]$x.hwnd) } }
    } }
    return ,$set
}

# ---------------------------------------------------------------- save
function Save-Layout($st) {
    $loc = Get-Locations $st
    if ($loc.Count -eq 0) { return }
    $sig = Signature $st
    $layout = [pscustomobject]@{
        signature       = $sig
        focused_monitor = MonKey $st.monitors.elements[$st.monitors.focused]
        monitors        = @(foreach ($m in $st.monitors.elements) {
            [pscustomobject]@{ key = (MonKey $m); focused_workspace = $m.workspaces.focused }
        })
        windows         = @($loc.Values | Sort-Object key, workspace, container |
                            Select-Object hwnd, exe, title, key, workspace, container)
    }
    $file = LayoutFile $sig
    $new = $layout | ConvertTo-Json -Depth 6
    if ((Test-Path $file) -and ((Get-Content $file -Raw -Encoding UTF8).Trim() -eq $new.Trim())) { return }
    [IO.File]::WriteAllText($file, $new, [Text.UTF8Encoding]::new($false))
}

# ---------------------------------------------------------------- heal
# Compiling the Win32 helpers takes ~1 s, so 'save' (run every minute) skips it.
if ($Action -ne 'save') {
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class KWin {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);

    // Top-level app windows: visible, not cloaked (other workspace / virtual desktop), not
    // minimised, no owner, not a tool window, has a title. "caption" (0/1) tells whether it has a
    // normal title bar; borderless apps (WezTerm) only count when a manage rule names them.
    public static List<string> AppWindows() {
        var r = new List<string>();
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h) || IsIconic(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
            int st = GetWindowLong(h, -16), ex = GetWindowLong(h, -20);
            if ((ex & 0x80) != 0) return true;
            int caption = (st & 0x00C00000) == 0x00C00000 ? 1 : 0;
            int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);
            if (cloaked != 0) return true;
            var t = new StringBuilder(256); GetWindowText(h, t, 256);
            if (t.Length == 0) return true;
            var c = new StringBuilder(256); GetClassName(h, c, 256);
            uint pid; GetWindowThreadProcessId(h, out pid);
            r.Add(h.ToInt64() + "\t" + pid + "\t" + caption + "\t" + c + "\t" + t);
            return true;
        }, IntPtr.Zero);
        return r;
    }

    public static bool Focus(long hwnd) {
        IntPtr h = new IntPtr(hwnd);
        if (!IsWindow(h)) return false;
        IntPtr fg = GetForegroundWindow();
        uint dummy, fgThread = GetWindowThreadProcessId(fg, out dummy), me = GetCurrentThreadId();
        bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
        bool ok = SetForegroundWindow(h);
        BringWindowToTop(h);
        if (attached) AttachThreadInput(me, fgThread, false);
        if (!ok || GetForegroundWindow() != h) {
            keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);   // ALT tap unlocks SetForegroundWindow
            SetForegroundWindow(h);
        }
        return GetForegroundWindow() == h;
    }
}
'@
}

function Get-IgnoreRules {
    $exe = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $cls = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($n in 'komorebi.exe', 'whkd.exe', 'AutoHotkey64.exe', 'TextInputHost.exe', 'ShellExperienceHost.exe',
                   'StartMenuExperienceHost.exe', 'SearchHost.exe', 'LockApp.exe') { [void]$exe.Add($n) }
    foreach ($n in 'Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd') { [void]$cls.Add($n) }
    $add = {
        param($rules)
        foreach ($r in @($rules)) {
            if ($r -is [array] -or -not $r.kind) { continue }   # composite rules: let komorebi decide
            if ($r.matching_strategy -and $r.matching_strategy -notin 'Equals', 'Legacy') { continue }
            if ($r.kind -eq 'Exe') { [void]$exe.Add($r.id) } elseif ($r.kind -eq 'Class') { [void]$cls.Add($r.id) }
        }
    }
    $manageExe = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    try {
        $cfg = Get-Content "$HOME\komorebi.json" -Raw | ConvertFrom-Json
        & $add $cfg.ignore_rules
        foreach ($r in @($cfg.manage_rules)) { if ($r.kind -eq 'Exe') { [void]$manageExe.Add($r.id) } }
    } catch { }
    try {
        $asc = Get-Content "$HOME\applications.json" -Raw | ConvertFrom-Json
        foreach ($p in $asc.PSObject.Properties) { if ($p.Value.ignore) { & $add $p.Value.ignore } }
    } catch { }
    return @{ exe = $exe; cls = $cls; manage = $manageExe }
}

function Get-Unmanaged($st) {
    $managed = Get-AllManaged $st
    $ign = Get-IgnoreRules
    foreach ($line in [KWin]::AppWindows()) {
        $hwnd, $procId, $caption, $class, $title = $line -split "`t", 5
        if ($managed.Contains([long]$hwnd) -or $ign.cls.Contains($class)) { continue }
        $exe = try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName + '.exe' } catch { continue }
        if ($ign.exe.Contains($exe)) { continue }
        if ($caption -eq '0' -and -not $ign.manage.Contains($exe)) { continue }   # borderless popups, overlays
        [pscustomobject]@{ hwnd = [long]$hwnd; exe = $exe; title = $title }
    }
}

function Heal([switch]$DryRun) {
    $st = Get-State
    if (-not $st -or $st.monitors.elements.Count -eq 0) { Log 'heal: komorebi not answering or no monitors, skipped'; return }
    $foreground = [KWin]::GetForegroundWindow().ToInt64()

    # 1. adopt windows komorebi lost track of
    $lost = @(Get-Unmanaged $st)
    foreach ($w in $lost) {
        if ($DryRun) { Log "would tile: $($w.exe) '$($w.title)'"; continue }
        if ([KWin]::Focus($w.hwnd)) { Start-Sleep -Milliseconds 200; Kc manage; Start-Sleep -Milliseconds 150 }
    }
    if ($lost.Count -and -not $DryRun) {
        Log "heal: tiled $($lost.Count) untiled window(s): $(($lost | ForEach-Object exe) -join ', ')"
        $st = Get-State
        if (-not $st) { return }
    }

    # 2. move windows back to where they were in this monitor setup
    $sig = Signature $st
    $file = LayoutFile $sig
    if (-not (Test-Path $file)) { Log "heal: no saved layout yet for monitors $sig"; return }
    $saved = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
    $monIndex = @{}
    for ($i = 0; $i -lt $st.monitors.elements.Count; $i++) { $monIndex[(MonKey $st.monitors.elements[$i])] = $i }

    $moved = 0; $skipped = 0
    foreach ($s in $saved.windows) {
        $loc = Get-Locations $st          # refreshed: every move changes indices
        $cur = $loc[[long]$s.hwnd]
        if (-not $cur -or -not $monIndex.ContainsKey($s.key)) { continue }
        $target = $monIndex[$s.key]
        if ($cur.monitor -eq $target -and $cur.workspace -eq $s.workspace) { continue }
        if (-not $cur.visible) { $skipped++; continue }   # on a hidden workspace: cannot focus it safely
        if ($DryRun) { Log "would move: $($s.exe) '$($s.title)' -> monitor $target workspace $($s.workspace + 1)"; $moved++; continue }
        if (-not [KWin]::Focus($s.hwnd)) { $skipped++; continue }
        Start-Sleep -Milliseconds 200
        Kc send-to-monitor-workspace $target $s.workspace
        Start-Sleep -Milliseconds 150
        $moved++
        $st = Get-State
        if (-not $st) { return }
    }

    # 3. focused workspaces and window as they were
    if (-not $DryRun -and $moved) {
        foreach ($m in $saved.monitors) {
            if ($monIndex.ContainsKey($m.key)) { Kc focus-monitor-workspace $monIndex[$m.key] $m.focused_workspace; Start-Sleep -Milliseconds 100 }
        }
        if ($monIndex.ContainsKey($saved.focused_monitor)) { Kc focus-monitor $monIndex[$saved.focused_monitor] }
        if ([KWin]::IsWindow([IntPtr]$foreground)) { [void][KWin]::Focus($foreground) }
    }
    if ($moved -or $skipped) { Log "heal: moved $moved window(s) back to their saved workspaces$(if ($skipped) { ", $skipped not reachable" })" }
}

switch ($Action) {
    'save'   { $st = Get-State; if ($st) { Save-Layout $st } }
    'heal'   { Heal }
    'status' {
        $st = Get-State
        if (-not $st) { Write-Host 'komorebi not answering'; return }
        $sig = Signature $st
        Write-Host "monitor setup: $sig"
        Write-Host "saved layout:  $(if (Test-Path (LayoutFile $sig)) { LayoutFile $sig } else { 'none yet' })"
        Heal -DryRun
    }
}
