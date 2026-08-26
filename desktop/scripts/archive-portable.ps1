param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("x64", "arm64")]
  [string]$Arch,

  [Parameter(Mandatory = $true)]
  [string]$DestinationPath
)

$ErrorActionPreference = "Stop"

node "scripts/prepare-portable.mjs" "win32" $Arch
if ($LASTEXITCODE -ne 0) { throw "Portable staging failed" }

$portableStage = "out/portable/PolyAsk Portable"
$destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DestinationPath)
$destinationDirectory = Split-Path -Parent $destination
New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
if (Test-Path -LiteralPath $destination) { throw "Portable ZIP already exists: $destination" }
if (Test-Path -LiteralPath "$portableStage/PolyAsk Data") {
  throw "Portable staging must not contain PolyAsk Data"
}

Compress-Archive -LiteralPath $portableStage -DestinationPath $destination -CompressionLevel Optimal

$verificationDirectory = "out/portable-verify-$Arch-$([guid]::NewGuid().ToString('N'))"
Expand-Archive -LiteralPath $destination -DestinationPath $verificationDirectory
$portableRoot = "$verificationDirectory/PolyAsk Portable"
foreach ($required in @(
  "portable.json",
  "README.txt",
  "App/polyask-desktop.exe",
  "App/resources/app.asar"
)) {
  if (-not (Test-Path -LiteralPath "$portableRoot/$required")) {
    throw "Portable ZIP is missing $required"
  }
}
if (Test-Path -LiteralPath "$portableRoot/PolyAsk Data") {
  throw "Portable ZIP must not contain PolyAsk Data"
}

Write-Output $destination
