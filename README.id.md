<p align="center">🌐 <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.de.md">Deutsch</a> · <b>Bahasa Indonesia</b> · <a href="README.ja.md">日本語</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a></p>

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.webp"><img src="docs/readme/hero-light.webp" alt="Halaman utama FileHop: judul 'Konversi apa saja, dan tidak ada yang keluar dari perangkat ini' di samping area lepas berkas" width="100%"></picture></p>

<p align="center"><b>Berkas apa pun, format apa pun, di perangkatmu.</b><br>FileHop mengonversi gambar, PDF, tabel, teks, dan arsip di browsermu. Tidak ada yang diunggah.</p>

<p align="center">
  <a href="https://file.hel.ink"><b>Coba online</b></a> ·
  <a href="#jalankan-sendiri">Jalankan sendiri</a> ·
  <a href="#apa-yang-bisa-dikonversi">Apa yang bisa dikonversi</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="docs/DEPLOY.md">Deploy</a> ·
  <a href="docs/TESTING.md">Pengujian</a> ·
  <a href="CHANGELOG.md">Catatan perubahan</a>
</p>

<p align="center"><sub>Satu binary Go · konversi berjalan di tab browser · 9 bahasa · tanpa iklan, tanpa pelacak · gratis dan open source (MIT)</sub></p>

> [!IMPORTANT]
> FileHop tidak punya tombol unggah karena memang tidak ada unggahan. Berkas dibuka lewat File API browser, dikonversi di dalam tab dengan CPU-mu sendiri, lalu dikembalikan sebagai unduhan. Server hanya mengirim aplikasinya dan, kalau kamu masuk, menyimpan sesi HOP ID-mu. Server tidak pernah menerima berkas.

FileHop adalah pengonversi berkas yang bisa kamu jalankan sendiri. Taruh berkas di halaman, pilih format di setiap kartu (atau satu untuk seluruh grup), tekan Konversi, lalu unduh. Cocok untuk kamu yang:

- butuh PNG jadi WebP, hasil pindaian jadi PDF, atau PDF dipecah per halaman, tanpa harus menyerahkan berkasnya ke situs web,
- ingin mengubah CSV jadi JSON atau YAML (dan sebaliknya) tanpa membuka spreadsheet,
- ingin melihat isi ZIP, atau mengecek SHA-256 sebuah berkas, di komputer yang tidak boleh dipasangi software.

Pasang dengan satu perintah. Skripnya memeriksa komputermu, mengajukan beberapa pertanyaan, dan bisa menghubungkan FileHop ke hub akun HOP ID:

```bash
curl -fsSL https://raw.githubusercontent.com/navi-crwn/FileHop/main/install.sh | bash
```

Dari hasil clone: `./install.sh`. Perbarui dengan `./update.sh` dan hapus dengan `./uninstall.sh`. Tambahkan `--yes` untuk menerima semua pilihan bawaan; `--help` menampilkan daftar opsinya.

## Apa yang bisa dikonversi

| Kategori | Masuk | Keluar |
|---|---|---|
| Gambar | PNG, JPEG, WebP, AVIF\*, GIF, BMP, TIFF, ICO, SVG | WebP, AVIF\*, JPEG, PNG, PDF |
| PDF | PDF | digabung, dipecah (ZIP), diputar, pilih halaman, halaman → PNG/JPEG (ZIP), info dokumen (JSON) |
| Data | CSV, TSV, JSON, YAML | CSV, TSV, JSON, YAML |
| Teks | Markdown, HTML, teks biasa | HTML, Markdown, teks biasa |
| Arsip | ZIP, TAR, GZIP | ZIP (dikemas ulang), GZIP, daftar isi (JSON) |
| Apa saja | berkas apa pun | SHA-256, BLAKE3, MD5 |

\* Keluaran AVIF hanya ditawarkan jika encoder bawaan browser bisa menulisnya. Canvas diam-diam mengembalikan PNG kalau tidak bisa, jadi FileHop memeriksa hasilnya dan menyembunyikan format tujuan itu daripada memberimu berkas dengan label yang salah.

**Belum tersedia:** DOCX dan LaTeX (butuh pandoc, GPL), RAR dan 7z, video dan audio. Aplikasinya menyebutkan hal ini terus terang di bagian format, bukan pura-pura bisa.

