# =============================================================================
# PixForge -- Pre-submission Compliance Check
# Runs Windows App Certification Kit (WACK) + manual checklist.
# =============================================================================
#
# Usage:
#   .\scripts\check-compliance.ps1 -MsixPath "dist-release\msix\PixForge_1.0.0_x64.msix"
#   .\scripts\check-compliance.ps1 -SkipWack   (checklist only)
# =============================================================================

param(
    [string]$MsixPath = "",
    [switch]$SkipWack
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"   # don't abort -- we want the full report

$ROOT   = Split-Path $PSScriptRoot -Parent
$PASS   = 0
$WARN   = 0
$FAIL   = 0

function OK($msg)   { Write-Host "  [PASS] $msg" -ForegroundColor Green;  $script:PASS++ }
function WARN($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow; $script:WARN++ }
function FAIL($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red;    $script:FAIL++ }
function HEAD($msg) {
    Write-Host ""
    Write-Host "-- $msg" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "+----------------------------------------------+" -ForegroundColor Cyan
Write-Host "|  PixForge Pre-submission Compliance Check    |" -ForegroundColor Cyan
Write-Host "+----------------------------------------------+" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
HEAD "1. No External Process Spawning (WACK S-Mode)"
# -----------------------------------------------------------------------------

$forbidden = @(
    "Command::new",
    "std::process::Command",
    "shell_execute",
    "ShellExecute",
    "CreateProcess",
    "WinExec"
)
$rustSrc = Join-Path $ROOT "src-tauri\src"
$found   = $false
foreach ($pattern in $forbidden) {
    $hits = Get-ChildItem $rustSrc -Recurse -Filter "*.rs" |
        Select-String -Pattern $pattern -SimpleMatch -ErrorAction SilentlyContinue
    if ($hits) {
        FAIL "Found '$pattern' in Rust source -- may fail WACK S-Mode check"
        $hits | ForEach-Object { Write-Host "      $($_.Filename):$($_.LineNumber)" -ForegroundColor DarkRed }
        $found = $true
    }
}
if (-not $found) { OK "No external process spawning found in Rust source" }

# -----------------------------------------------------------------------------
HEAD "2. Package Identity"
# -----------------------------------------------------------------------------

$conf = Get-Content (Join-Path $ROOT "src-tauri\tauri.conf.json") | ConvertFrom-Json

if ($conf.identifier -eq "DF1049EA.PixForge") {
    OK "identifier = DF1049EA.PixForge (matches Store reservation)"
} else {
    FAIL "identifier '$($conf.identifier)' does not match Store reservation 'DF1049EA.PixForge'"
}

if ($conf.bundle.publisher -eq "Tang Kun" -or $conf.bundle.publisher -eq "唐昆") {
    OK "publisher = $($conf.bundle.publisher)"
} else {
    WARN "publisher is '$($conf.bundle.publisher)' -- should be '唐昆'"
}

if ($conf.version -match "^\d+\.\d+\.\d+$") {
    OK "version = $($conf.version) (valid semver)"
} else {
    FAIL "version '$($conf.version)' is not valid semver (x.y.z required)"
}

# -----------------------------------------------------------------------------
HEAD "3. Assets"
# -----------------------------------------------------------------------------

$requiredIcons = @(
    "icons\StoreLogo.png",
    "icons\Square44x44Logo.png",
    "icons\Square150x150Logo.png",
    "icons\Square310x310Logo.png",
    "icons\icon.ico"
)
foreach ($icon in $requiredIcons) {
    $path = Join-Path $ROOT "src-tauri\$icon"
    if (Test-Path $path) { OK "Icon: $icon" }
    else { FAIL "Missing icon: $icon" }
}

# -----------------------------------------------------------------------------
HEAD "4. Privacy Policy"
# -----------------------------------------------------------------------------

$privacyFiles = @(
    "docs\privacy-policy.md",
    "docs\privacy-policy.html",
    "privacy-policy.md"
)
$hasPrivacy = $privacyFiles | Where-Object { Test-Path (Join-Path $ROOT $_) }
if ($hasPrivacy) {
    OK "Privacy policy file found: $($hasPrivacy | Select-Object -First 1)"
} else {
    WARN "No privacy policy file found -- required for Store submission"
    Write-Host "      Create docs\privacy-policy.md or host at a public URL" -ForegroundColor DarkGray
}

# -----------------------------------------------------------------------------
HEAD "5. MSIX Package Check"
# -----------------------------------------------------------------------------

if ($MsixPath -and (Test-Path $MsixPath)) {
    OK "MSIX file found: $MsixPath"
    $size = [math]::Round((Get-Item $MsixPath).Length / 1MB, 1)
    Write-Host "      Size: $size MB" -ForegroundColor DarkGray

    if (-not $SkipWack) {
        $wackTool = "C:\Program Files (x86)\Windows Kits\10\App Certification Kit\appcert.exe"
        if (Test-Path $wackTool) {
            HEAD "6. Windows App Certification Kit (WACK)"
            $reportDir = Join-Path $ROOT "dist-release\wack-report"
            New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
            $reportXml = Join-Path $reportDir "wack-report.xml"

            Write-Host "  Running WACK (this takes ~2 minutes)..." -ForegroundColor Yellow
            & $wackTool test `
                -apptype windowsapp `
                -packagepath $MsixPath `
                -reportoutputpath $reportXml `
                -overwritereport enable

            if (Test-Path $reportXml) {
                [xml]$report = Get-Content $reportXml
                $overall = $report.REPORT.OVERALL_RESULT.value
                if ($overall -eq "PASS") {
                    OK "WACK result: PASS"
                } elseif ($overall -eq "WARNING") {
                    WARN "WACK result: WARNING -- review $reportXml"
                } else {
                    FAIL "WACK result: $overall -- see $reportXml"
                }
                Write-Host "      Report: $reportXml" -ForegroundColor DarkGray
            } else {
                WARN "WACK report not generated -- run manually"
            }
        } else {
            WARN "WACK not found at expected path. Install 'Windows App Certification Kit' from SDK."
            Write-Host "      $wackTool" -ForegroundColor DarkGray
        }
    }
} elseif ($MsixPath) {
    FAIL "MSIX not found: $MsixPath"
} else {
    WARN "No -MsixPath provided -- skipping MSIX checks. Build with build-msix.ps1 first."
}

# -----------------------------------------------------------------------------
HEAD "Summary"
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host ("  PASS: $PASS   WARN: $WARN   FAIL: $FAIL") -ForegroundColor (
    if ($FAIL -gt 0) { "Red" } elseif ($WARN -gt 0) { "Yellow" } else { "Green" }
)
Write-Host ""

if ($FAIL -gt 0) {
    Write-Host "  [FAIL] Fix all FAIL items before submitting to the Store." -ForegroundColor Red
} elseif ($WARN -gt 0) {
    Write-Host "  [WARN] Review WARN items -- submission may still succeed." -ForegroundColor Yellow
} else {
    Write-Host "  [PASS] All checks passed. Ready for Store submission." -ForegroundColor Green
}
Write-Host ""

exit $(if ($FAIL -gt 0) { 1 } else { 0 })
