@echo off
rem Usage: komorebi-cycle-stack.cmd <next|previous>
rem Cycles the tabs of the focused stack. On a window that is not in a stack it does nothing,
rem so win+ctrl+left/right can never move focus away from the current window.
setlocal
set "DIR=%~1"
if /i not "%DIR%"=="next" if /i not "%DIR%"=="previous" exit /b 1

set "KIND="
for /f "delims=" %%k in ('komorebic query focused-container-kind 2^>nul') do set "KIND=%%k"

if /i "%KIND%"=="Stack" komorebic cycle-stack %DIR%
endlocal
