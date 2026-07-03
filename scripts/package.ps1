# Package extension for private Chrome sideload (load unpacked)
param(
  [switch]$IncludeWebhook
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$distName = 'chrome-extension'
$dist = Join-Path $root $distName
$manifestPath = Join-Path $root 'manifest.json'
$manifestRaw = Get-Content $manifestPath -Raw -Encoding UTF8
if ($manifestRaw -match '"version"\s*:\s*"([^"]+)"') {
  $version = $Matches[1]
} else {
  $version = '1.0.0'
}
$zipPath = Join-Path $root "version-check-v$version.zip"

Write-Host '[1/4] Clean old release folder...'
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null

$items = @('manifest.json', 'popup', 'content', 'background', 'icons')
foreach ($item in $items) {
  $src = Join-Path $root $item
  if (-not (Test-Path $src)) { throw "Missing: $item" }
  Copy-Item $src (Join-Path $dist $item) -Recurse -Force
}

Write-Host '[2/4] Copy config.local.js...'
if ($IncludeWebhook -and (Test-Path (Join-Path $root 'config.local.js'))) {
  Copy-Item (Join-Path $root 'config.local.js') (Join-Path $dist 'config.local.js') -Force
  Write-Host '      Included config.local.js with Webhook (keep zip private)'
} else {
  Copy-Item (Join-Path $root 'config.local.example.js') (Join-Path $dist 'config.local.js') -Force
  Write-Host '      Used config.local.example.js - edit Webhook before use'
}

Write-Host '[3/4] Create zip...'
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $dist -DestinationPath $zipPath -Force

Write-Host '[4/4] Done'
Write-Host "Folder: $dist"
Write-Host "Zip:    $zipPath"
Write-Host ''
Write-Host 'Chrome: chrome://extensions/ -> Developer mode -> Load unpacked -> select folder above'
