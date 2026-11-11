@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo Проверка звука трансляции CRAFTCODE LINK
echo В течение нескольких секунд прозвучат два тихих тона. Запись на диск не сохраняется.
echo Для точного результата приостановите музыку и оставьте устройство вывода включённым.
pause
"resources\app\bin\link-audio.exe" --check
if errorlevel 1 echo Защиту подтвердить не удалось. Подробности в WINDOWS_TEST_RU.md.
pause
