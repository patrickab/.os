#Requires AutoHotkey v2.0
#SingleInstance Force
#NoTrayIcon
Persistent

; komorebi watchdog: keeps tiling intact across docking/undocking, unlock and sleep.
;
; - Every minute, while everything is healthy, komorebi-layout.ps1 saves which window is on
;   which monitor/workspace (one saved layout per monitor setup: docked, laptop only, ...).
; - 5 s after the screens stop changing (or after unlock/resume):
;     1. if komorebi still has the old monitor sizes, restart komorebi + whkd (the only case
;        that needs a restart);
;     2. komorebi-layout.ps1 heal: tile windows komorebi lost track of and move every window
;        back to its saved monitor/workspace for this monitor setup.
; - Never starts komorebi if you stopped it yourself.
;
;   komorebi-watchdog.ahk          run in the background (autostart)
;   komorebi-watchdog.ahk --check  check monitor sizes once, append the result to the log, exit
;
; Log: %LOCALAPPDATA%\komorebi\watchdog.log

DllCall("SetThreadDpiAwarenessContext", "ptr", -4, "ptr")   ; real pixel sizes, like komorebi

global LOG_FILE      := EnvGet("LOCALAPPDATA") "\komorebi\watchdog.log"
global STATE         := A_Temp "\komorebi-watchdog-state.json"
global LAYOUT_PS1    := A_ScriptDir "\komorebi-layout.ps1"
global COOLDOWN_MS   := 120000   ; never restart komorebi twice within 2 minutes
global SETTLE_MS     := 90000    ; no layout saves for 90 s after a screen change (the mess must not be saved)
global lastRestart   := -COOLDOWN_MS
global lastEvent     := -SETTLE_MS
global pendingReason := ""

if (A_Args.Length && A_Args[1] = "--check") {
    problem := Diagnose()
    Log("manual check: " (problem = "" ? "OK" : problem))
    ExitApp(problem = "" ? 0 : 1)
}

OnMessage(0x007E, OnDisplayChange)   ; WM_DISPLAYCHANGE
OnMessage(0x02B1, OnSessionChange)   ; WM_WTSSESSION_CHANGE
OnMessage(0x0218, OnPowerBroadcast)  ; WM_POWERBROADCAST
DllCall("Wtsapi32\WTSRegisterSessionNotification", "ptr", A_ScriptHwnd, "uint", 0)
SetTimer(Periodic, 60000)
Log("watchdog started")

OnDisplayChange(*) {
    ScheduleHeal("display change")
}
OnSessionChange(wParam, *) {
    if (wParam = 8)                       ; WTS_SESSION_UNLOCK
        ScheduleHeal("unlock")
}
OnPowerBroadcast(wParam, *) {
    if (wParam = 0x7 || wParam = 0x12)    ; PBT_APMRESUMESUSPEND / PBT_APMRESUMEAUTOMATIC
        ScheduleHeal("resume")
}

; Screens fire several events while (un)docking; act once they have been quiet for 5 s.
ScheduleHeal(reason) {
    global pendingReason := reason, lastEvent := A_TickCount
    SetTimer(Debounced, -5000)
}
Debounced() {
    Heal(pendingReason)
}

Periodic() {
    if !ProcessExist("komorebi.exe")
        return
    if !ProcessExist("whkd.exe") {
        Log("whkd not running -> starting it")
        try Run("whkd", , "Hide")
    }
    if (A_TickCount - lastEvent < SETTLE_MS)
        return
    if (Diagnose() != "") {               ; monitor change that sent no event
        Heal("periodic")
        return
    }
    RunLayout("save")
}

Heal(reason) {
    global lastRestart, lastEvent
    if !ProcessExist("komorebi.exe")
        return                            ; stopped on purpose (or by setup/uninstall)
    if (MonitorGetCount() = 0)
        return                            ; screens off / mid-switch, the next event will follow

    problem := Diagnose()
    if (problem = "komorebi not answering") {
        ; Never restart on this: it also happens when komorebic can't reach komorebi from where
        ; the watchdog was started (e.g. a sandboxed shell), and restarting then breaks everything.
        Log(reason ": komorebi not answering, skipped")
        return
    }
    if (problem != "") {
        if (A_TickCount - lastRestart < COOLDOWN_MS) {
            Log(reason ": " problem " (no restart, last one was under 2 minutes ago)")
        } else {
            Log(reason ": " problem " -> restarting komorebi")
            Restart()
        }
    }
    RunLayout("heal")
    lastEvent := A_TickCount              ; heal moved windows; wait before saving again
}

; "" when komorebi's monitors match the real ones, otherwise a description.
Diagnose() {
    json := ReadState()
    if (json = "")
        json := (Sleep(2000), ReadState())   ; komorebi may be busy right after an event
    if (json = "")
        return "komorebi not answering"

    actual := []
    loop MonitorGetCount() {
        MonitorGet(A_Index, &l, &t, &r, &b)
        actual.Push(l "," t "," (r - l) "x" (b - t))
    }
    known := []
    pos := 1
    while (pos := RegExMatch(json, '"size"\s*:\s*\{\s*"left"\s*:\s*(-?\d+)\s*,\s*"top"\s*:\s*(-?\d+)\s*,\s*"right"\s*:\s*(\d+)\s*,\s*"bottom"\s*:\s*(\d+)', &m, pos)) {
        known.Push(m[1] "," m[2] "," m[3] "x" m[4])
        pos += m.Len
    }
    a := SortedList(actual), k := SortedList(known)
    if (a != k)
        return "monitors differ (komorebi: " k "; actual: " a ")"
    return ""
}

ReadState() {
    try FileDelete(STATE)
    try RunWait(A_ComSpec ' /c komorebic state > "' STATE '" 2>nul', , "Hide")
    try {
        json := FileRead(STATE)
        return InStr(json, '"monitors"') ? json : ""
    }
    return ""
}

RunLayout(action) {
    try RunWait('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' LAYOUT_PS1 '" ' action, , "Hide")
}

Restart() {
    global lastRestart := A_TickCount
    try RunWait("komorebic stop --whkd", , "Hide")
    Sleep(2000)
    try Run("komorebic start --whkd", , "Hide")
    Sleep(8000)
    if !ProcessExist("whkd.exe") {
        Log("whkd did not come up after restart -> starting it")
        try Run("whkd", , "Hide")
    }
}

SortedList(arr) {
    s := ""
    for v in arr
        s .= v "`n"
    return StrReplace(Trim(Sort(s), "`n"), "`n", " | ")
}

Log(msg) {
    try {
        if (FileGetSize(LOG_FILE) > 262144)
            FileDelete(LOG_FILE)
    }
    try FileAppend(FormatTime(, "yyyy-MM-dd HH:mm:ss") "  " msg "`n", LOG_FILE, "UTF-8")
}
