# Script to ensure better-sqlite3 prebuilt binary is in place for Electron 34 (ABI 132)
# The binary version is read from the installed better-sqlite3 package so it always matches.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$pkgDirs = Get-ChildItem -Path "$root\node_modules\.pnpm" -Filter "better-sqlite3*" -Directory

foreach ($dir in $pkgDirs) {
  $pkgDir = Join-Path $dir.FullName "node_modules\better-sqlite3"
  $releaseDir = Join-Path $pkgDir "build\Release"
  $targetNode = Join-Path $releaseDir "better_sqlite3.node"
  $ver = (Get-Content (Join-Path $pkgDir "package.json") -Raw | ConvertFrom-Json).version
  $marker = Join-Path $releaseDir ".electron-v132-$ver"

  if ((Test-Path $targetNode) -and (Test-Path $marker)) {
    Write-Host "better_sqlite3.node v$ver (electron-v132) already present in $($dir.FullName)"
    continue
  }

  Write-Host "Installing better-sqlite3 v$ver Electron (ABI 132) binary in $($dir.FullName)..."
  $url = "https://github.com/WiseLibs/better-sqlite3/releases/download/v$ver/better-sqlite3-v$ver-electron-v132-win32-x64.tar.gz"
  $tempArchive = Join-Path $env:TEMP "better-sqlite3-v$ver-electron-v132-win32-x64.tar.gz"
  if (-not (Test-Path $tempArchive)) {
    Invoke-WebRequest -Uri $url -OutFile $tempArchive
  }
  tar -xzf $tempArchive -C $pkgDir
  New-Item -ItemType File -Force -Path $marker | Out-Null
  Write-Host "Extracted better_sqlite3.node v$ver to $pkgDir"
}
