@echo off
setlocal
cd /d "%~dp0"
if exist "CRAFTCODE-LINK.exe" (
  start "" "%~dp0CRAFTCODE-LINK.exe"
  exit /b 0
)
if exist "node_modules\electron\dist\electron.exe" (
  start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
  exit /b 0
)
echo CRAFTCODE LINK source package: dependencies are not installed.
echo For the ready-to-run build, open CRAFTCODE-LINK.exe in the portable Windows archive.
echo To build from these sources, install Node.js 24 LTS and run BUILD-WINDOWS.cmd.
echo This script does not change your firewall, router, or system policies.
pause
exit /b 1
