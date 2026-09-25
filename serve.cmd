@echo off
REM ---------------------------------------------------------------------------
REM Starts the local development web server for the Date Range Picker extension.
REM
REM Double-click this file, or run it from any shell.
REM
REM This machine has its PowerShell execution policy set to AllSigned at
REM LocalMachine scope, which refuses unsigned .ps1 files. -ExecutionPolicy
REM Bypass applies to this one process only: it changes nothing on the machine,
REM affects no other script, and leaves the LocalMachine setting untouched.
REM
REM If AllSigned is an IT baseline you are expected to keep, ask IT to sign
REM serve.ps1, or host the extension on an internal web server instead and skip
REM this script entirely. See the Hosting section of README.md.
REM ---------------------------------------------------------------------------

setlocal
set "SCRIPT=%~dp0serve.ps1"

if not exist "%SCRIPT%" (
    echo Could not find serve.ps1 next to this launcher.
    echo Expected: %SCRIPT%
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*

endlocal
