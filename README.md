# FileHop

Any file, any format, on your device.

FileHop converts images, PDFs, tables, text and archives **in the browser**. Nothing is uploaded: files are opened with the File API, decoded and encoded in the tab, and handed back through a blob URL. There is no upload button because there is no upload.

This is the standalone web app: the engine and the UI, with no HOP ID, no server state and no dependency on the rest of the family. It is built so that it can be dropped into `file.hel.ink` later without rewriting anything (see [WIRING.md](WIRING.md)).

---

## What works today

| Category | In | Out |
|---|---|---|
| Images | PNG, JPEG, WebP, AVIF\*, GIF, BMP, TIFF, ICO, SVG | WebP, AVIF\*, JPEG, PNG, PDF |
| PDF | PDF | merged, split (ZIP), rotated, page selection, pages → PNG/JPEG (ZIP), document info (JSON) |
| Data | CSV, TSV, JSON, YAML | CSV, TSV, JSON, YAML |
| Text | Markdown, HTML, plain text | HTML, Markdown, plain text |
| Archives | ZIP, TAR, GZIP | ZIP (repacked), GZIP, listing (JSON) |
| Anything | any file | SHA-256, BLAKE3, MD5 |

\* AVIF output is offered only where the browser's own encoder can write it. Canvas silently returns a PNG when it cannot, so the app probes the MIME and hides the target instead of handing you a mislabelled file.

**Deliberately not here yet:** DOCX and LaTeX round-trips (needs pandoc, GPL), RAR and 7z (no WASM reader vendored yet), video and audio (needs the WebCodecs/Mediabunny work from phase 2). The UI says so in the formats section rather than pretending.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:5179

npm run build        # dist/
npm start            # http://localhost:4180, dist/ with the production headers
```

`npm start` serves the built app with the headers FileHop will ship behind nginx: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, a CSP with no CDN and no inline script, and immutable caching for hashed assets. There is no framework in that server; it is `tools/serve.mjs` and it reads `dist/`.

## Test it

```bash
npm test             # 17 unit checks: detection, targets, page ranges, CSV typing, archive guards
npm run lint:i18n    # 9 locales: same keys, same {placeholders}, no Arabic
npm run fixtures     # writes testdata/ (real PNG, JPEG, 3-page PDF, CSV, JSON, YAML, MD, ZIP)
node tools/make-hostile.mjs   # writes testdata/hostile-* (zip-slip, zip bomb, PDF with /OpenAction, SVG with <script>)
```

`testdata/` is not part of the app. It is there so a person can drag something real onto the page in one minute.

What was checked by hand in Chromium 152 (Electron, Windows) against the production build:

- PNG 240×160 → WebP (105 KB → 1.2 KB), JPEG, PNG, PDF
- JPEG 320×220 → WebP (7 KB → 3 KB), PNG, resized JPEG, PDF
- SVG with `<script>` → WebP, script did not run
- PDF 3 pages → split (3 files), rotate, pick pages `2-3`, pages → PNG, pages → JPEG, info
- two PDFs + Merge → one 6-page PDF; the second card is marked "Folded into the merge" instead of building the same file twice
- CSV → JSON/TSV/YAML, JSON → CSV, TSV → CSV, values typed (`3` stays a number, `007` stays text)
- Markdown → HTML, HTML → Markdown, HTML → text
- ZIP → listing, ZIP → repacked ZIP, download one file, download all as ZIP
- SHA-256/MD5 checked against `Get-FileHash`; identical
- drag a file over the page → radial ring → release on a format → queue gets the files with that target
- cancel mid-flight → card reads "Stopped" and stops
- switching all 9 languages and both themes without a reload
- hostile files: zip-slip refused, zip bomb refused from the declared size, PDF with `/OpenAction` read without executing, SVG script not run
- `performance.getEntriesByType('resource')`: 18 requests, all same-origin, zero external
- Lighthouse against the built app: accessibility 100, best practices 100, SEO 100, no failing audits
- `svelte-check`: 0 errors, 0 warnings

Two things this round found and fixed, worth recording because they are easy to reintroduce:

- **YAML was being read as plain text.** The old check required a structural hint that a two-line list does not have. Detection now trusts the `.yaml`/`.yml` name and also accepts a body whose first lines are `key: value`, so `people.yaml` lands on the data path.
- **HTML → Markdown died with `document is not defined`.** The converter runs in a worker, where there is no DOM, and `DOMParser`/turndown both need one. Conversion now uses a small tag-level rule set in `run/text.ts`, which also means one fewer dependency and a smaller worker chunk.

**Not tested:** Firefox and Safari (no machine here), iOS and Android layouts on real devices, screen readers, a 200-file batch, and files above ~100 MB. Treat those as open items, not as done. AVIF output is untested as a success path: the browser used here cannot encode AVIF, so the only AVIF behaviour proven is that the target is hidden and the engine refuses rather than mislabelling a PNG.

---

## How it works

```
App.svelte (queue UI)
   └── Queue (src/lib/store/queue.svelte.ts)      $state array of $state jobs
         └── Pool (src/lib/core/pool.ts)          one Worker per slot, sized by the machine
               └── convert.worker.ts             runJob() → engines
                     ├── run/image.ts             canvas + createImageBitmap + pdf-lib
                     ├── run/pdf.ts               pdf.js (read) + pdf-lib (write)
                     ├── run/data.ts              papaparse / yaml, one table model
                     ├── run/text.ts              marked / turndown / DOMParser
                     ├── run/archive.ts           fflate + a ustar reader
                     └── run/hash.ts              hash-wasm, 8 MB chunks
