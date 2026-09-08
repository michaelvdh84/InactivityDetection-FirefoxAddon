param(
    [string] $HostScript = (Join-Path $PSScriptRoot "host.ps1")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-ExactBytes {
    param(
        [Parameter(Mandatory)] [IO.Stream] $Stream,
        [Parameter(Mandatory)] [int] $Count
    )

    $buffer = [byte[]]::new($Count)
    $offset = 0
    while ($offset -lt $Count) {
        $read = $Stream.Read($buffer, $offset, $Count - $offset)
        if ($read -eq 0) {
            throw "The host closed stdout before sending a complete response."
        }
        $offset += $read
    }
    return ,$buffer
}

$resolvedHostScript = (Resolve-Path -LiteralPath $HostScript).Path
$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = "powershell.exe"
$startInfo.Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$resolvedHostScript`""
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true

$process = [Diagnostics.Process]::Start($startInfo)
$utf8 = [Text.UTF8Encoding]::new($false)
$payload = $utf8.GetBytes('{"type":"get-config"}')
$header = [BitConverter]::GetBytes([uint32]$payload.Length)

$process.StandardInput.BaseStream.Write($header, 0, $header.Length)
$process.StandardInput.BaseStream.Write($payload, 0, $payload.Length)
$process.StandardInput.BaseStream.Flush()
$process.StandardInput.Close()

$responseHeader = Read-ExactBytes -Stream $process.StandardOutput.BaseStream -Count 4
$responseLength = [BitConverter]::ToUInt32($responseHeader, 0)
$responsePayload = Read-ExactBytes -Stream $process.StandardOutput.BaseStream -Count ([int]$responseLength)
$process.WaitForExit()

$stderr = $process.StandardError.ReadToEnd()
if ($process.ExitCode -ne 0) {
    throw "Native host exited with code $($process.ExitCode): $stderr"
}
if ($stderr) {
    Write-Warning $stderr
}

$utf8.GetString($responsePayload) | ConvertFrom-Json | ConvertTo-Json -Depth 10
