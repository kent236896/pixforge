# =============================================================================
# PixForge -- Path B: MSIX Package Build (Microsoft Store / Local Testing)
#
# Default behavior: always generates a self-signed test certificate and signs
# the MSIX so it can be installed locally via Add-AppPackage.
# Use -SkipSign to produce an unsigned MSIX for Store upload (Store re-signs).
#
# Tauri 2 does not have a native msix bundler target on Windows.
# This script compiles the binary via cargo, then creates the MSIX with
# makeappx.exe from the Windows SDK.
# =============================================================================
#
# Package identity (from Partner Center reservation):
#   Name             : DF1049EA.PixForge
#   Publisher        : CN=E2CDB98F-2BEB-4CD5-BDEF-657F4F848F1D
#   PublisherDisplay : 唐昆
#   PFN              : DF1049EA.PixForge_2z56fg7ja5tr2
#   Store ID         : 9PHM0JJCNF85
#
# Prerequisites:
#   - Rust toolchain  (rustup target add x86_64-pc-windows-msvc)
#   - pnpm            (npm i -g pnpm)
#   - Windows SDK 10 with makeappx.exe + signtool.exe
#   - Visual Studio Build Tools 2022
#
# Usage:
#   .\scripts\build-msix.ps1                    # build + sign for local install
#   .\scripts\build-msix.ps1 -Target arm64
#   .\scripts\build-msix.ps1 -SkipSign          # unsigned MSIX for Store upload
#   .\scripts\build-msix.ps1 -CertPassword mypass
# =============================================================================

