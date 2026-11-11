# End-to-end smoke test for a disposable, signed-in Windows x64 test account.
# Run from 64-bit PowerShell. No admin rights or external services are required.
param(
    [Parameter(Mandatory=$true)][string]$PreviousSetup,
    [Parameter(Mandatory=$true)][string]$CurrentSetup
)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitProcess -or $env:OS -ne 'Windows_NT') { throw 'Use 64-bit Windows PowerShell.' }
$old = Get-Item -LiteralPath $PreviousSetup
$new = Get-Item -LiteralPath $CurrentSetup
$previous = $old.VersionInfo.ProductVersion
$current = $new.VersionInfo.ProductVersion
if ([version]$previous -ge [version]$current) { throw 'Provide an earlier setup followed by the new setup.' }
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CRAFTCODE LINK'
$profile = Join-Path $env:APPDATA 'CRAFTCODE LINK'
$session = (Get-Process -Id $PID).SessionId
$startShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'CRAFTCODE LINK.lnk'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'CRAFTCODE LINK.lnk'
foreach ($item in @($key,$profile,$startShortcut,$desktopShortcut)) {
    if (Test-Path -LiteralPath $item) { throw 'Use a fresh disposable Windows account without a LINK installation or profile.' }
}
if (Get-Process -Name 'CRAFTCODE-LINK' -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $session }) {
    throw 'A LINK instance is running in this session. Use a separate test account.'
}
$work = Join-Path $env:TEMP ('link-update-qa-' + [guid]::NewGuid().ToString('N'))
$dir = Join-Path $work 'CRAFTCODE LINK'
$exe = Join-Path $dir 'CRAFTCODE-LINK.exe'
New-Item -Path $work -ItemType Directory | Out-Null

function Run-Setup($file, $arguments) {
    $proc = Start-Process -FilePath $file -ArgumentList $arguments -PassThru
    if (-not $proc.WaitForExit(240000)) { throw "Setup did not exit: $file" }
    if ($proc.ExitCode -ne 0) { throw "Setup failed: $file (exit $($proc.ExitCode))" }
}
function Check-Install($expected) {
    $registered = Get-ItemProperty -LiteralPath $key
    if ($registered.InstallLocation -ne $dir -or $registered.DisplayVersion -ne $expected) {
        throw "Incorrect registered installation: expected $expected in $dir."
    }
    $package = Get-Content -LiteralPath (Join-Path $dir 'resources\app\package.json') -Raw | ConvertFrom-Json
    if ($package.version -ne $expected) { throw 'Installed payload and registered version disagree.' }
}
Run-Setup $old.FullName "/S /D=$dir"
Check-Install $previous
$app = Start-Process -FilePath $exe -PassThru
for ($i=0; $i -lt 200; $i++) {
    $app.Refresh()
    if ($app.HasExited) { throw 'The old app exited before the tray test.' }
    if ($app.MainWindowHandle -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 150
}
if (-not $app.CloseMainWindow()) { throw 'Cannot close the visible window to its tray.' }
for ($i=0; $i -lt 100; $i++) {
    Start-Sleep -Milliseconds 100
    $app.Refresh()
    if ($app.HasExited) { throw 'Closing the window quit the app instead of hiding it.' }
    if ($app.MainWindowHandle -eq [IntPtr]::Zero) { break }
}
if ($app.MainWindowHandle -ne [IntPtr]::Zero) { throw 'LINK did not enter its tray state.' }
$sentinel = Join-Path $profile 'qa-preserve.txt'
$token = [guid]::NewGuid().ToString()
[IO.File]::WriteAllText($sentinel,$token)
Run-Setup $new.FullName '/S'
Check-Install $current
if (-not $app.WaitForExit(10000)) { throw 'The old main process is still running.' }
if (Get-Process -Name 'CRAFTCODE-LINK' -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $session -and $_.Path -eq $exe }) {
    throw 'An old process still owns the installed executable.'
}
if ([IO.File]::ReadAllText($sentinel) -ne $token) { throw 'Update lost the profile marker.' }
"PASS actual installer updated $previous to $current while the old app was in its tray."

$readme = Join-Path $dir 'FIRST_START_RU.txt'
$hash = (Get-FileHash -LiteralPath $readme).Hash
Remove-Item -LiteralPath $readme
Run-Setup $new.FullName '/S'
Check-Install $current
if ((Get-FileHash -LiteralPath $readme).Hash -ne $hash -or [IO.File]::ReadAllText($sentinel) -ne $token) { throw 'Repair failed.' }
'PASS repeat repair and profile retention.'
Run-Setup (Join-Path $dir 'Uninstall.exe') '/S'
# The uninstaller re-launches a temporary copy and may return before its worker finishes.
for ($i=0; $i -lt 1200 -and (Test-Path -LiteralPath $key); $i++) { Start-Sleep -Milliseconds 100 }
if (Test-Path -LiteralPath $key) { throw 'Uninstall key still present.' }
if ([IO.File]::ReadAllText($sentinel) -ne $token) { throw 'Default uninstall unexpectedly removed the profile.' }
Remove-Item -LiteralPath $work -Recurse
Remove-Item -LiteralPath $profile -Recurse
