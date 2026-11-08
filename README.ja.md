<p align="center">🌐 <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.de.md">Deutsch</a> · <a href="README.id.md">Bahasa Indonesia</a> · <b>日本語</b> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a></p>

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.webp"><img src="docs/readme/hero-light.webp" alt="FileHop のホームページ：見出し「なんでも変換、このデバイスから何も出ていかない」とドロップゾーン" width="100%"></picture></p>

<p align="center"><b>どんなファイルも、どんな形式も、あなたのデバイスで。</b><br>FileHop は画像、PDF、表、テキスト、アーカイブをブラウザの中で変換します。アップロードは一切ありません。</p>

<p align="center">
  <a href="https://file.hel.ink"><b>オンラインで試す</b></a> ·
  <a href="#自分で動かす">自分で動かす</a> ·
  <a href="#変換できるもの">変換できるもの</a> ·
  <a href="#よくある質問">よくある質問</a> ·
  <a href="docs/DEPLOY.md">デプロイ</a> ·
  <a href="docs/TESTING.md">テスト</a> ·
  <a href="CHANGELOG.md">変更履歴</a>
</p>

<p align="center"><sub>Go のバイナリひとつ · 変換はブラウザのタブ内で実行 · 9 言語 · 広告なし、トラッカーなし · 無料のオープンソース（MIT）</sub></p>

> [!IMPORTANT]
> FileHop にはアップロードボタンがありません。そもそもアップロードしないからです。ファイルはブラウザの File API で開かれ、タブの中であなた自身の CPU を使って変換され、ダウンロードとして手元に戻ります。サーバーが送るのはアプリ本体だけで、サインインした場合は HOP ID のセッションを保持します。ファイルを受け取ることはありません。

FileHop は自分で運用できるファイル変換ツールです。ファイルをページにドロップし、カードごとに形式を選び（グループ全体にまとめて選ぶこともできます）、「変換」を押してダウンロードするだけ。こんな人に向いています：

- PNG を WebP に、スキャンを PDF に、PDF をページごとに分けたいけれど、ファイルをウェブサイトに渡したくない人
- 表計算ソフトを使わずに CSV を JSON や YAML に（またはその逆に）変換したい人
- ソフトをインストールできないパソコンで、ZIP の中身を確認したり、ファイルの SHA-256 を調べたりしたい人

インストールはコマンドひとつ。スクリプトがパソコンをチェックし、いくつか質問をして、FileHop を HOP ID のアカウントハブにつなぐこともできます：

```bash
curl -fsSL https://raw.githubusercontent.com/navi-crwn/FileHop/main/install.sh | bash
```

クローンから使う場合は `./install.sh`。更新は `./update.sh`、削除は `./uninstall.sh` です。`--yes` を付けるとすべて既定値で進み、`--help` でオプション一覧を表示します。

## 変換できるもの

| 種類 | 入力 | 出力 |
|---|---|---|
| 画像 | PNG, JPEG, WebP, AVIF\*, GIF, BMP, TIFF, ICO, SVG | WebP, AVIF\*, JPEG, PNG, PDF |
| PDF | PDF | 結合、分割（ZIP）、回転、ページ選択、ページ → PNG/JPEG（ZIP）、文書情報（JSON） |
| データ | CSV, TSV, JSON, YAML | CSV, TSV, JSON, YAML |
| テキスト | Markdown, HTML, プレーンテキスト | HTML, Markdown, プレーンテキスト |
| アーカイブ | ZIP, TAR, GZIP | ZIP（再圧縮）、GZIP、一覧（JSON） |
| なんでも | あらゆるファイル | SHA-256, BLAKE3, MD5 |

\* AVIF 出力は、ブラウザ自身のエンコーダーが書き出せる場合にだけ表示されます。Canvas は書き出せないとき黙って PNG を返すので、FileHop は結果を確認し、形式を偽ったファイルを渡すかわりにその出力先を隠します。

**まだ対応していないもの：** DOCX と LaTeX（pandoc が必要、GPL）、RAR と 7z、動画と音声。アプリの形式一覧でもそのとおりに書いていて、対応しているふりはしません。

2026-11-08 に Chromium 158、Firefox 159、WebKit エンジンでテスト済みです（それぞれ 22 件の変換、すべて成功）。Mac や iPhone の Safari はまだテストしていません。詳しくは [docs/TESTING.md](docs/TESTING.md) を参照してください。

## サーバーに見えるもの

- アプリ自身のファイル（HTML、スクリプト、フォント）。リクエストはすべて同一オリジンで、ページがほかのサイトから何かを読み込むことはありません。
- HOP ID でサインインした場合：HOP ID の番号、名前、メールアドレス、そしてセッション Cookie。サインアウトするか、ハブからサインアウトされるとセッションは削除されます。
- ファイル、ファイル名、変換結果は決して見えません。

ページはクロスオリジン分離（`Cross-Origin-Embedder-Policy: require-corp`）された状態で、厳格な Content Security Policy のもとで動きます。インラインスクリプトなし、`eval` なし、サードパーティのホストなし。

## 自分で動かす

**インストーラーを使う場合**（上記）：Node 20.19+ でブラウザアプリを、Go 1.27+ でサーバーをビルドするか、Docker を使います。`.env`、`start.sh`、systemd ユニットも書き出してくれます。

**手動の場合：**

```bash
npm ci && npm run build        # ブラウザアプリ → web/dist
go build -o filehop ./cmd/filehop
FILEHOP_ADDR=127.0.0.1:8095 ./filehop
```

設定は環境変数で行い、[`deploy/filehop.env.example`](deploy/filehop.env.example) に一覧があります。`FILEHOP_SSO_URL` がなければ FileHop はアカウント機能なしで動き、それだけで完全な変換ツールです。設定すると、あなたのハブ（HEL.ink）の HOP ID でサインインできるようになります。nginx、systemd、ハブについては [docs/DEPLOY.md](docs/DEPLOY.md) で説明しています。