```

A few decisions worth knowing:

- **Type comes from the bytes.** `detect.ts` matches magic bytes first and only falls back to the extension. A JPEG renamed `.txt` opens, and the card shows "Name ≠ content" so the discrepancy is not silent.
- **One job, one worker.** Progress ticks repaint one card, not the list. The pool leaves a core for the UI, drops to 2 slots on mobile or low-memory devices, and the settings drawer can pin it to 1.
- **SVG runs on the page.** A worker has no `<img>`, and `createImageBitmap` will not render an SVG document. So SVG jobs take a main-thread slot, one at a time, while everything else stays off the main thread.
- **Nothing is downloaded at runtime.** No engine is fetched on demand: the whole engine is in the bundle (`~640 KB` for the worker chunk) and the shell is `42 KB` gzip. That is the opposite of the lazy-WASM plan in the roadmap, and it is the right call at this size — one request, no cold-start, no cache bookkeeping. When the heavy engines (pandoc, DuckDB, ffmpeg) arrive, those are the ones that should load lazily.
- **Archives are checked before they are inflated.** `zip.ts` reads the central directory, sums the declared uncompressed sizes, and refuses on size, per-entry size, entry count or ratio. `unzipSync` allocates everything at once, so measuring afterwards would already be too late.
- **Untrusted input is treated as hostile.** PDFs open with `isEvalSupported: false`; SVG goes through `<img>`, which never runs scripts; HTML goes through `DOMParser`, which never executes; zip-slip and absolute paths are refused.

## Languages

`en, zh-CN, de, id, ja, pt-BR, es, fr, ru` in `src/lib/i18n/`. No Arabic, per the family rule. `npm run lint:i18n` fails on a missing key, an extra key, an empty value, or a `{placeholder}` that does not match English.

## Type in this app

Inter for text, Instrument Serif italic for the accent phrase in the hero, JetBrains Mono for file names and hashes. The font files are vendored in `public/hop-fonts/` from `hop-assets/v1` so the app runs with no network at all; when FileHop moves to `file.hel.ink` these switch to the family's shared URL.

## Licences

`pdfjs-dist` Apache-2.0 · `pdf-lib` MIT · `fflate` MIT · `hash-wasm` MIT · `marked` MIT · `papaparse` MIT · `yaml` ISC · Svelte MIT · fonts SIL OFL 1.1.

No AGPL engine is present. PDF reading uses pdf.js, not MuPDF; PDF writing uses pdf-lib, not Ghostscript. The full list is in the app under "Licenses".
