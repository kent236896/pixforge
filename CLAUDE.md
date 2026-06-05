# Claude Code 开发提示词 —— 轻量级图片处理桌面应用（PixForge）

> 用法：把本文件放进一个空目录，作为你给 Claude Code 的首条指令（或保存为 `CLAUDE.md` 作为项目宪法）。建议让 Claude Code **分阶段执行**，每个阶段完成后运行验证再继续。

* * *

## 0. 角色与总体目标

你是一名资深的 Tauri + React 桌面应用工程师，外加产品设计师。请帮我从零构建一个 **小巧、精悍、现代、好看** 的图片处理桌面应用，最终目标是 **上架 Microsoft Store**。

应用代号：**PixForge**。

核心原则（按优先级）：

1. **小巧精悍**：应用外壳尽量小，依赖尽量少，启动快，无臃肿。
2. **现代简洁美观**：UI 必须达到 Linear / Raycast / Arc 那种克制、精致的水准，不要"AI 默认审美"（不要满屏渐变、不要紫色霓虹、不要居中大卡片堆叠）。
3. **稳定可靠**：所有图片操作都要有错误处理、进度反馈、可取消。
4. **实现中英文版本切换**：系统检测当前默认使用什么语言。
5. **数据存储**：如果需要持久化的操作等使用 SQLite 存储。
6. **可上架**：从一开始就考虑 Microsoft Store 的打包、图标、清单、合规要求。

* * *

## 1. 技术栈（已确定，请严格遵守）

* **框架**：Tauri 2（Rust 后端 + WebView 前端），目标平台 **Windows x64（兼顾 ARM64）**。
* **前端**：React 18 + TypeScript + Vite。
* **样式**：Tailwind CSS + **shadcn/ui** 组件库 + **lucide-react** 图标。
* **动效**：Framer Motion（仅用于克制的微交互，不要花哨）。
* **状态管理**：Zustand（轻量），不要引入 Redux。
* **图像引擎**：纯 Rust **image-rs 生态**，所有图像操作直接在 Rust 进程内完成，**不调用任何外部可执行文件**。
  * `image` — 核心编解码（PNG / JPG / WEBP / GIF / TIFF / BMP）
  * `resvg` — SVG 栅格化（纯 Rust）
  * `ravif` + `avif` — AVIF 编解码
  * `oxipng` — PNG 无损压缩优化
  * `mozjpeg` — JPEG 高质量压缩（libjpeg-turbo 绑定）
  * `webp` — WebP 编码质量控制
  * `windows` crate + WIC — HEIC/HEIF 读取（调用 Windows 内置编解码器，零额外依赖）
* **包管理**：pnpm。

> 不要使用 Electron（太重）。不要使用浏览器 `localStorage`。所有持久化用 Tauri 的文件/store 插件。不要调用任何外部 shell / exe（WACK 合规要求）。

* * *

## 2. 功能需求（5 大模块）

每个功能都要：支持单张预览、显示处理前后参数、可一键导出、可加入批量队列。

### 2.1 格式转换 (Convert)

* 输入支持：PNG / JPG / JPEG / WEBP / AVIF / GIF / TIFF / BMP / HEIC / SVG（栅格化）。
* 输出支持：PNG / JPG / WEBP / AVIF / GIF / TIFF / BMP。
* 有损格式可调质量（quality 1–100）。
* 选项：背景色（透明转 JPG 时填充）、是否保留 EXIF 元数据。
* Rust 实现：`image::open()` 解码 → 转换色彩空间 → 对应 encoder 保存；SVG 先用 `resvg` 栅格化为 RGBA；HEIC 用 WIC 解码。

### 2.2 尺寸调整 (Resize)

* 模式：按百分比 / 按精确宽高 / 按最长边 / 适应 (fit) / 填充 (fill)。
* 选项：锁定宽高比、**不放大**（原图更小时跳过）、重采样滤镜（Lanczos3 默认）。
* Rust 实现：`image::imageops::resize(img, w, h, FilterType::Lanczos3)`；fit/fill 用 `thumbnail` 或手动计算裁剪偏移量。

### 2.3 裁剪 & 旋转 (Crop & Rotate)

* **交互式裁剪**：在预览图上拖拽选区，支持自由比例和预设比例（1:1 / 4:3 / 16:9 / 3:2）。选区以原图坐标输出。
* 旋转：快捷 90° / 180° / 270°；水平翻转、垂直翻转；任意角度旋转（空白处填透明或指定背景色）。
* Rust 实现：`image::imageops::rotate90/180/270()`；翻转用 `flipv/fliph()`；任意角度用仿射变换（`image::imageops::rotate` 或手动矩阵）；裁剪用 `DynamicImage::crop(x, y, w, h)`。

### 2.4 批量处理 (Batch)

