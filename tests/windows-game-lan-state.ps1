# Exercise the Windows inspection and lifecycle verdicts against an in-memory inventory.
$ErrorActionPreference = 'Stop'
$fixtureNode = 'SWD\Wintun\{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}'
$inventoryFails = $false
function Get-PnpDevice {
    [CmdletBinding()] param([switch]$PresentOnly)
    if (-not $PresentOnly) { throw 'Expected a present-device inventory.' }
    if ($inventoryFails) { Write-Error 'Fixture inventory unavailable.' }
    [pscustomobject]@{ InstanceId=$fixtureNode }
}
function Get-NetAdapter {}
function Get-Process {}
$check = Join-Path $PSScriptRoot 'windows-game-lan.ps1'
$foreign = . $check -InspectOnly
if ($foreign.LINKDevicePresent) { throw 'A different Wintun device was counted.' }
$fixtureNode = 'SWD\Wintun\{0c45ad15-12f8-48bb-a9ab-0df169c455fc}'
$found = & $check -InspectOnly
if (-not $found.LINKDevicePresent) { throw 'The present LINK device was missed.' }

$s = [pscustomobject]@{ LAN=@(); Helpers=0; DevicePresent=$true }
if (Test-LinkOff $s) { throw 'A leftover PnP device passed cleanup.' }
$s.DevicePresent = $false
if (-not (Test-LinkOff $s)) { throw 'A clean inventory failed cleanup.' }
$s.LAN = @([pscustomobject]@{ Name='CRAFTCODE LINK LAN'; InterfaceGuid=$expected })
$s.Helpers = 1
if (Test-LinkOn $s) { throw 'A missing PnP device passed activation.' }
$s.DevicePresent = $true
if (-not (Test-LinkOn $s)) { throw 'The complete active inventory failed activation.' }

$inventoryFails = $true
$blocked = $false
try { $null = & $check -InspectOnly }
catch { $blocked = $_.Exception.Message -like '*Fixture inventory unavailable*' }
if (-not $blocked) { throw 'Failed enumeration produced a device verdict.' }
