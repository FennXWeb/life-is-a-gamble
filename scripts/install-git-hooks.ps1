$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
git -C $root config core.hooksPath .githooks
Write-Host "Git hooks enabled. Future commits will mirror to the GitHub testing branch."