* 拖入多张图片或整个文件夹（递归可选）。
* 对队列应用**同一套操作链**（可组合：转换 + 缩放 + 压缩）。
* 输出：选择输出文件夹 + 命名模板（如 `{name}_optimized.{ext}`、`{name}_{index}`）。
* 必须显示**总体进度条 + 单文件状态**（等待/处理中/成功/失败），失败不中断整个队列。
* 后端用 Tauri **事件 (emit)** 向前端实时推送进度（`batch://progress`）。
* 支持**取消**正在进行的批处理（`Arc<AtomicBool>` 取消令牌）。
* Rust 实现：`tauri::async_runtime::spawn_blocking` 将图像处理放到线程池；用 `rayon` 并行处理多文件。

### 2.5 压缩优化 (Optimize)

* JPEG：质量滑块 + 渐进式编码 + 去除 EXIF（`mozjpeg`）。
* PNG：`oxipng` 无损压缩，支持调整压缩级别。
* WebP：质量滑块（`webp` crate）。
* AVIF：质量滑块（`ravif`）。
* **目标文件大小模式**（可选）：二分法逼近目标体积，反复调整质量参数。
* 优化后展示：原大小 → 新大小 → 节省百分比。

* * *

## 3. 架构与图像引擎

### 3.1 前后端职责

* **前端 (React)**：UI、参数收集、预览、拖拽、队列管理。所有图像操作通过 `invoke()` 调用 Rust 命令。
* **后端 (Rust)**：
  * 暴露命令：`get_image_info`、`generate_preview`、`convert_image`、`resize_image`、`crop_rotate_image`、`optimize_image`、`run_batch`、`cancel_batch`。
  * 所有操作**纯 Rust 函数调用**，不派生任何子进程，不调用任何 shell。
  * 预览生成：对大图先生成缩略图（限制最大边 1200px）以保证 UI 流畅；导出时才用原图全尺寸处理。返回 base64 PNG 给前端展示。
  * 错误处理：所有 Rust 错误转成 `Result<T, String>` 返回前端，前端统一 toast 展示。

### 3.2 图像引擎 Cargo 依赖

```toml
[dependencies]
image = { version = "0.25", features = ["png", "jpeg", "webp", "gif", "tiff", "bmp", "avif"] }
resvg = "0.44"
oxipng = { version = "9", default-features = false, features = ["parallel"] }
ravif = "0.11"
webp = "0.3"
base64 = "0.22"
rayon = "1"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.61", features = ["Win32_Graphics_Imaging", "Win32_System_Com"] }
```

### 3.3 预览机制

前端预览图通过 `generate_preview(path, max_size)` 命令获取 base64 编码的 PNG。对于大图只生成缩略图，避免传输大数据。

* * *

## 4. UI / UX 设计规范（务必达到这个水准）

### 4.1 整体风格

* 参考 **Linear / Raycast / Vercel**：克制、留白充足、信息层级清晰、圆角 8–12px、阴影极轻。
* **明暗双主题**，默认跟随系统。
* 单一强调色（默认建议靛蓝 `#4F46E5` 或可改），其余为中性灰阶。**不要多彩渐变。**
* 字体：优先系统 UI 字体栈，或引入 **Inter**。数字用等宽体显示尺寸/大小。

### 4.2 布局

* **左侧窄边栏**：5 个功能模块图标 + 文字（Convert / Resize / Crop & Rotate / Batch / Optimize），底部放设置与主题切换。
* **中间主区**：
  * 空状态 = 一个大的、优雅的**拖拽放置区**（"拖入图片或点击选择"），支持点击选择文件。
  * 有图后 = 左预览（带棋盘格透明背景）、右参数面板。
* **底部状态条**：当前文件信息（格式 / 尺寸 / 大小）、操作进度、导出按钮。
* 批量模式用列表/网格缩略图 + 每项状态徽章。

### 4.3 交互细节

* 全局支持拖拽文件进入任意位置。
* 导出成功用 toast 提示，并提供"在资源管理器中显示"。
* 所有滑块实时更新预览（防抖处理，避免频繁调用后端）。
* 键盘快捷键：`Ctrl+O` 打开、`Ctrl+S` 导出、`Ctrl+Z` 撤销裁剪选区等。
* 自定义无边框窗口标题栏（Tauri decorations:false），含最小化/最大化/关闭，风格与应用一致。

### 4.4 反例（不要做）

* 不要满屏卡片堆叠、不要紫色霓虹渐变、不要 emoji 当图标、不要居中孤零零一个按钮的"落地页感"。

* * *

