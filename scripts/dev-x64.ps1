$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $projectRoot '.tools\node-x64-24.21.0\node-v24.21.0-win-x64'
$nodeExe = Join-Path $runtimeRoot 'node.exe'
$npmCmd = Join-Path $runtimeRoot 'npm.cmd'
$stagingRoot = Join-Path $env:TEMP 'LittleLessons-x64-app'

if (-not (Test-Path -LiteralPath $nodeExe) -or -not (Test-Path -LiteralPath $npmCmd)) {
  throw "The project-local x64 Node.js runtime is missing: $runtimeRoot"
}

New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
foreach ($file in @('package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $stagingRoot -Force
}
foreach ($directory in @('src', 'server', 'db', 'scripts')) {
  $source = Join-Path $projectRoot $directory
  $target = Join-Path $stagingRoot $directory
  & robocopy $source $target /E /R:2 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Could not stage project files from $source (robocopy $LASTEXITCODE)." }
}
Copy-Item -LiteralPath (Join-Path $projectRoot '.env') -Destination $stagingRoot -Force

$lockHash = (& $nodeExe -e "const fs=require('node:fs');const crypto=require('node:crypto');process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" (Join-Path $stagingRoot 'package-lock.json')).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not fingerprint package-lock.json using the x64 runtime.' }
$stamp = Join-Path $stagingRoot '.x64-dependencies.sha256'
$needsInstall = -not (Test-Path -LiteralPath (Join-Path $stagingRoot 'node_modules\@remotion\compositor-win32-x64-msvc'))
if (-not $needsInstall -and (Test-Path -LiteralPath $stamp)) {
  $needsInstall = [System.IO.File]::ReadAllText($stamp).Trim() -ne $lockHash
} else {
  $needsInstall = $true
}

if ($needsInstall) {
  Push-Location $stagingRoot
  try {
    & $npmCmd ci
    if ($LASTEXITCODE -ne 0) { throw "Installing x64 dependencies failed (npm ci $LASTEXITCODE)." }
    [System.IO.File]::WriteAllText($stamp, $lockHash)
  } finally {
    Pop-Location
  }
}

$env:PATH = "$runtimeRoot;$env:PATH"
Push-Location $stagingRoot
try {
  & $npmCmd run dev:server
  if ($LASTEXITCODE -ne 0) { throw "The video studio exited with code $LASTEXITCODE." }
} finally {
  Pop-Location
}
