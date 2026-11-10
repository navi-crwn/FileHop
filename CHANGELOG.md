# Changelog

What changed in FileHop, newest first. Each entry will link to its pull request once the repository is public.

## [Unreleased]

## [1.0.0] - 2026-11-10

### Changed
- The header and footer show the mark and the app name as real text in the app's own typeface (hop-assets v7 brand fonts: name-only subsets, vendored byte-identical, SIL OFL).
- The formats section is one bento that fills whole rows, with a small scene in each box that runs only while it is on screen; the 3D engine, the motion script and the bento stylesheet are vendored copies of hop-assets v7 (pinned by hash in a test).
- The top bar uses the family language menu (a short code such as EN that opens a list with the native name and the code, Escape, outside click and arrow keys) and the settings button is always shown, the same size as the theme button.
- The footer has the same structure as the other apps (the app, Support, Policies, HOP family with each app's mark, then the copyright line), and the hero shows FileHop's own 3D mark (v6 engine and WebP, vendored byte-identical).
- Controls follow the HOP control standard: one radius, one height per row, buttons as wide as their text.
- Surfaces use the flat neutral style (solid cards, hairline borders, sentence-case labels, 6 px badges) as an optional Clean interface style, chosen in the settings drawer.
- "Drop everything" and "Clear finished" ask first, through the shared HopUI dialog.
- The FileHop mark is the family's pixel mark from hop-assets v4 (a document with a folded corner and a white arrow down), the same as on hel.ink, in the other apps' family lists and in FileHop's 3D art and floating tile.
- PNG icons for installing the app: `icon-192.png` and `icon-512.png` in the web manifest (any and maskable) and `apple-touch-icon.png`, all byte-identical to hop-assets v4.
- On phones the top bar is one row, as in the family chrome: primary action (icon), language, theme, account. The settings stay one tap away in the hero.

### Added
- The footer starts with the HOP ID mark (a vendored copy, the app's policy blocks outside images) and "Part of Hop Easy Link", linking to hel.ink, in both looks.
- A Go server (`cmd/filehop`) that embeds the browser app and serves it with cross-origin isolation (COOP `same-origin`, COEP `require-corp`, CORP `same-origin`) and a strict Content Security Policy. Hashed assets, fonts and the pdf.js worker are cached for a year; the page itself is revalidated.
- Sign-in with HOP ID through the hub (`/auth/sso`): one-time signed tickets, a check that the ticket was made for FileHop, suspended accounts refused, and the hub's chained sign-out (`/auth/sso/logout`). Converting still works without an account.
- The HOP App Protocol for the family: `/hop/health`, `/hop/manifest`, `/hop/stats`, `/hop/users/{sub}` for the Imperium control panel, and `/hop/events` for the hub's account events (revoked sessions, suspension, deletion, profile changes). `/healthz` for nginx and the hub's watchdog.
- An account control in the top bar (sign in, or the account menu), shown only when the server has sign-in set up. Sign-in errors are shown in the visitor's language.
- One-command `install.sh`, `update.sh` and `uninstall.sh`, a Dockerfile, and `deploy/` for nginx and systemd.
- `tools/browser-matrix.mjs` converts 22 cases in Chromium, WebKit and Firefox; `tools/hubstub` stands in for the hub and Imperium locally.

### Changed
- The browser app moved to `web/`.

### Fixed
- The sign-out link sent to the account server carries `return=` with this app's address, so the person ends up back on FileHop.
- Merging: only the PDFs set to Merge are merged, and a group keeps one merge through retries, late joiners and stops.
- In browsers without `OffscreenCanvas` (Safari before 16.4 and the WebKit ports), every image conversion and PDF pages → PNG/JPEG failed with "Can't find variable: document". Those jobs now run on the page.

## 0.1.0 - 2026-11-08

The standalone browser converter: images, PDF, data, text, archives and hashes, converted in the tab, in nine languages, with no server state.
