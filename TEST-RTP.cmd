@echo off
setlocal
pushd "%~dp0"
if not exist "CRAFTCODE-LINK.exe" (
  echo Run TEST-RTP.cmd from the extracted Windows portable folder.
  pause
  exit /b 1
)
start "" /wait "CRAFTCODE-LINK.exe" --craftlink-test-media
set "testResult=%ERRORLEVEL%"
popd
exit /b %testResult%
