# End-to-end smoke test for a disposable, signed-in Windows x64 test account.
# Run from 64-bit PowerShell. No admin rights or external services are required.
param(
    [Parameter(Mandatory=$true)][string]$PreviousSetup,
    [Parameter(Mandatory=$true)][string]$CurrentSetup,
    [switch]$HoldStageOpen
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
    $proc = Start-Process -FilePath $file -ArgumentList $arguments -WindowStyle Hidden -PassThru
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
function Wait-MaintenanceClosed {
    $deadline = [DateTime]::UtcNow.AddMinutes(4)
    do {
        $mutex = $null
        if (-not [Threading.Mutex]::TryOpenExisting('Local\CRAFTCODE-LINK-setup-ac949bb4', [ref]$mutex)) { return }
        $mutex.Dispose()
        Start-Sleep -Milliseconds 200
    } until ([DateTime]::UtcNow -ge $deadline)
    throw 'The Windows maintenance wizard did not finish.'
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
if ($HoldStageOpen) {
    # A scanner can read the staging directory without granting FILE_SHARE_DELETE.
    # Open only the directory so that replacing files and removing its contents can still succeed.
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class StageDirectory {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern SafeFileHandle CreateFileW(string name, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);
}
'@
    $update = Start-Process -FilePath $new.FullName -ArgumentList '/S' -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(75)
    do {
        $stage = Get-ChildItem -LiteralPath $work -Directory -Force -Filter '.craftcode-install-*' |
            Select-Object -First 1
        if ($stage -or $update.HasExited) { break }
        Start-Sleep -Milliseconds 50
    } until ([DateTime]::UtcNow -ge $deadline)
    if (-not $stage) { throw 'Could not observe an active update staging directory.' }
    $handle = [StageDirectory]::CreateFileW($stage.FullName,2147483648,3,[IntPtr]::Zero,3,0x02000000,[IntPtr]::Zero)
    if ($handle.IsInvalid) { throw 'Could not hold the staging directory open.' }
    try {
        if (-not $update.WaitForExit(240000)) { throw 'Update with an open staging directory timed out.' }
        $actual = (Get-Content -LiteralPath (Join-Path $dir 'resources\app\package.json') -Raw | ConvertFrom-Json).version
        $registered = (Get-ItemProperty -LiteralPath $key).DisplayVersion
        Write-Host "With staging-directory handle held: setup exit $($update.ExitCode), payload $actual, Windows registration $registered."
        if ($update.ExitCode -ne 0) { throw 'Update failed while cleaning a locked staging directory.' }
    } finally {
        $handle.Dispose()
    }
} else {
    Run-Setup $new.FullName '/S'
}
Check-Install $current
if (-not $app.WaitForExit(10000)) { throw 'The old main process is still running.' }
if (Get-Process -Name 'CRAFTCODE-LINK' -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $session -and $_.Path -eq $exe }) {
    throw 'An old process still owns the installed executable.'
}
if ([IO.File]::ReadAllText($sentinel) -ne $token) { throw 'Update lost the profile marker.' }
"PASS actual installer updated $previous to $current while the old app was in its tray."

$readme = Join-Path $dir 'FIRST_START_RU.txt'
$hash = (Get-FileHash -LiteralPath $readme).Hash
$entry = Get-ItemProperty -LiteralPath $key
$uninstaller = Join-Path $dir 'Uninstall.exe'
if ($entry.ModifyPath -ne ('"' + $uninstaller + '" /REPAIR')) { throw 'Windows Apps does not point to the installed repair command.' }
if ($entry.UninstallString -ne ('"' + $uninstaller + '"')) { throw 'Unexpected registered uninstaller.' }
$active = Start-Process -FilePath $exe -PassThru
$deadline = [DateTime]::UtcNow.AddSeconds(45)
do {
    $active.Refresh()
    if ($active.HasExited) { throw 'The test client exited before maintenance.' }
    if ($active.MainWindowHandle -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 150
} until ([DateTime]::UtcNow -ge $deadline)
if ($active.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Client did not open before maintenance.' }
$ui = Join-Path $PSScriptRoot 'windows-maintenance-ui.py'
python $ui $uninstaller cancel
if ($LASTEXITCODE -ne 0 -or $active.HasExited -or [IO.File]::ReadAllText($sentinel) -ne $token) {
    throw 'Cancelling the maintenance dialog did not preserve the running client and profile.'
}
Remove-Item -LiteralPath $readme
python $ui $uninstaller repair
if ($LASTEXITCODE -ne 0) { throw 'Could not restore the program through the Windows maintenance dialog.' }
# NSIS runs the uninstaller from a temporary copy. Wait for its repair worker.
$deadline = [DateTime]::UtcNow.AddMinutes(4)
do {
    if (Test-Path -LiteralPath $readme) { break }
    Start-Sleep -Milliseconds 200
} until ([DateTime]::UtcNow -ge $deadline)
Wait-MaintenanceClosed
Check-Install $current
if ((Get-FileHash -LiteralPath $readme).Hash -ne $hash -or [IO.File]::ReadAllText($sentinel) -ne $token) { throw 'Repair failed.' }
'PASS registered Windows repair restored original bytes and retained the profile.'
Run-Setup $uninstaller '/S'
# The uninstaller re-launches a temporary copy and may return before its worker finishes.
for ($i=0; $i -lt 1200 -and (Test-Path -LiteralPath $key); $i++) { Start-Sleep -Milliseconds 100 }
if (Test-Path -LiteralPath $key) { throw 'Uninstall key still present.' }
Wait-MaintenanceClosed
if ([IO.File]::ReadAllText($sentinel) -ne $token) { throw 'Default uninstall unexpectedly removed the profile.' }
if (Test-Path -LiteralPath $exe) { throw 'Program executable still present after uninstall.' }
if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($work)) -ne [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') -or
    [IO.Path]::GetFileName($work) -notmatch '^link-update-qa-[0-9a-f]{32}$' -or
    [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($profile)) -ne [IO.Path]::GetFullPath($env:APPDATA).TrimEnd('\') -or
    [IO.Path]::GetFileName($profile) -ne 'CRAFTCODE LINK') { throw 'Unexpected test cleanup path.' }
Remove-Item -LiteralPath $work -Recurse
Remove-Item -LiteralPath $profile -Recurse
'PASS default Windows uninstall removed the program and retained the profile.'
