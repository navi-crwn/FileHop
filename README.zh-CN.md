<p align="center">🌐 <a href="README.md">English</a> · <b>简体中文</b> · <a href="README.de.md">Deutsch</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.ja.md">日本語</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a></p>

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.webp"><img src="docs/readme/hero-light.webp" alt="FileHop 首页：标题“什么都能转换，什么都不离开这台设备”，旁边是拖放区" width="100%"></picture></p>

<p align="center"><b>任何文件，任何格式，就在你的设备上。</b><br>FileHop 在浏览器里转换图片、PDF、表格、文本和压缩包。不上传任何东西。</p>

<p align="center">
  <a href="https://file.hel.ink"><b>在线试用</b></a> ·
  <a href="#自己部署">自己部署</a> ·
  <a href="#它能转换什么">它能转换什么</a> ·
  <a href="#常见问题">常见问题</a> ·
  <a href="docs/DEPLOY.md">部署</a> ·
  <a href="docs/TESTING.md">测试</a> ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

<p align="center"><sub>一个 Go 可执行文件 · 转换在浏览器标签页里完成 · 9 种语言 · 无广告、无跟踪 · 免费开源（MIT）</sub></p>

> [!IMPORTANT]
> FileHop 没有上传按钮，因为根本没有上传。文件通过浏览器的 File API 打开，在标签页里用你自己的 CPU 转换，再以下载的形式交还给你。服务器只负责发送应用本身，如果你登录了，再保存你的 HOP ID 会话。它从不接收任何文件。

FileHop 是一个可以自己部署的文件转换器。把文件拖到页面上，在每张卡片上选一个格式（或者给整组选一个），点“转换”，然后下载。它适合这些人：

- 需要把 PNG 转成 WebP、把扫描件转成 PDF，或把 PDF 拆成单页，又不想把文件交给某个网站，
- 想把 CSV 转成 JSON 或 YAML（或者反过来），却不想打开电子表格，
- 想看看 ZIP 里有什么，或核对文件的 SHA-256，而手头的电脑又不能装软件。

一条命令就能安装。脚本会检查你的电脑，问几个问题，还可以把 FileHop 连接到 HOP ID 账户中心：

```bash
curl -fsSL https://raw.githubusercontent.com/navi-crwn/FileHop/main/install.sh | bash
```

如果是克隆下来的仓库：`./install.sh`。用 `./update.sh` 更新，用 `./uninstall.sh` 卸载。加上 `--yes` 会接受所有默认选项；`--help` 会列出全部参数。

## 它能转换什么

| 类别 | 输入 | 输出 |
|---|---|---|
| 图片 | PNG, JPEG, WebP, AVIF\*, GIF, BMP, TIFF, ICO, SVG | WebP, AVIF\*, JPEG, PNG, PDF |
| PDF | PDF | 合并、拆分（ZIP）、旋转、选取页面、页面 → PNG/JPEG（ZIP）、文档信息（JSON） |
| 数据 | CSV, TSV, JSON, YAML | CSV, TSV, JSON, YAML |
| 文本 | Markdown, HTML, 纯文本 | HTML, Markdown, 纯文本 |
| 压缩包 | ZIP, TAR, GZIP | ZIP（重新打包）、GZIP、文件列表（JSON） |
| 任何文件 | 任意文件 | SHA-256, BLAKE3, MD5 |

\* 只有当浏览器自带的编码器能写出 AVIF 时，才会提供 AVIF 输出。Canvas 写不出来时会悄悄返回一张 PNG，所以 FileHop 会检查结果，宁可隐藏这个目标格式，也不会给你一个标错格式的文件。

**暂时还不支持：** DOCX 和 LaTeX（需要 pandoc，GPL 许可）、RAR 和 7z、视频和音频。应用会在格式说明里直接写明，不会假装支持。

2026-11-08 在 Chromium 158、Firefox 159 和 WebKit 引擎上测试过（各 22 项转换，全部通过）。Mac 或 iPhone 上的 Safari 还没有测试。详情见：[docs/TESTING.md](docs/TESTING.md)。

## 服务器能看到什么

- 应用自身的文件（HTML、脚本、字体）。所有请求都是同源的；页面不会从任何其他网站加载内容。
- 如果你用 HOP ID 登录：你的 HOP ID 号码、名字和邮箱，以及一个会话 Cookie。退出登录，或被账户中心登出时，会话会被删除。
- 永远看不到文件、文件名或转换结果。

