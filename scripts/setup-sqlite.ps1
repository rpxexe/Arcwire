# Script to ensure better-sqlite3 prebuilt binary is in place for Electron 34 (ABI 132)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$pkgDirs = Get-ChildItem -Path "$root\node_modules\.pnpm" -Filter "better-sqlite3*" -Directory

foreach ($dir in $pkgDirs) {
  $targetNode = Join-Path $dir.FullName "node_modules\better-sqlite3\build\Release\better_sqlite3.node"
  if (-not (Test-Path $targetNode)) {
    Write-Host "Ensuring better-sqlite3 native binary in $($dir.FullName)..."
    $pkgDir = Join-Path $dir.FullName "node_modules\better-sqlite3"
    $url = "https://github.com/WiseLibs/better-sqlite3/releases/download/v11.8.1/better-sqlite3-v11.8.1-electron-v132-win32-x64.tar.gz"
    $tempArchive = "$env:TEMP\better-sqlite3-electron-v132.tar.gz"
    if (-not (Test-Path $tempArchive)) {
      Invoke-WebRequest -Uri $url -OutFile $tempArchive
    }
    tar -xzf $tempArchive -C $pkgDir
    Write-Host "Extracted better_sqlite3.node to $pkgDir"
  } else {
    Write-Host "better_sqlite3.node already present in $($dir.FullName)"
  }
}
