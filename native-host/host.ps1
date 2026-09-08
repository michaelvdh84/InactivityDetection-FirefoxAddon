Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$maximumMessageBytes = 1048576
$inputStream = [Console]::OpenStandardInput()
$outputStream = [Console]::OpenStandardOutput()
$utf8 = [Text.UTF8Encoding]::new($false)

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
            throw "Unexpected end of the Native Messaging input stream."
        }
        $offset += $read
    }

    return ,$buffer
}

function Write-NativeMessage {
    param([Parameter(Mandatory)] $Message)

    $json = $Message | ConvertTo-Json -Compress -Depth 10
    $payload = $utf8.GetBytes($json)
    $header = [BitConverter]::GetBytes([uint32]$payload.Length)
    $outputStream.Write($header, 0, $header.Length)
    $outputStream.Write($payload, 0, $payload.Length)
    $outputStream.Flush()
}

function Get-MachineIPv4 {
    param([Parameter(Mandatory)] [string] $Hostname)

    $address = [Net.Dns]::GetHostAddresses($Hostname) |
        Where-Object {
            $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and
            -not [Net.IPAddress]::IsLoopback($_)
        } |
        Select-Object -First 1

    if ($null -eq $address) {
        return ""
    }

    return $address.IPAddressToString
}

function Get-Configuration {
    $configPath = Join-Path $PSScriptRoot "config.json"
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw "Configuration file not found: $configPath"
    }

    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $config -or $config -isnot [Management.Automation.PSCustomObject]) {
        throw "config.json must contain a JSON object."
    }

    $hostname = [Environment]::MachineName
    $config | Add-Member -NotePropertyName "hostname" -NotePropertyValue $hostname -Force
    $config | Add-Member -NotePropertyName "ip" -NotePropertyValue (Get-MachineIPv4 -Hostname $hostname) -Force
    return $config
}

while ($true) {
    $header = [byte[]]::new(4)
    $headerBytesRead = $inputStream.Read($header, 0, 4)
    if ($headerBytesRead -eq 0) {
        break
    }

    try {
        while ($headerBytesRead -lt 4) {
            $read = $inputStream.Read($header, $headerBytesRead, 4 - $headerBytesRead)
            if ($read -eq 0) {
                throw "Incomplete Native Messaging message header."
            }
            $headerBytesRead += $read
        }

        $messageLength = [BitConverter]::ToUInt32($header, 0)
        if ($messageLength -eq 0 -or $messageLength -gt $maximumMessageBytes) {
            throw "Native Messaging request size is invalid."
        }

        $payload = Read-ExactBytes -Stream $inputStream -Count ([int]$messageLength)
        $request = $utf8.GetString($payload) | ConvertFrom-Json

        if ($request.type -ne "get-config") {
            throw "Unsupported request type."
        }

        $configuration = Get-Configuration
        Write-NativeMessage -Message @{
            ok = $true
            config = $configuration
        }
    }
    catch {
        Write-NativeMessage -Message @{
            ok = $false
            error = $_.Exception.Message
        }
    }
}