页面以跨源隔离方式运行（`Cross-Origin-Embedder-Policy: require-corp`），并使用严格的内容安全策略：没有内联脚本，没有 `eval`，没有第三方主机。

## 自己部署

**用安装脚本**（见上文）：它会用 Node 20.19+ 构建浏览器端应用，用 Go 1.27+ 构建服务器，或者改用 Docker，并为你写好 `.env`、`start.sh` 和一个 systemd 单元。

**手动部署：**

```bash
npm ci && npm run build        # 浏览器端应用 → web/dist
go build -o filehop ./cmd/filehop
FILEHOP_ADDR=127.0.0.1:8095 ./filehop
```

设置都是环境变量，列在 [`deploy/filehop.env.example`](deploy/filehop.env.example) 里。不设置 `FILEHOP_SSO_URL` 时，FileHop 完全不带账户功能运行，这本身就是一个完整的转换器。设置之后，用户可以通过你的账户中心（HEL.ink）用 HOP ID 登录。nginx、systemd 和账户中心的配置见 [docs/DEPLOY.md](docs/DEPLOY.md)。

**开发时：**

```bash
npm run dev          # http://localhost:5179，只运行浏览器端应用（Vite）
npm run local        # http://localhost:8095，Go 服务器 + 运行在 :8097 的替身账户中心
```

`npm run local` 会把真正的服务器和 `tools/hubstub` 一起运行。`tools/hubstub` 是 HOP ID 账户中心和 Imperium 控制面板的一个小替身，通信格式完全相同，所以在一台机器上就能试登录、退出和账户事件。

## 常见问题

**我的文件会被发送到别处吗？** 不会。转换进行时，打开浏览器开发者工具里的“网络”面板看看：里面是空的。

**需要注册账户吗？** 不需要。不登录也能用全部功能。目前 HOP ID 只是多了一个账户菜单；同步预设以后才会推出。

**文件最大能多大？** 取决于浏览器内存能承受多少。FileHop 会在任务开始前估算所需内存，如果文件对这台设备来说太大，会提前告诉你。每批最多 50 个文件。

**为什么我的电脑上没有 AVIF？** 你的浏览器写不出 AVIF。FileHop 只提供它真正能生成的格式。

**处理来路不明的文件安全吗？** FileHop 把每个文件都当作有敌意的：压缩包会在解压前先测量（zip 炸弹和 `../` 路径会被拒绝），SVG 通过一个从不执行脚本的图片元素来绘制，PDF 用 pdf.js 读取，它不会运行文档里的 JavaScript。

## 内部原理

```
web/src/App.svelte (queue UI)
   └── Queue (web/src/lib/store/queue.svelte.ts)   $state array of $state jobs
         └── Pool (web/src/lib/core/pool.ts)       one Worker per slot, sized by the machine
               └── convert.worker.ts              runJob() → engines
                     ├── run/image.ts              canvas + createImageBitmap + pdf-lib
                     ├── run/pdf.ts                pdf.js (read) + pdf-lib (write)
                     ├── run/data.ts               papaparse / yaml, one table model
                     ├── run/text.ts               marked, and a DOM-free HTML → Markdown rule set
                     ├── run/archive.ts            fflate + a ustar reader
                     └── run/hash.ts               hash-wasm, 8 MB chunks

cmd/filehop          the server: web/dist embedded, headers, HOP ID sign-in, /hop/*
internal/app         routes, sign-in, the HOP App Protocol handlers
internal/db          SQLite: accounts, sessions, handled event ids (no files)
internal/hop         HOP App Protocol v1, the same as NoteHop's
```

- **类型由字节决定。** 先看文件头的魔数，其次才看扩展名。一个被改名为 `.txt` 的 JPEG 照样能打开，卡片上会显示“名称 ≠ 内容”。
- **一个任务，一个 Worker。** 工作池会给页面留一个核心，在手机和内存较小的设备上降到 2 个 Worker，也可以在设置里固定为 1 个。
- **必要时，Canvas 工作会移到页面上。** SVG 需要一个 `<img>`，而没有 `OffscreenCanvas` 的浏览器（16.4 之前的 Safari）无法在 Worker 里绘图，所以这些任务会占用一个主线程槽位。
- **运行时不下载任何东西。** 整个引擎都在打包文件里（Worker 部分 gzip 后约 236 KB，页面部分约 45 KB）。
- **面向 HOP 家族：** `/hop/health`、`/hop/manifest`、`/hop/stats`、`/hop/users/{sub}` 和 `/hop/events` 响应来自 Imperium 控制面板和账户中心的签名请求。