param(
    [ValidateSet("x64", "arm64")]
    [string]$Target = "x64",

    # Skip signing -- produce unsigned MSIX for Store upload (Store re-signs)
    [switch]$SkipSign,

    # Password for the exported .pfx test certificate
    [string]$CertPassword = "password"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ROOT    = Split-Path $PSScriptRoot -Parent
$OUTDIR  = Join-Path $ROOT "dist-release\msix"
$CONF    = Get-Content (Join-Path $ROOT "src-tauri\tauri.conf.json") | ConvertFrom-Json
$VERSION = $CONF.version
# MSIX requires a 4-part version (Major.Minor.Patch.Build)
$MSIX_VERSION = "$VERSION.0"

$RUST_TARGET = if ($Target -eq "arm64") {
    "aarch64-pc-windows-msvc"
} else {
    "x86_64-pc-windows-msvc"
}
$PROC_ARCH = if ($Target -eq "arm64") { "arm64" } else { "x64" }

# Store identity constants
$IDENTITY_NAME  = "DF1049EA.PixForge"
$PUBLISHER_DN   = "CN=E2CDB98F-2BEB-4CD5-BDEF-657F4F848F1D"
$PUBLISHER_NAME = "唐昆"

Write-Host ""
Write-Host "=== PixForge MSIX Build ===" -ForegroundColor Cyan
Write-Host "  Target    : $RUST_TARGET"
Write-Host "  Identity  : $IDENTITY_NAME"
Write-Host "  Version   : $MSIX_VERSION"
Write-Host "  Signing   : $(if ($SkipSign) { 'SKIPPED (unsigned for Store upload)' } else { 'YES (self-signed, local testing)' })"
Write-Host "  OutDir    : $OUTDIR"
Write-Host ""

# -- 0. Ensure Rust target -----------------------------------------------------
Write-Host "[1/5] Checking Rust target..." -ForegroundColor Yellow
$installed = rustup target list --installed 2>&1
if ($installed -notmatch [regex]::Escape($RUST_TARGET)) {
    Write-Host "      Installing $RUST_TARGET..." -ForegroundColor Gray
    rustup target add $RUST_TARGET
}

# -- 1. Build frontend ---------------------------------------------------------
Write-Host "[2/5] Building frontend..." -ForegroundColor Yellow
Set-Location $ROOT
pnpm build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

# -- 2. Compile Tauri binary via cargo -----------------------------------------
# We bypass pnpm tauri build because Tauri 2 has no --bundles msix on Windows.
# cargo build reads tauri.conf.json and embeds the frontend dist at compile time.
Write-Host "[3/5] Compiling Tauri binary (cargo build --release)..." -ForegroundColor Yellow
$env:TAURI_ENV = "production"
Push-Location (Join-Path $ROOT "src-tauri")
cargo build --release --target $RUST_TARGET
$exitCode = $LASTEXITCODE
Pop-Location
if ($exitCode -ne 0) { throw "cargo build failed" }

$releaseDir = Join-Path $ROOT "src-tauri\target\$RUST_TARGET\release"
$exePath    = Join-Path $releaseDir "pixforge.exe"
if (-not (Test-Path $exePath)) {
    throw "Binary not found at $exePath. Check src-tauri/Cargo.toml [package].name."
}
$exeSize = [math]::Round((Get-Item $exePath).Length / 1MB, 1)
Write-Host "      Binary : pixforge.exe ($exeSize MB)" -ForegroundColor Gray

# -- 3. Stage MSIX layout ------------------------------------------------------
Write-Host "[4/5] Staging MSIX package layout..." -ForegroundColor Yellow

$stageDir  = Join-Path $ROOT "dist-release\msix-stage"
$assetsDir = Join-Path $stageDir "Assets"
if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null

# Main executable
Copy-Item $exePath (Join-Path $stageDir "PixForge.exe") -Force

# ONNX model
$modelSrc = Join-Path $ROOT "src-tauri\models\silueta.onnx"
if (Test-Path $modelSrc) {
    $modelDst = Join-Path $stageDir "models"
    New-Item -ItemType Directory -Path $modelDst -Force | Out-Null
    Copy-Item $modelSrc $modelDst -Force
    Write-Host "      Model : silueta.onnx copied" -ForegroundColor Gray
}

# Icon assets
$iconSrc = Join-Path $ROOT "src-tauri\icons"
$iconMap = @(
    @{ Src = "Square44x44Logo.png";    Dst = "Square44x44Logo.png" },
    @{ Src = "Square150x150Logo.png";  Dst = "Square150x150Logo.png" },
    @{ Src = "Square310x310Logo.png";  Dst = "Square310x310Logo.png" },
    @{ Src = "StoreLogo.png";          Dst = "StoreLogo.png" },
    @{ Src = "128x128.png";            Dst = "Wide310x150Logo.png" },
    @{ Src = "128x128.png";            Dst = "SplashScreen.png" }
)
foreach ($entry in $iconMap) {
    $src = Join-Path $iconSrc $entry.Src
    $dst = Join-Path $assetsDir $entry.Dst
    if (Test-Path $src) { Copy-Item $src $dst -Force }
}
# Ensure required assets exist (fallback to any available PNG)
$fallback = Get-ChildItem $iconSrc -Filter "*.png" | Sort-Object Length -Descending | Select-Object -First 1
$required = @("Square44x44Logo.png","Square150x150Logo.png","StoreLogo.png","SplashScreen.png","Wide310x150Logo.png")
foreach ($asset in $required) {
    $dst = Join-Path $assetsDir $asset
    if (-not (Test-Path $dst) -and $fallback) { Copy-Item $fallback.FullName $dst -Force }
}

# Generate AppxManifest.xml
$appxManifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">

  <Identity
    Name="$IDENTITY_NAME"
    Publisher="$PUBLISHER_DN"
    Version="$MSIX_VERSION"
    ProcessorArchitecture="$PROC_ARCH" />

  <Properties>
    <DisplayName>PixForge</DisplayName>
    <PublisherDisplayName>$PUBLISHER_NAME</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>

  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>

  <Resources>
    <Resource Language="en-US" />
    <Resource Language="zh-CN" />
  </Resources>

  <Applications>
    <Application Id="App" Executable="PixForge.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="PixForge"
        Description="Lightweight image processing desktop application"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile
          Wide310x150Logo="Assets\Wide310x150Logo.png"
          Square310x310Logo="Assets\Square310x310Logo.png" />
        <uap:SplashScreen Image="Assets\SplashScreen.png" />
      </uap:VisualElements>
    </Application>
  </Applications>

  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
$appxManifest | Out-File -FilePath (Join-Path $stageDir "AppxManifest.xml") -Encoding utf8 -Force
Write-Host "      Stage : $stageDir" -ForegroundColor Gray

# -- 4. Locate makeappx.exe ----------------------------------------------------
Write-Host "[5/5] Packing MSIX with makeappx.exe..." -ForegroundColor Yellow

$sdkBinRoot = "C:\Program Files (x86)\Windows Kits\10\bin"
$makeappx   = $null
if (Test-Path $sdkBinRoot) {
    $makeappx = Get-ChildItem $sdkBinRoot -Recurse -Filter "makeappx.exe" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "x64" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $makeappx) {
    throw @"
makeappx.exe not found in $sdkBinRoot
Install the Windows 10 SDK:
  winget install --id Microsoft.WindowsSDK.10.0.26100 --source winget
Or download from https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/
"@
}
Write-Host "      makeappx : $makeappx" -ForegroundColor Gray

New-Item -ItemType Directory -Path $OUTDIR -Force | Out-Null
$msixName = "PixForge_${VERSION}_${Target}.msix"
$dest     = Join-Path $OUTDIR $msixName

& $makeappx pack /d $stageDir /p $dest /overwrite
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed" }

# -- 5. Self-sign for local installation ---------------------------------------
if (-not $SkipSign) {
    Write-Host ""
    Write-Host "Signing MSIX for local installation..." -ForegroundColor Yellow

    $pfxFile = Join-Path $OUTDIR "PixForge-test.pfx"
    $cerFile = Join-Path $OUTDIR "PixForge-test.cer"
    $certSecure = ConvertTo-SecureString -String $CertPassword -Force -AsPlainText

    # Create (or reuse) a self-signed cert matching the Store publisher DN
    $existingCert = Get-ChildItem "Cert:\CurrentUser\My" |
        Where-Object { $_.Subject -eq $PUBLISHER_DN } |
        Sort-Object NotBefore -Descending |
        Select-Object -First 1

    if ($existingCert -and $existingCert.NotAfter -gt (Get-Date).AddDays(30)) {
        $cert = $existingCert
        Write-Host "  Reusing existing cert (expires $($cert.NotAfter.ToString('yyyy-MM-dd')))" -ForegroundColor Gray
    } else {
        $cert = New-SelfSignedCertificate `
            -Subject $PUBLISHER_DN `
            -KeyUsage DigitalSignature `
            -KeyAlgorithm RSA `
            -KeyLength 2048 `
            -HashAlgorithm SHA256 `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -NotAfter (Get-Date).AddYears(3) `
            -Type CodeSigningCert
        Write-Host "  Created new cert (expires $($cert.NotAfter.ToString('yyyy-MM-dd')))" -ForegroundColor Gray
    }

    # Export PFX (for signing) and CER (public cert for other machines)
    Export-PfxCertificate -Cert $cert -FilePath $pfxFile -Password $certSecure -Force | Out-Null
    Export-Certificate -Cert $cert -FilePath $cerFile -Type CERT -Force | Out-Null
    Write-Host "  PFX : $pfxFile  (password: $CertPassword)" -ForegroundColor Gray
    Write-Host "  CER : $cerFile  (share this to trust on other machines)" -ForegroundColor Gray

    # Trust the cert locally so Add-AppPackage works
    $trusted = $false

    # Primary: LocalMachine\TrustedPeople (required for sideloading, needs admin)
    try {
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("TrustedPeople", "LocalMachine")
        $store.Open("ReadWrite")
        $store.Add($cert)
        $store.Close()
        Write-Host "  Trusted: LocalMachine\TrustedPeople (sideloading enabled)" -ForegroundColor Green
        $trusted = $true
    } catch {
        Write-Host "  LocalMachine\TrustedPeople requires admin -- trying fallback" -ForegroundColor DarkYellow
    }

    # Fallback: CurrentUser\Root (no admin required)
    if (-not $trusted) {
        try {
            $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "CurrentUser")
            $store.Open("ReadWrite")
            $store.Add($cert)
            $store.Close()
            Write-Host "  Trusted: CurrentUser\Root" -ForegroundColor Green
            $trusted = $true
        } catch {
            Write-Host "  Could not add cert to any trust store automatically" -ForegroundColor Red
        }
    }

    # Sign the MSIX
    $signtool = $null
    if (Test-Path $sdkBinRoot) {
        $signtool = Get-ChildItem $sdkBinRoot -Recurse -Filter "signtool.exe" -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "x64" } |
            Sort-Object FullName -Descending |
            Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $signtool) { throw "signtool.exe not found -- install Windows SDK" }

    & $signtool sign /fd sha256 /f $pfxFile /p $CertPassword "$dest"
    if ($LASTEXITCODE -ne 0) { throw "MSIX signing failed" }
    Write-Host "  Signed OK" -ForegroundColor Green
}

# -- Done ----------------------------------------------------------------------
$size = [math]::Round((Get-Item $dest).Length / 1MB, 1)
Write-Host ""
Write-Host "=== Build complete ===" -ForegroundColor Green
Write-Host "  MSIX : $dest  ($size MB)"
if (-not $SkipSign) {
    Write-Host "  PFX  : $(Join-Path $OUTDIR 'PixForge-test.pfx')  (password: $CertPassword)"
    Write-Host "  CER  : $(Join-Path $OUTDIR 'PixForge-test.cer')"
}
Write-Host ""

if (-not $SkipSign) {
    Write-Host "--- Install on THIS machine ---" -ForegroundColor Cyan
    Write-Host "  Double-click the .msix file, or run:"
    Write-Host "    Add-AppPackage -Path ""$dest"""
    Write-Host ""
    Write-Host "--- Install cert on ANOTHER test machine (run as Admin) ---" -ForegroundColor Cyan
    Write-Host "  Copy PixForge-test.cer to the target machine, then run:"
    Write-Host "    Import-Certificate -FilePath PixForge-test.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople"
    Write-Host "  Then install the .msix normally."
    Write-Host ""
    Write-Host "--- Upload to Microsoft Store (no cert needed) ---" -ForegroundColor Cyan
    Write-Host "  Run:  pnpm build:msix -- -SkipSign"
    Write-Host "  Then upload the unsigned MSIX to Partner Center."
    Write-Host "  Store re-signs with: $PUBLISHER_DN"
} else {
    Write-Host "--- Upload to Microsoft Store ---" -ForegroundColor Cyan
    Write-Host "  Log in to https://partner.microsoft.com/dashboard"
    Write-Host "  PixForge > Submissions > Packages > Upload $msixName"
    Write-Host "  Store signs with: $PUBLISHER_DN"
}
Write-Host ""
