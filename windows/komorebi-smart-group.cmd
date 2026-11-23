@echo off
rem Windows port of hypr-smart-group.sh (G1).
rem Usage: komorebi-smart-group.cmd <left|right|up|down>
rem   focused container is a Stack  -> unstack, then move the ejected window to <dir>
rem   focused container is Single   -> stack it with the neighbour in <dir>
rem   anything else                 -> do nothing
rem Batch instead of PowerShell: cmd starts in ~10 ms, PowerShell in several hundred.
setlocal
set "DIR=%~1"
if /i not "%DIR%"=="left" if /i not "%DIR%"=="right" if /i not "%DIR%"=="up" if /i not "%DIR%"=="down" exit /b 1

set "KIND="
for /f "delims=" %%k in ('komorebic query focused-container-kind 2^>nul') do set "KIND=%%k"

if /i "%KIND%"=="Stack" (
    rem unstack puts the ejected window in a new container right after the stack and
    rem focuses it; the move then carries it to the pressed side. At a screen edge it
    rem goes to the next monitor (cross_boundary_behaviour = Monitor).
    komorebic unstack
    komorebic move %DIR%
) else if /i "%KIND%"=="Single" (
    komorebic stack %DIR%
)
endlocal
