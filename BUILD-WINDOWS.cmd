@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
where go >nul 2>nul
if errorlevel 1 (
  echo Install Go 1.25 or newer for Windows builds, then run this file again.
  pause
  exit /b 1
)
echo CRAFTCODE LINK: install locked dependencies and build a portable Windows app.
echo This downloads open-source build dependencies from npm and GitHub.
echo No administrator rights, firewall changes, or router changes are requested.
choice /C YN /M "Continue"
if errorlevel 2 exit /b 0
call npm ci --no-audit --no-fund
if errorlevel 1 goto failed
call npm audit --audit-level=high
if errorlevel 1 goto failed
call npm run check
if errorlevel 1 goto failed
call npm test
if errorlevel 1 goto failed
call npm run pack:win
if errorlevel 1 goto failed
echo Portable build complete.
choice /C YN /M "Also build the Windows setup wizard (Python 3.11+, Go 1.25+, NSIS 3 in PATH)"
if errorlevel 2 exit /b 0
python scripts\package-setup.py
if errorlevel 1 goto failed
echo Setup complete. The installer is in out.
pause
exit /b 0
:failed
echo Build failed. Read the error above. No system security settings were changed.
pause
exit /b 1
