param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
$item = Get-Item -LiteralPath $Directory -Force
if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe data directory' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
foreach ($id in @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')) {
  $principal = New-Object Security.Principal.SecurityIdentifier($id)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($principal, 'FullControl', $inherit, 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
$item.SetAccessControl($acl)
$actual = $item.GetAccessControl()
if (-not $actual.AreAccessRulesProtected) { throw 'Data directory permissions were not applied' }
foreach ($rule in $actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
  if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid.Value,'S-1-5-18','S-1-5-32-544')) { throw 'Unexpected data directory access' }
}