## 5. 项目结构（建议）

    pixforge/
    ├─ src/                        # React 前端
    │  ├─ components/              # shadcn 组件 + 自定义组件
    │  │  └─ layout/               # Titlebar / Sidebar / Statusbar
    │  ├─ features/                # convert / resize / crop / batch / optimize 各模块
    │  ├─ lib/                     # invoke 封装、类型、工具
    │  ├─ store/                   # zustand
    │  └─ App.tsx
    ├─ src-tauri/
    │  ├─ src/
    │  │  ├─ commands/             # 各图像命令（convert.rs / resize.rs 等）
    │  │  ├─ image_engine/         # 图像处理核心逻辑
    │  │  │  ├─ mod.rs
    │  │  │  ├─ info.rs            # get_image_info / generate_preview
    │  │  │  ├─ convert.rs         # 格式转换
    │  │  │  ├─ resize.rs          # 尺寸调整
    │  │  │  ├─ crop_rotate.rs     # 裁剪旋转
    │  │  │  ├─ optimize.rs        # 压缩优化
    │  │  │  └─ heic.rs            # Windows WIC HEIC 解码
    │  │  └─ lib.rs / main.rs
    │  ├─ icons/                   # 全套图标（tauri icon 生成）
    │  └─ tauri.conf.json
    ├─ package.json
    └─ README.md

* * *

## 6. 开发阶段（请按顺序执行，每阶段结束后运行并让我确认）

**阶段 0 — 脚手架** ✅ 已完成：Tauri 2 + React 19 + TS + Vite + Tailwind v4 + shadcn/ui + zustand + framer-motion，自定义标题栏、左侧边栏、拖放区、状态栏，`pnpm tauri dev` 正常运行。

**阶段 1 — image-rs 打通**：添加 `image` 等 crate 依赖；实现 `get_image_info`（格式/尺寸/大小）和 `generate_preview`（返回 base64 缩略图）；前端拖入图片后显示元数据和预览图。不需要任何外部 exe。

**阶段 2 — 单图核心管线**：实现 Convert + Resize + Crop&Rotate + Optimize 的后端命令与最简参数 UI，能处理并导出单张图片，带前后参数对比。

**阶段 3 — UI 精修**：按第 4 节规范实现完整布局、明暗主题、动效、快捷键、交互式裁剪选区（canvas overlay）。

**阶段 4 — 批量处理**：队列、命名模板、实时进度事件（rayon 并行）、取消令牌、失败隔离。

**阶段 5 — 打磨**：设置页、关于页、错误边界、空/加载/错误三态、可访问性（焦点、aria）、i18n 中英文切换。

**阶段 6 — 打包与上架准备**：见第 7 节。

> 工作方式约束：大改动前先告诉我方案；每个命令都要有错误处理；不要留 `// TODO` 占位逻辑；提交粒度清晰。

* * *

## 7. Microsoft Store 上架准备

###### 微软产品标识

* Package/Identity/Name：DF1049EA.PixForge
* Package/Identity/Publisher：CN=E2CDB98F-2BEB-4CD5-BDEF-657F4F848F1D
* Package/Properties/PublisherDisplayName：唐昆
* Package Family Name (PFN)：DF1049EA.PixForge_2z56fg7ja5tr2
* Package SID：S-1-15-2-2274949851-945104600-2351642349-3298797915-3405951878-2373593840-1409128053
* Store ID：9PHM0JJCNF85

请完成以下准备并写进 README 的"发布"章节：

1. **图标**：用 `pnpm tauri icon ./app-icon.png` 生成全套（含 Store 所需尺寸）。
2. **元数据**：在 `tauri.conf.json` 设置 `productName`、`version`、`identifier`、`publisher`（publisher 名称不能与 productName 相同）。
3. **实现两条上架路径**：
   * **路径 A（EXE/MSI，需代码签名证书）**：用 Tauri 生成 NSIS/MSI 离线安装包（WebView2 内嵌 Offline Installer），需代码签名、支持自动更新；Partner Center 选 "EXE or MSI app"。
   * **路径 B（MSIX，Store 替你签名）**：用微软官方工具或 `cargo-packager` 打成 MSIX，赋予 package identity，提交后 Store 签名。
4. **WACK 自检**：本项目**不调用任何外部 exe / shell**，天然通过 S Mode 安全检查。提交前仍需跑一遍 WACK 确认。
5. **合规**：隐私政策（纯本地处理、不上传图片）、年龄分级、应用描述与截图。

* * *

## 8. 验收标准（Definition of Done）

* [ ] `pnpm tauri build` 一次性产出可运行安装包，体积合理（目标 < 30MB）。
* [ ] 5 大功能全部可用，单图 + 批量都经过实测。
* [ ] 拖拽、明暗主题、自定义标题栏、进度与取消、错误提示全部就绪。
* [ ] 无控制台报错；格式不支持时有友好提示（非崩溃）。
* [ ] README 含：本地开发、构建、两条上架路径、WACK 说明。
* [ ] 通过一遍 WACK 自检。