Diuji pada 2026-11-08 di Chromium 158, Firefox 159, dan mesin WebKit (masing-masing 22 konversi, semuanya lulus). Safari di Mac atau iPhone belum diuji. Rinciannya: [docs/TESTING.md](docs/TESTING.md).

## Apa yang dilihat server

- Berkas milik aplikasi itu sendiri (HTML, skrip, font). Setiap permintaan bersifat same-origin; halaman tidak memuat apa pun dari situs lain.
- Kalau kamu masuk dengan HOP ID: nomor HOP ID, nama, dan email-mu, serta satu cookie sesi. Keluar, atau dikeluarkan oleh hub, akan menghapus sesi tersebut.
- Tidak pernah berkas, nama berkas, atau hasil konversi.

Halaman berjalan dalam mode cross-origin isolated (`Cross-Origin-Embedder-Policy: require-corp`) dengan Content Security Policy yang ketat: tanpa skrip inline, tanpa `eval`, tanpa host pihak ketiga.

## Jalankan sendiri

**Dengan installer** (lihat di atas): installer membangun aplikasi browser dengan Node 20.19+ dan server dengan Go 1.27+, atau memakai Docker, lalu menuliskan `.env`, `start.sh`, dan unit systemd untukmu.

**Secara manual:**

```bash
npm ci && npm run build        # aplikasi browser → web/dist
go build -o filehop ./cmd/filehop
FILEHOP_ADDR=127.0.0.1:8095 ./filehop
```

Pengaturan berupa variabel lingkungan, tercantum di [`deploy/filehop.env.example`](deploy/filehop.env.example). Tanpa `FILEHOP_SSO_URL`, FileHop berjalan tanpa akun sama sekali, dan itu sudah merupakan pengonversi yang lengkap. Dengan variabel itu, orang bisa masuk dengan HOP ID dari hub-mu (HEL.ink). [docs/DEPLOY.md](docs/DEPLOY.md) membahas nginx, systemd, dan hub.

**Untuk pengembangan:**

```bash
npm run dev          # http://localhost:5179, aplikasi browser saja (Vite)
npm run local        # http://localhost:8095, server Go + hub pengganti di :8097
```

`npm run local` menjalankan server sungguhan bersama `tools/hubstub`, pengganti kecil untuk hub HOP ID dan panel kontrol Imperium dengan format komunikasi yang sama, sehingga masuk, keluar, dan event akun bisa dicoba di satu mesin.

## FAQ

**Apakah berkasku dikirim ke mana-mana?** Tidak. Buka tab Network di developer tools browsermu saat konversi berjalan: isinya tetap kosong.

**Apakah aku perlu akun?** Tidak. Semuanya berfungsi tanpa akun. Untuk saat ini HOP ID hanya menambahkan menu akun; preset yang tersinkron menyusul nanti.

**Seberapa besar berkas yang bisa diproses?** Sebesar yang diizinkan memori browsermu. FileHop memperkirakan memori yang dibutuhkan sebuah tugas sebelum dimulai dan memberi tahu kalau berkasnya terlalu besar untuk perangkat ini. Satu batch dibatasi 50 berkas.

**Kenapa AVIF tidak muncul di komputerku?** Browsermu tidak bisa menulis AVIF. FileHop hanya menawarkan format yang benar-benar bisa dihasilkannya.

**Apakah konversi aman untuk berkas yang tidak tepercaya?** FileHop menganggap setiap berkas berbahaya: arsip diukur dulu sebelum dibongkar (zip bomb dan path `../` ditolak), SVG digambar lewat elemen gambar yang tidak pernah menjalankan skrip, dan PDF dibaca dengan pdf.js, yang tidak menjalankan JavaScript di dalam dokumen.

## Di balik layar

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

