param(
    # Change this path to the Managed Storage file deployed on the PC.
    [string]$ConfigPath = (Join-Path $PSScriptRoot '..\managed-storage\prod.json')
)

$ErrorActionPreference = 'Stop'
$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).ProviderPath
$computerName = $env:COMPUTERNAME
if ([string]::IsNullOrWhiteSpace($computerName)) {
    throw 'The COMPUTERNAME environment variable is missing.'
}

$config = Get-Content -Raw -Encoding UTF8 -LiteralPath $ConfigPath | ConvertFrom-Json
if ($null -eq $config.data -or
    $config.data.hostname -isnot [string] -or
    $config.data.redirectUrl -isnot [string]) {
    throw 'The configuration must contain data.hostname and data.redirectUrl strings.'
}

$config.data.hostname = $computerName
$config.data.redirectUrl = $config.data.redirectUrl.Replace(
    '%COMPUTERNAME%', [Uri]::EscapeDataString($computerName)
)
$json = $config | ConvertTo-Json -Depth 100

# Replace the file only after the complete JSON has been written.
$temporaryPath = "$ConfigPath.$([Guid]::NewGuid().ToString('N')).tmp"
try {
    [IO.File]::WriteAllText($temporaryPath, $json, [Text.UTF8Encoding]::new($false))
    [IO.File]::Replace($temporaryPath, $ConfigPath, [NullString]::Value)
} finally {
    if (Test-Path -LiteralPath $temporaryPath) {
        Remove-Item -LiteralPath $temporaryPath
    }
}

Write-Host "Updated hostname in $ConfigPath. Restart Firefox to load the configuration."
