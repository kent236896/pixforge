# =============================================================================
# PixForge -- Full Release Build
# Runs both Path A (NSIS) and Path B (MSIX) for x64 and arm64.
# =============================================================================
#
# Usage:
#   .\scripts\build-all.ps1                   # x64 only
#   .\scripts\build-all.ps1 -IncludeArm64     # x64 + arm64
#   .\scripts\build-all.ps1 -NsisOnly         # NSIS/EXE only
#   .\scripts\build-all.ps1 -MsixOnly         # MSIX only
# =============================================================================

param(
    [switch]$IncludeArm64,
    [switch]$NsisOnly,
    [switch]$MsixOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ROOT    = Split-Path $PSScriptRoot -Parent
$OUTDIR  = Join-Path $ROOT "dist-release"
$START   = Get-Date

function Section($msg) {
    Write-Host ""
    Write-Host ("-" * 60) -ForegroundColor DarkGray
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host ("-" * 60) -ForegroundColor DarkGray
}

function RunScript($script, $params) {
    $full = Join-Path $PSScriptRoot $script
    & $full @params
    if ($LASTEXITCODE -ne 0) { throw "$script failed (exit $LASTEXITCODE)" }
}

$targets = @("x64")
if ($IncludeArm64) { $targets += "arm64" }

Write-Host ""
Write-Host "+---------------------------------------+" -ForegroundColor Cyan
Write-Host "|   PixForge Release Build              |" -ForegroundColor Cyan
Write-Host "+---------------------------------------+" -ForegroundColor Cyan
Write-Host "  Targets : $($targets -join ', ')"
Write-Host "  Bundles : $(if ($NsisOnly) {'NSIS'} elseif ($MsixOnly) {'MSIX'} else {'NSIS + MSIX'})"
Write-Host "  Output  : $OUTDIR"

foreach ($target in $targets) {
    if (-not $MsixOnly) {
        Section "NSIS ($target)"
        RunScript "build-nsis.ps1" @{ Target = $target }
    }
    if (-not $NsisOnly) {
        Section "MSIX ($target)"
        RunScript "build-msix.ps1" @{ Target = $target }
    }
}

# -- Summary -------------------------------------------------------------------
$elapsed = [math]::Round(((Get-Date) - $START).TotalMinutes, 1)
Write-Host ""
Write-Host ("=" * 60) -ForegroundColor Green
Write-Host "  All builds complete  ($elapsed min)" -ForegroundColor Green
Write-Host ("=" * 60) -ForegroundColor Green
Write-Host ""
Write-Host "Output files:" -ForegroundColor Yellow
Get-ChildItem $OUTDIR -Recurse -Include "*.exe","*.msi","*.msix" |
    ForEach-Object {
        $sz = [math]::Round($_.Length / 1MB, 1)
        Write-Host ("  {0,-55} {1,6} MB" -f $_.FullName.Replace($ROOT + "\", ""), $sz)
    }
Write-Host ""
