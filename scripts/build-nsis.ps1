# =============================================================================
# PixForge — Path A: NSIS Installer Build (EXE / MSI)
# Microsoft Store listing type: "EXE or MSI app"
# =============================================================================
#
# Prerequisites:
#   - Rust toolchain  (rustup target add x86_64-pc-windows-msvc)
#   - NSIS 3.x        (https://nsis.sourceforge.io, must be on PATH)
#   - pnpm            (npm i -g pnpm)
#   - Visual Studio Build Tools or VS 2022
#
# Optional (code-signing):
#   Set $env:CERT_THUMBPRINT to your code-signing cert SHA-1 thumbprint.
#   The cert must already be installed in the Windows certificate store.
#   Without a cert the installer is built unsigned — fine for testing,
#   but REQUIRED for Partner Center "EXE or MSI" submission.
#
# Usage:
#   .\scripts\build-nsis.ps1
#   .\scripts\build-nsis.ps1 -Target arm64
#   .\scripts\build-nsis.ps1 -SkipSign
# =============================================================================

param(
    [ValidateSet("x64", "arm64")]
    [string]$Target = "x64",

    [switch]$SkipSign
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ROOT   = Split-Path $PSScriptRoot -Parent
$OUTDIR = Join-Path $ROOT "dist-release\nsis"

$RUST_TARGET = if ($Target -eq "arm64") {
    "aarch64-pc-windows-msvc"
} else {
    "x86_64-pc-windows-msvc"
}

Write-Host ""
Write-Host "=== PixForge NSIS Build ===" -ForegroundColor Cyan
Write-Host "  Target : $RUST_TARGET"
Write-Host "  OutDir : $OUTDIR"
Write-Host ""

# ── 0. Ensure Rust target is installed ────────────────────────────────────────
Write-Host "[1/4] Checking Rust target..." -ForegroundColor Yellow
$installed = rustup target list --installed 2>&1
if ($installed -notmatch [regex]::Escape($RUST_TARGET)) {
    Write-Host "      Installing $RUST_TARGET..." -ForegroundColor Gray
    rustup target add $RUST_TARGET
}

# ── 1. Build frontend ─────────────────────────────────────────────────────────
Write-Host "[2/4] Building frontend..." -ForegroundColor Yellow
Set-Location $ROOT
pnpm build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

# ── 2. Build Tauri NSIS bundle ────────────────────────────────────────────────
Write-Host "[3/4] Building NSIS installer..." -ForegroundColor Yellow
pnpm tauri build --target $RUST_TARGET --bundles nsis
if ($LASTEXITCODE -ne 0) { throw "Tauri NSIS build failed" }

# ── 3. Collect output ─────────────────────────────────────────────────────────
$bundleDir = Join-Path $ROOT "src-tauri\target\$RUST_TARGET\release\bundle\nsis"
$nsis      = Get-ChildItem $bundleDir -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nsis) { throw "NSIS installer not found in $bundleDir" }

New-Item -ItemType Directory -Path $OUTDIR -Force | Out-Null
$dest = Join-Path $OUTDIR $nsis.Name
Copy-Item $nsis.FullName $dest -Force
Write-Host "  Installer : $dest" -ForegroundColor Gray

# ── 4. Code-sign (optional) ───────────────────────────────────────────────────
$thumbprint = $env:CERT_THUMBPRINT
if (-not $SkipSign -and $thumbprint) {
    Write-Host "[4/4] Signing installer..." -ForegroundColor Yellow

    $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if (-not $signtool) {
        # Try common SDK paths
        $candidates = @(
            "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe",
            "C:\Program Files (x86)\Windows Kits\10\bin\x64\signtool.exe"
        )
        $signtool = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
        if (-not $signtool) { throw "signtool.exe not found. Install Windows SDK." }
    } else {
        $signtool = $signtool.Source
    }

    & $signtool sign `
        /sha1  $thumbprint `
        /fd    sha256 `
        /td    sha256 `
        /tr    "http://timestamp.digicert.com" `
        /d     "PixForge" `
        /du    "https://pixforge.app" `
        "$dest"
    if ($LASTEXITCODE -ne 0) { throw "Signing failed" }
    Write-Host "  Signed OK" -ForegroundColor Green
} elseif (-not $SkipSign -and -not $thumbprint) {
    Write-Host "[4/4] Skipping signing (CERT_THUMBPRINT not set)" -ForegroundColor DarkYellow
    Write-Host "      Set `$env:CERT_THUMBPRINT to sign automatically." -ForegroundColor DarkGray
} else {
    Write-Host "[4/4] Signing skipped (-SkipSign flag)" -ForegroundColor DarkYellow
}

# ── Done ──────────────────────────────────────────────────────────────────────
$size = [math]::Round((Get-Item $dest).Length / 1MB, 1)
Write-Host ""
Write-Host "=== Build complete ===" -ForegroundColor Green
Write-Host "  File : $dest"
Write-Host "  Size : $size MB"
Write-Host ""
Write-Host "Next steps (Partner Center — EXE/MSI path):" -ForegroundColor Cyan
Write-Host "  1. Ensure installer is signed with a trusted EV or standard code-signing cert."
Write-Host "  2. Partner Center > New submission > Package type: EXE or MSI"
Write-Host "  3. Upload $($nsis.Name)"
Write-Host "  4. Fill screenshots, description, age rating, privacy policy URL."
Write-Host ""
