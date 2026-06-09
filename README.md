# PixForge

轻量级图片处理桌面应用 · Lightweight image processing desktop app for Windows

Built with **Tauri 2 + React 19 + Rust** — targets Microsoft Store (Windows x64 / ARM64).

---

## Features

| Module | Description |
|---|---|
| **Convert** | PNG · JPG · WEBP · AVIF · GIF · TIFF · BMP · SVG · HEIC → any output format; quality control; EXIF options |
| **Resize** | Percent / exact / longest-side / fit / fill; lock aspect ratio; no-upscale guard; drag handles in preview |
| **Crop & Rotate** | Interactive crop overlay; arbitrary angle; 90/180/270° quick-rotate; flip H/V |
| **Batch** | Multi-file queue; folder drag-drop; convert + resize + optimize; named output templates; real-time progress; cancel |
| **Optimize** | JPEG (mozjpeg) · PNG (oxipng lossless) · WebP · AVIF; before/after size preview |
| **BgEffect** | Background removal (ONNX silueta model) with transparent or fill output; 10 image effects (grayscale, blur, sketch, vignette, neon edge, …) |

All processing is **pure Rust** — no external executables, no shell calls. Passes Windows App Certification Kit (WACK) S-Mode check by design.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | [Tauri 2](https://tauri.app) — Rust backend + WebView2 |
| Frontend | React 19 · TypeScript · Vite |
| Styling | Tailwind CSS v4 · shadcn/ui · lucide-react |
| Animation | Framer Motion |
| State | Zustand |
| Image engine | image-rs · resvg · oxipng · mozjpeg · webp · ravif · ort (ONNX) · Windows WIC (HEIC) |
| i18n | Custom lightweight EN / 中文 system (auto-detects system locale) |

---

## Local Development

### Prerequisites

- [Rust](https://rustup.rs) stable toolchain
- [Node.js](https://nodejs.org) ≥ 20
- [pnpm](https://pnpm.io) (`npm i -g pnpm`)
- [Visual Studio Build Tools 2022](https://aka.ms/vs/17/release/vs_BuildTools.exe) (MSVC + Windows SDK)
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) runtime (pre-installed on Windows 11)

```powershell
# Clone and install
git clone <repo-url>
cd pixforge
pnpm install

# Start dev server (hot-reload frontend + Tauri window)
pnpm tauri dev
```

The first build compiles all Rust crates including ONNX Runtime — expect ~3–5 minutes. Subsequent builds are incremental.

---

## Building for Release

### Quick start

```powershell
# NSIS installer (Path A) — x64
pnpm build:nsis

# MSIX package (Path B, for Store) — x64
pnpm build:msix

# Both paths, x64 only
pnpm build:release

# Both paths, x64 + ARM64
pnpm build:release:arm64
```

Output goes to `dist-release/nsis/` and `dist-release/msix/`.

---

## Publishing to Microsoft Store

### Package Identity

| Field | Value |
|---|---|
| Identity Name | `DF1049EA.PixForge` |
| Publisher DN | `CN=E2CDB98F-2BEB-4CD5-BDEF-657F4F848F1D` |
| Publisher Display | `唐昆` |
| Package Family Name | `DF1049EA.PixForge_2z56fg7ja5tr2` |
| Store ID | `9PHM0JJCNF85` |

### Path A — EXE/MSI installer

Requires a code-signing certificate from a trusted CA (DigiCert, Sectigo, etc.). The Store does **not** sign EXE installers on your behalf.

```powershell
$env:CERT_THUMBPRINT = "<sha1-of-your-cert>"
pnpm build:nsis
```

In Partner Center: **New submission → Package type: EXE or MSI app** → upload the `.exe`.

### Path B — MSIX (recommended)

No code-signing certificate needed. The Store re-signs the package with your reserved identity.

```powershell
pnpm build:msix
```

In Partner Center: **New submission → Packages** → upload `PixForge_1.0.0_x64.msix`.  
The Store signs with Publisher DN `CN=E2CDB98F-2BEB-4CD5-BDEF-657F4F848F1D` automatically.

For the full step-by-step guide including screenshots, age rating, description requirements, and version bump workflow, see [docs/store-submission.md](docs/store-submission.md).

---

## WACK Compliance

Run before every Store submission:

```powershell
pnpm build:msix
pnpm check:compliance -- -MsixPath dist-release\msix\PixForge_1.0.0_x64.msix
```

`scripts/check-compliance.ps1` verifies:

- **No external process spawning** — scans Rust source for `Command::new`, `ShellExecute`, `CreateProcess`. PixForge calls zero external executables.
- **Package identity** — `identifier` and `publisher` match Store reservation.
- **Required icon assets** — StoreLogo, Square tiles, `.ico`.
- **Privacy policy file** present (`docs/privacy-policy.md`).
- **WACK** — runs `appcert.exe` automatically if Windows App Certification Kit is installed; parses the XML report.

---

## Project Structure

```
pixforge/
├── src/                        # React frontend
│   ├── components/
│   │   ├── layout/             # Titlebar · Sidebar · Statusbar
│   │   └── ErrorBoundary.tsx
│   ├── features/               # One folder per module
│   │   ├── convert/
│   │   ├── resize/
│   │   ├── crop/
│   │   ├── batch/
│   │   ├── optimize/
│   │   ├── bg_effect/
│   │   └── settings/           # Language · Theme · About
│   ├── lib/
│   │   ├── invoke.ts           # Tauri command wrappers + types
│   │   └── i18n.ts             # EN / ZH translation dictionary + useT() hook
│   └── store/
│       └── app.ts              # Zustand global state
├── src-tauri/
│   ├── src/
│   │   ├── image_engine.rs     # All image processing (convert · resize · crop · optimize · batch · bg · effects)
│   │   └── lib.rs              # Tauri command handlers
│   ├── icons/                  # Full icon set (generated by `pnpm tauri icon`)
│   ├── models/
│   │   └── silueta.onnx        # Background removal model (43 MB)
│   └── tauri.conf.json
├── scripts/
│   ├── build-nsis.ps1          # Path A: NSIS installer + optional signing
│   ├── build-msix.ps1          # Path B: MSIX for Store
│   ├── build-all.ps1           # Both paths, multi-arch
│   └── check-compliance.ps1   # WACK + pre-submission audit
└── docs/
    ├── store-submission.md     # Full Partner Center guide
    └── privacy-policy.md       # Hosted at public URL for Store listing
```

---

## Icon Regeneration

Place a 1024×1024 PNG source at `./app-icon.png`, then:

```powershell
pnpm tauri icon ./app-icon.png
```

Generates all required sizes including `StoreLogo.png`, Square tiles, and `.ico`.

---

## Version Bump

1. Edit `version` in `src-tauri/tauri.conf.json`
2. Edit `version` in `src-tauri/Cargo.toml`
3. `pnpm build:release`
4. `pnpm check:compliance -- -MsixPath dist-release\msix\PixForge_<version>_x64.msix`
5. Upload to Partner Center.

---

## Privacy

PixForge processes all images **locally**. No images, metadata, or personal data leave the device. No analytics, no telemetry, no network requests. See [docs/privacy-policy.md](docs/privacy-policy.md).

---

## License

Copyright © 2025 唐昆. All rights reserved.