字体：正文用 Inter，强调短语用 Instrument Serif 斜体，文件名和哈希值用 JetBrains Mono，全部内置在 `web/public/hop-fonts/` 中。语言：`en, zh-CN, de, id, ja, pt-BR, es, fr, ru`，位于 `web/src/lib/i18n/`；`npm run lint:i18n` 确保它们保持同步。

## 安全、许可证与历史

请私下报告安全漏洞：[SECURITY.md](SECURITY.md)。FileHop 采用 MIT 许可证（[LICENSE](LICENSE)）。所用的库：`pdfjs-dist` Apache-2.0 · `pdf-lib` MIT · `fflate` MIT · `hash-wasm` MIT · `marked` MIT · `papaparse` MIT · `yaml` ISC · Svelte MIT · 字体 SIL OFL 1.1。不包含任何 GPL 或 AGPL 引擎。什么时候改了什么：[CHANGELOG.md](CHANGELOG.md)。

## 自行托管

<!-- self-hosting:start -->
FileHop 所需的一切都在公开仓库中：不需要私有仓库、令牌或 hel.ink 账户。详细说明见家族指南：[docs/self-hosting.md](https://github.com/navi-crwn/HEL.ink/blob/main/docs/self-hosting.md)（英文）。

| 组件 | 对 FileHop 而言 | 作用 |
| --- | --- | --- |
| [HEL.ink](https://github.com/navi-crwn/HEL.ink) (中心，HOP ID) | 可选：增加“使用 HOP ID 登录” | 所有应用的账户与登录 |
| [Imperium](https://github.com/navi-crwn/Imperium) | 可选 | 整个家族的管理面板；需要中心 |
| 家族字体与浮动图块 | 无需安装：从 `hel.ink/hop-assets` 加载 | 无法访问 hel.ink 时：使用系统字体，没有浮动图块 |

- **安装顺序**：用 `./install.sh` 单独安装 FileHop。如需 HOP ID 登录，先装[中心](https://github.com/navi-crwn/HEL.ink)：`./install.sh --hub new` 会在旁边装一个。
- **最少设置**：`FILEHOP_BASE_URL`; 连接中心时: `FILEHOP_SSO_URL`, `FILEHOP_SSO_CLIENT=filehop`, `FILEHOP_SSO_SECRET`。
- **单独运行或加入家族**：FileHop 可完全不带账户单独运行，本身就是完整的转换器。连接中心后，用户可以用 HOP ID 登录。
- **没有 Imperium 时**：没有任何缺失：FileHop 不存储文件，Imperium 只显示它的健康状态和数字。
<!-- self-hosting:end -->

## HOP 家族

FileHop 是 HOP 家族的一员，这是一组尊重隐私、可以自行部署的开源应用。

<!-- hop-family:start -->
<!-- Generated from HEL.ink resources/hop-assets/apps.source.json; edit there, then run scripts/hop_assets.py build. -->
| App | Address | Repository | What it does |
| --- | --- | --- | --- |
| **HOP ID** | [hel.ink](https://hel.ink) · accounts at `hub.hel.ink` | [navi-crwn/HEL.ink](https://github.com/navi-crwn/HEL.ink) | One account for every HOP app. |
| **LinkHop** | [link.hel.ink](https://link.hel.ink) · `hel.ink/l/…` | [navi-crwn/LinkHop](https://github.com/navi-crwn/LinkHop) | Short links, QR codes and click analytics. |
| **BioHop** | [bio.hel.ink](https://bio.hel.ink) · `hel.ink/b/…` | [navi-crwn/BioHop](https://github.com/navi-crwn/BioHop) | One link-in-bio page for everything you do. |
| **PixelHop** | [pixel.hel.ink](https://pixel.hel.ink) · `p.hel.ink/…` | [navi-crwn/PixelHop](https://github.com/navi-crwn/PixelHop) | Image hosting with albums and direct links. |
| **NoteHop** | [note.hel.ink](https://note.hel.ink) · `n.hel.ink/…` | [navi-crwn/NoteHop](https://github.com/navi-crwn/NoteHop) | Encrypted notes you share with a link. |
| **FileHop** | [file.hel.ink](https://file.hel.ink) | [navi-crwn/FileHop](https://github.com/navi-crwn/FileHop) | Convert files in your browser; nothing is uploaded. |
| **Imperium** | not public-facing: optional, for admins | [navi-crwn/Imperium](https://github.com/navi-crwn/Imperium) | The HOP control panel. |
<!-- hop-family:end -->
