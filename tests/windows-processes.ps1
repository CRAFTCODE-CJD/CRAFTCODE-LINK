# Run in ordinary Windows PowerShell while the installed app is in the tray.
# Reads only this product's process and shortcut metadata. A second launch should reveal the same window.
param([switch]$AfterQuit)
$ErrorActionPreference = 'Stop'
$sessionId = (Get-Process -Id $PID).SessionId
function Get-LinkProcess {
    @(Get-CimInstance Win32_Process -Filter "Name='CRAFTCODE-LINK.exe' AND SessionId=$sessionId")
}
function Get-MainProcess($items) {
    @($items | Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '(?:^|\s)--type=' })
}
$items = @(Get-LinkProcess)
if ($AfterQuit) {
    if ($items.Count) { throw "FAIL: $($items.Count) product processes still present." }
    'PASS: no product processes remain in this session.'
    return
}
$mainProcesses = @(Get-MainProcess $items)
if ($mainProcesses.Count -ne 1) { throw "Expected one running main process. Found $($mainProcesses.Count)." }
$mainPid = $mainProcesses[0].ProcessId
$exe = $mainProcesses[0].ExecutablePath
if (-not $exe) { throw 'Cannot determine the executable path of this user process.' }
$links = @(
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'CRAFTCODE LINK.lnk'),
    (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'CRAFTCODE LINK.lnk')
)
$shell = New-Object -ComObject Shell.Application
$wsh = New-Object -ComObject WScript.Shell
$launch = $exe
foreach ($link in $links) {
    if (-not (Test-Path -LiteralPath $link)) { continue }
    if ($wsh.CreateShortcut($link).TargetPath -ne $exe) { continue }
    $folder = $shell.Namespace((Split-Path $link))
    $item = $folder.ParseName((Split-Path $link -Leaf))
    if ($item.ExtendedProperty('System.AppUserModel.ID') -ne 'CRAFTCODE.Link.Desktop') {
        throw 'FAIL: installed shortcut is missing the product AppUserModelID.'
    }
    $launch = $link
}
Start-Process -FilePath $launch
Start-Sleep -Seconds 3
$again = @(Get-LinkProcess)
$roots = @(Get-MainProcess $again)
if ($roots.Count -ne 1 -or $roots[0].ProcessId -ne $mainPid) { throw 'FAIL: second launch changed the main process.' }
if ((Get-Process -Id $mainPid).MainWindowHandle -eq 0) { throw 'FAIL: expected the existing window to be visible.' }
"PASS: same main PID $mainPid and a visible window. Total product processes: $($again.Count)."
'Observe the Processes tab in Task Manager to confirm the visual grouping on this version of Windows.'
