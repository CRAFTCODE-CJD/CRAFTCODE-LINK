[CmdletBinding(DefaultParameterSetName='Sign')]
param(
    [Parameter(Mandatory, ParameterSetName='Initialize')][switch]$Initialize,
    [Parameter(Mandatory, ParameterSetName='Sign')][string]$Installer,
    [Parameter(Mandatory, ParameterSetName='Sign')][string]$Output,
    [string]$PublicKey
)
$ErrorActionPreference = 'Stop'
if (!$PublicKey) { $PublicKey = Join-Path $PSScriptRoot '../src/offline-release-key.json' }
$keyName = 'CRAFTCODE-CJD.CRAFTCODE-LINK.OfflineRelease.RSA3072.v1'
$provider = [Security.Cryptography.CngProvider]::MicrosoftSoftwareKeyStorageProvider
$key = $null
$rsa = $null

function Base64Url([byte[]]$Bytes) {
    return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}
try {
    $pinnedPath = [IO.Path]::GetFullPath($PublicKey)
    $exists = [Security.Cryptography.CngKey]::Exists($keyName,$provider)
    if (!$exists) {
        if (!$Initialize -or [IO.File]::Exists($pinnedPath)) {
            throw 'The Windows signing key is unavailable. An existing public key cannot be replaced automatically.'
        }
        $settings = [Security.Cryptography.CngKeyCreationParameters]::new()
        $settings.Provider = $provider
        $settings.KeyUsage = [Security.Cryptography.CngKeyUsages]::Signing
        $settings.ExportPolicy = [Security.Cryptography.CngExportPolicies]::None
        $settings.Parameters.Add([Security.Cryptography.CngProperty]::new('Length',[BitConverter]::GetBytes([int]3072),0))
        $key = [Security.Cryptography.CngKey]::Create([Security.Cryptography.CngAlgorithm]::Rsa,$keyName,$settings)
    } else {
        $key = [Security.Cryptography.CngKey]::Open($keyName,$provider)
    }
    $rsa = [Security.Cryptography.RSACng]::new($key)
    if ($rsa.KeySize -ne 3072 -or $key.IsMachineKey -or $key.KeyUsage -ne 'Signing' -or $key.ExportPolicy -ne 'None') {
        throw 'Expected a non-exportable current-user RSA-3072 signing key.'
    }
    $parameters = $rsa.ExportParameters($false)
    $jwk = [ordered]@{kty='RSA'; n=(Base64Url $parameters.Modulus); e=(Base64Url $parameters.Exponent)}
    if ([IO.File]::Exists($pinnedPath)) {
        $pin = [IO.File]::ReadAllText($pinnedPath) | ConvertFrom-Json
        if ($pin.kty -cne 'RSA' -or $pin.n -cne $jwk.n -or $pin.e -cne $jwk.e -or @($pin.PSObject.Properties.Name | Where-Object {$_ -notin @('kty','n','e')}).Count) {
            throw 'The local CNG key differs from the pinned public key.'
        }
    } elseif ($Initialize) {
        $public = [Text.Encoding]::ASCII.GetBytes(($jwk | ConvertTo-Json) + [char]10)
        $stream = [IO.File]::Open($pinnedPath,'CreateNew','Write','None')
        try { $stream.Write($public,0,$public.Length) } finally { $stream.Dispose() }
    } else {
        throw 'The selected release has no pinned public key.'
    }
    if ($Initialize) { Write-Output 'Verified publisher key. Only the public JWK is stored in the source tree.'; return }

    $inputPath = (Resolve-Path -LiteralPath $Installer).ProviderPath
    $outputPath = [IO.Path]::GetFullPath($Output)
    $name = [IO.Path]::GetFileName($inputPath)
    if ($name -cnotmatch '^CRAFTCODE-LINK-((?:0|[1-9][0-9]{0,3})(?:\.(?:0|[1-9][0-9]{0,3})){2})-Setup-x64\.exe$') {
        throw 'Supply the versioned Windows x64 Setup executable.'
    }
    $version = $Matches[1]
    $source = [IO.File]::Open($inputPath,'Open','Read','Read')
    $tempPath = $null
    try {
        if ($source.Length -lt 2 -or $source.Length -gt 512MB -or $source.ReadByte() -ne 77 -or $source.ReadByte() -ne 90) { throw 'Invalid installer.' }
        $source.Position = 0
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $digest = [BitConverter]::ToString($hash.ComputeHash($source)).Replace('-','').ToLowerInvariant() } finally { $hash.Dispose() }
        $length = $source.Length.ToString([Globalization.CultureInfo]::InvariantCulture)
        $header = [Text.Encoding]::ASCII.GetBytes("LINKUPD1$version $length $digest" + [char]10)
        $signature = $rsa.SignData($header,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pss)
        if ($signature.Length -ne 384) { throw 'Unexpected signature size.' }
        $candidate = Join-Path ([IO.Path]::GetDirectoryName($outputPath)) ('.linkupdate-' + [Guid]::NewGuid().ToString('N') + '.tmp')
        $stream = [IO.File]::Open($candidate,'CreateNew','Write','None')
        $tempPath = $candidate
        try {
            $stream.Write($header,0,$header.Length)
            $stream.Write($signature,0,$signature.Length)
            $source.Position = 0
            $source.CopyTo($stream)
            $stream.Flush($true)
        } finally { $stream.Dispose() }
        [IO.File]::Move($tempPath,$outputPath)
        $tempPath = $null
    } finally {
        $source.Dispose()
        if ($tempPath) { [IO.File]::Delete($tempPath) }
    }
    Write-Output "Signed LINK offline package $version ($length installer bytes)."
} finally {
    if ($rsa) { $rsa.Dispose() }
    if ($key) { $key.Dispose() }
}
