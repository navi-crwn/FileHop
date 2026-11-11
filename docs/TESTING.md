# Testing FileHop

How the converter was checked, so a later change can be checked the same way.

```bash
npm test             # unit checks: detection, targets, page ranges, CSV typing, archive guards; then /send (tools/send.test.mjs): flow control, hash vectors, file names, pairing vectors
npm run lint:i18n    # 9 locales: same keys, same {placeholders}, no Arabic
npm run check        # svelte-check
go test ./...        # server: headers, routes, sign-in, tickets, account events, /hop/* signatures
npm run fixtures     # testdata/: real PNG, JPEG, 3-page PDF, CSV, JSON, YAML, MD, ZIP and hostile files
npm run matrix -- http://localhost:8095   # 22 conversions in Chromium, WebKit and Firefox
```

## /send (peer to peer)

```bash
node tools/send.test.mjs          # also part of npm test: flow control, hash vectors, file names, pairing vectors
go test ./internal/app -run Send  # signalling: rooms, seal, rate limits, expiry, TrustProxy, per-device limit, commitment order
CHROME=/path/to/chrome bash tools/send-e2e.sh --size 128   # two headless Chromium: transfer, corrupt byte, cancel, data before Match, forged offer
```

The browser script needs Go, node and a Chromium; it starts a throwaway server on 127.0.0.1 and installs `playwright-core` into a temporary folder. What it cannot cover: the native save dialog (File System Access), networks that need STUN or TURN, mobile browsers, Firefox, Safari, and files of 1 GiB and more. Those are checked by hand on real devices.

## Checked by hand, 2026-11-08 (Chromium 152, production build)

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

**Three engines, 2026-11-08** (`tools/browser-matrix.mjs`, production build behind the Go server): Chromium 158, WebKit 27.2 (Playwright's WebKit on Windows, not Apple Safari) and the official Firefox 159 build each passed all 22 cases (one or more files per category, merge, hostile files, hash): `crossOriginIsolated === true`, zero external requests, no console errors, no CSP violations. WebKit without `OffscreenCanvas` failed every raster conversion before this round; those jobs now run on the page.

**Not tested:** Safari on macOS/iOS (no Apple machine), iOS and Android layouts on real devices, screen readers, a 200-file batch, and files above ~100 MB. Treat those as open items, not as done. AVIF output is untested as a success path: the browser used here cannot encode AVIF, so the only AVIF behaviour proven is that the target is hidden and the engine refuses rather than mislabelling a PNG.
