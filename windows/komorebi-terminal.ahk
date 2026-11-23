#Requires AutoHotkey v2.0
#NoTrayIcon
; Opens a new WezTerm window on the monitor of the focused window, then exits.
; Called by whkd on win+enter (an AutoHotkey hotkey would not fire: whkd's keyboard hook
; swallows the combo). WezTerm would otherwise always open on the primary monitor.

mon := FocusedMonitor()
MonitorGet(mon, &left, &top)
try FileAppend(FormatTime(, "yyyy-MM-dd HH:mm:ss") "  win+enter: wezterm on monitor " mon " (focused: " WinGetProcessName("A") ")`n",
               EnvGet("LOCALAPPDATA") "\komorebi\hotkeys.log", "UTF-8")
; --position=X,Y (with "="): a monitor left of / above the main one has negative coordinates,
; and "--position -771,-1340" makes wezterm treat "-771" as an option and exit without a window.
; --always-new-process: don't hand the request to an already running WezTerm.
Run Format('"C:\Program Files\WezTerm\wezterm-gui.exe" start --always-new-process --position={},{}', left + 100, top + 100)
ExitApp

; Monitor holding the centre of the active window; falls back to the mouse position.
FocusedMonitor() {
    try {
        WinGetPos(&x, &y, &w, &h, "A")
        if (w > 0) {
            m := MonitorAt(x + w // 2, y + h // 2)
            if m
                return m
        }
    }
    CoordMode "Mouse", "Screen"
    MouseGetPos(&mx, &my)
    m := MonitorAt(mx, my)
    return m ? m : MonitorGetPrimary()
}

MonitorAt(px, py) {
    loop MonitorGetCount() {
        MonitorGet(A_Index, &l, &t, &r, &b)
        if (px >= l && px < r && py >= t && py < b)
            return A_Index
    }
    return 0
}
