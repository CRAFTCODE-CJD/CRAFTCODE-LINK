# Read-only, interactive Windows 10/11 lifecycle check. No report is written to disk.
[CmdletBinding()]
param([switch]$InspectOnly)
$ErrorActionPreference = 'Stop'
$expected = [guid]'0c45ad15-12f8-48bb-a9ab-0df169c455fc'
$name = 'CRAFTCODE LINK LAN'
$instanceId = 'SWD\Wintun\{' + $expected.ToString() + '}'

function Get-LinkDevicePresent {
    # A targeted query also raises an error when a device is simply absent.
    # Enumerate first so a failed inventory cannot be reported as a clean removal.
    $nodes = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object { $_.InstanceId -eq $instanceId })
    return $nodes.Count -gt 0
}
function Get-LinkHelperCount {
    return @(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -eq 'link-game' }).Count
}
function Test-LinkOff($s) {
    return $s.LAN.Count -eq 0 -and $s.DevicePresent -eq $false -and $s.Helpers -eq 0
}
function Test-LinkOn($s) {
    return $s.LAN.Count -eq 1 -and $s.DevicePresent -eq $true -and $s.Helpers -eq 1 -and
        $s.LAN[0].Name -eq $name -and [guid]$s.LAN[0].InterfaceGuid -eq $expected
}

if ($InspectOnly) {
    $device = @(Get-NetAdapter -IncludeHidden | Where-Object { $_.InterfaceGuid -and [guid]$_.InterfaceGuid -eq $expected })
    [pscustomobject]@{ LINKInterfaces=$device.Count; LINKDevicePresent=Get-LinkDevicePresent; Status=($device.Status -join ','); HelperProcessCount=Get-LinkHelperCount }
    return
}

function Snapshot {
    $all = @(Get-NetAdapter -IncludeHidden)
    $lan = @($all | Where-Object { $_.InterfaceGuid -and (([guid]$_.InterfaceGuid -eq $expected) -or $_.Name -eq $name) })
    $indexes = @($lan | ForEach-Object { $_.ifIndex })
    $routes = @(Get-NetRoute -PolicyStore ActiveStore | Where-Object { $_.DestinationPrefix -in @('0.0.0.0/0','::/0') } |
        ForEach-Object { "$($_.InterfaceIndex)|$($_.DestinationPrefix)|$($_.NextHop)|$($_.RouteMetric)" } | Sort-Object)
    $dns = @(Get-DnsClientServerAddress | Where-Object { $_.InterfaceIndex -notin $indexes -and $_.ServerAddresses } |
        ForEach-Object { "$($_.InterfaceIndex)|$($_.AddressFamily)|$($_.ServerAddresses -join ',')" } | Sort-Object)
    $others = @($all | Where-Object { $_.ifIndex -notin $indexes } |
        ForEach-Object { "$($_.InterfaceGuid)|$($_.Name)" } | Sort-Object)
    $profiles = @(Get-ChildItem -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\Profiles' |
        ForEach-Object { $_.PSChildName } | Sort-Object)
    [pscustomobject]@{ LAN=$lan; Routes=$routes; DNS=$dns; Others=$others; Profiles=$profiles
        DevicePresent=Get-LinkDevicePresent; Helpers=Get-LinkHelperCount }
}
function Require-Off {
    $end = (Get-Date).AddSeconds(30)
    do {
        $s = Snapshot
        if (Test-LinkOff $s) { return $s }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $end)
    throw "LINK resources still present after 30 seconds. Interfaces=$($s.LAN.Count), PnP device=$($s.DevicePresent), helpers=$($s.Helpers)."
}
function Same($first,$second,$property) {
    if (($first.$property -join "`n") -cne ($second.$property -join "`n")) {
        throw "Changed: $property. Review the Windows network state; another network event may also cause this difference."
    }
}
try {
    Write-Host 'Keep other networks and any VPN stable during this check. Begin with Game LAN disabled.'
    $before = Require-Off
    for ($cycle=1; $cycle -le 2; $cycle++) {
        [void](Read-Host "Cycle $cycle - enable Game LAN in a room, wait for Ready, then press Enter")
        $on = Snapshot
        if (-not (Test-LinkOn $on)) {
            throw 'Expected one LINK adapter with the release GUID, its present PnP device and one helper.'
        }
        foreach ($key in 'Routes','DNS','Others') { Same $before $on $key }
        [void](Read-Host 'Leave Game LAN or fully quit LINK. Press Enter after the action')
        $off = Require-Off
        foreach ($key in 'Routes','DNS','Others') { Same $before $off $key }
        if ($cycle -eq 1) { $warm = $off } else { Same $warm $off 'Profiles' }
        Write-Host "Cycle $cycle passed."
    }
    Write-Host 'PASS: same adapter identity in both cycles, no remaining LINK interface, PnP device or helper, stable network checks.'
} catch {
    Write-Error "Check incomplete or failed: $($_.Exception.Message)" -ErrorAction Continue
    exit 1
}