**開発用：**

```bash
npm run dev          # http://localhost:5179、ブラウザアプリのみ（Vite）
npm run local        # http://localhost:8095、Go サーバー + :8097 で動く代役のハブ
```

`npm run local` は本物のサーバーを `tools/hubstub` と一緒に起動します。`tools/hubstub` は HOP ID ハブと Imperium コントロールパネルの小さな代役で、通信形式は同じです。そのため、サインイン、サインアウト、アカウントイベントを 1 台のマシンで試せます。

## よくある質問

**ファイルがどこかに送られることは？** ありません。変換中にブラウザの開発者ツールでネットワークタブを開いてみてください。空のままです。

**アカウントは必要？** いいえ。アカウントなしですべての機能が使えます。今のところ HOP ID で増えるのはアカウントメニューだけで、プリセットの同期は今後対応予定です。

**ファイルはどのくらいの大きさまで？** ブラウザのメモリが許す限りです。FileHop は処理を始める前に必要なメモリを見積もり、このデバイスには大きすぎる場合は知らせます。一度に処理できるのは 50 ファイルまでです。

**自分のパソコンで AVIF が出てこないのはなぜ？** お使いのブラウザが AVIF を書き出せないからです。FileHop は実際に生成できる形式だけを表示します。

**出どころのわからないファイルを変換しても安全？** FileHop はすべてのファイルを悪意あるものとして扱います。アーカイブは展開前にサイズを測り（zip 爆弾や `../` パスは拒否）、SVG はスクリプトを一切実行しない画像要素を通して描画し、PDF は文書内の JavaScript を実行しない pdf.js で読み込みます。

## 内部のしくみ

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

- **形式はバイト列から判断します。** まずマジックバイト、拡張子はその次。`.txt` に名前を変えた JPEG もちゃんと開け、カードには「名前 ≠ 中身」と表示されます。
- **ひとつの処理に、ひとつのワーカー。** プールはページ用にコアをひとつ残し、スマートフォンやメモリの少ないデバイスではワーカーを 2 つに減らします。設定で 1 つに固定することもできます。
- **必要なときは Canvas の処理をページ側で行います。** SVG には `<img>` が必要で、`OffscreenCanvas` のないブラウザ（16.4 より前の Safari）はワーカー内で描画できないため、そうした処理はメインスレッドの枠をひとつ使います。
- **実行時には何も取得しません。** エンジン全体がバンドルに含まれています（ワーカー部分は gzip で約 236 KB、ページは 45 KB）。
- **ファミリーのために：** `/hop/health`、`/hop/manifest`、`/hop/stats`、`/hop/users/{sub}`、`/hop/events` が、Imperium コントロールパネルとハブからの署名付きリクエストに応答します。

書体：本文は Inter、アクセントのフレーズは Instrument Serif のイタリック、ファイル名とハッシュは JetBrains Mono。すべて `web/public/hop-fonts/` に同梱しています。言語：`en, zh-CN, de, id, ja, pt-BR, es, fr, ru` が `web/src/lib/i18n/` にあり、`npm run lint:i18n` で足並みをそろえています。

## セキュリティ、ライセンス、履歴

脆弱性は非公開で報告してください：[SECURITY.md](SECURITY.md)。FileHop は MIT ライセンスです（[LICENSE](LICENSE)）。使用ライブラリ：`pdfjs-dist` Apache-2.0 · `pdf-lib` MIT · `fflate` MIT · `hash-wasm` MIT · `marked` MIT · `papaparse` MIT · `yaml` ISC · Svelte MIT · フォント SIL OFL 1.1。GPL や AGPL のエンジンは含まれていません。いつ何が変わったか：[CHANGELOG.md](CHANGELOG.md)。

## セルフホスティング

<!-- self-hosting:start -->
FileHop に必要なものはすべて公開リポジトリにあります。非公開リポジトリ、トークン、hel.ink のアカウントは不要です。詳しくはファミリーガイド [docs/self-hosting.md](https://github.com/navi-crwn/HEL.ink/blob/main/docs/self-hosting.md)（英語）を参照してください。

| 構成要素 | FileHop にとって | 役割 |
| --- | --- | --- |
| [HEL.ink](https://github.com/navi-crwn/HEL.ink) (ハブ、HOP ID) | 任意：「HOP ID でサインイン」を追加 | すべてのアプリのアカウントとサインイン |
| [Imperium](https://github.com/navi-crwn/Imperium) | 任意 | ファミリー全体の管理パネル。ハブが必要 |
| ファミリーのフォントとタイル | インストール不要：`hel.ink/hop-assets` から読み込み | hel.ink がなければシステムフォント、浮遊タイルなし |

- **インストール順**：FileHop は `./install.sh` だけで動きます。HOP ID でのサインインには先に[ハブ](https://github.com/navi-crwn/HEL.ink)を。`./install.sh --hub new` が隣にインストールします。
- **最小限の設定**：`FILEHOP_BASE_URL`; ハブ利用時: `FILEHOP_SSO_URL`, `FILEHOP_SSO_CLIENT=filehop`, `FILEHOP_SSO_SECRET`。
- **単体かファミリーか**：FileHop はアカウントなしで単体で動き、それだけで完全な変換ツールです。ハブがあれば HOP ID でサインインできます。
- **Imperium なしの場合**：何も失われません。FileHop はファイルを保存せず、Imperium は稼働状況と数値を表示するだけです。
<!-- self-hosting:end -->

## HOP ファミリー

FileHop は、プライバシーを尊重し、自分でホストできるオープンソースアプリ群「HOP ファミリー」の一員です。

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