- **Jenis berkas ditentukan dari isinya.** Magic bytes dulu, ekstensi belakangan. JPEG yang diganti namanya menjadi `.txt` tetap bisa dibuka, dan kartunya menampilkan "Nama ≠ isi".
- **Satu tugas, satu worker.** Pool menyisakan satu core untuk halaman, turun ke 2 worker di ponsel dan perangkat bermemori kecil, dan bisa dikunci ke 1 di pengaturan.
- **Pekerjaan canvas pindah ke halaman kalau terpaksa.** SVG butuh `<img>`, dan browser tanpa `OffscreenCanvas` (Safari sebelum 16.4) tidak bisa menggambar di worker, jadi tugas-tugas itu memakai satu slot di main thread.
- **Tidak ada yang diambil saat berjalan.** Seluruh mesin sudah ada di dalam bundle (sekitar 236 KB gzip untuk bagian worker, 45 KB untuk halaman).
- **Untuk keluarga HOP:** `/hop/health`, `/hop/manifest`, `/hop/stats`, `/hop/users/{sub}`, dan `/hop/events` menjawab panggilan bertanda tangan dari panel kontrol Imperium dan hub.

Tipografi: Inter untuk teks, Instrument Serif miring untuk frasa aksen, JetBrains Mono untuk nama berkas dan hash, semuanya disertakan di `web/public/hop-fonts/`. Bahasa: `en, zh-CN, de, id, ja, pt-BR, es, fr, ru` di `web/src/lib/i18n/`; `npm run lint:i18n` menjaga semuanya tetap selaras.

## Keamanan, lisensi, dan riwayat

Laporkan kerentanan secara pribadi: [SECURITY.md](SECURITY.md). FileHop berlisensi MIT ([LICENSE](LICENSE)). Pustaka yang dipakai: `pdfjs-dist` Apache-2.0 · `pdf-lib` MIT · `fflate` MIT · `hash-wasm` MIT · `marked` MIT · `papaparse` MIT · `yaml` ISC · Svelte MIT · font SIL OFL 1.1. Tidak ada mesin GPL atau AGPL di dalamnya. Apa yang berubah dan kapan: [CHANGELOG.md](CHANGELOG.md).

## Hosting sendiri

<!-- self-hosting:start -->
Semua yang dibutuhkan FileHop ada di repositori publik: tanpa repositori privat, tanpa token, dan tanpa akun hel.ink. Rinciannya ada di panduan keluarga: [docs/self-hosting.md](https://github.com/navi-crwn/HEL.ink/blob/main/docs/self-hosting.md) (bahasa Inggris).

| Komponen | Untuk FileHop | Fungsinya |
| --- | --- | --- |
| [HEL.ink](https://github.com/navi-crwn/HEL.ink) (hub, HOP ID) | Opsional: menambahkan “Masuk dengan HOP ID” | Akun dan proses masuk untuk semua aplikasi |
| [Imperium](https://github.com/navi-crwn/Imperium) | Opsional | Panel admin untuk seluruh keluarga; butuh hub |
| Font dan ubin keluarga | Tidak perlu dipasang: dimuat dari `hel.ink/hop-assets` | Tanpa hel.ink: font sistem, tanpa ubin melayang |

- **Urutan pemasangan**: FileHop sendiri dengan `./install.sh`. Untuk masuk dengan HOP ID, pasang [hub](https://github.com/navi-crwn/HEL.ink) dulu: `./install.sh --hub new` memasangnya di sebelahnya.
- **Pengaturan minimum**: `FILEHOP_BASE_URL`; dengan hub: `FILEHOP_SSO_URL`, `FILEHOP_SSO_CLIENT=filehop`, `FILEHOP_SSO_SECRET`.
- **Sendiri atau dalam keluarga**: FileHop berjalan sendiri tanpa akun sama sekali, dan itu sudah konverter yang lengkap. Dengan hub, orang bisa masuk dengan HOP ID.
- **Tanpa Imperium**: tidak ada yang hilang: FileHop tidak menyimpan berkas, dan Imperium hanya menampilkan kesehatan serta angkanya.
<!-- self-hosting:end -->

## Keluarga HOP

FileHop adalah bagian dari keluarga HOP, kumpulan aplikasi open source yang menghormati privasi dan bisa di-host sendiri.

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
| **PayHop** | [pay.hel.ink](https://pay.hel.ink) | [navi-crwn/PayHop](https://github.com/navi-crwn/PayHop) | Make a payment QR and split a bill; nothing leaves your browser. |
| **Imperium** | not public-facing: optional, for admins | [navi-crwn/Imperium](https://github.com/navi-crwn/Imperium) | The HOP control panel. |
<!-- hop-family:end -->
