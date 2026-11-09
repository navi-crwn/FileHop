# Changelog

What changed in FileHop, newest first. Each entry will link to its pull request once the repository is public.

## [Unreleased]

### Changed
- Controls follow the HOP control standard: one radius, one height per row, buttons as wide as their text.
- Surfaces use the flat neutral style (solid cards, hairline borders, sentence-case labels, 6 px badges) as an optional Clean interface style, chosen in the settings drawer.
- "Drop everything" and "Clear finished" ask first, through the shared HopUI dialog.
- The FileHop mark is the family's pixel mark from hop-assets v4 (a document with a folded corner and a white arrow down), the same as on hel.ink, in the other apps' family lists and in FileHop's 3D art and floating tile.
- PNG icons for installing the app: `icon-192.png` and `icon-512.png` in the web manifest (any and maskable) and `apple-touch-icon.png`, all byte-identical to hop-assets v4.
- On phones the top bar is one row, as in the family chrome: primary action (icon), language, theme, account. The settings stay one tap away in the hero.

### Added
- A Go server (`cmd/filehop`) that embeds the browser app and serves it with cross-origin isolation (COOP `same-origin`, COEP `require-corp`, CORP `same-origin`) and a strict Content Security Policy. Hashed assets, fonts and the pdf.js worker are cached for a year; the page itself is revalidated.
- Sign-in with HOP ID through the hub (`/auth/sso`): one-time signed tickets, a check that the ticket was made for FileHop, suspended accounts refused, and the hub's chained sign-out (`/auth/sso/logout`). Converting still works without an account.
- The HOP App Protocol for the family: `/hop/health`, `/hop/manifest`, `/hop/stats`, `/hop/users/{sub}` for the Imperium control panel, and `/hop/events` for the hub's account events (revoked sessions, suspension, deletion, profile changes). `/healthz` for nginx and the hub's watchdog.
- An account control in the top bar (sign in, or the account menu), shown only when the server has sign-in set up. Sign-in errors are shown in the visitor's language.
- One-command `install.sh`, `update.sh` and `uninstall.sh`, a Dockerfile, and `deploy/` for nginx and systemd.
- `tools/browser-matrix.mjs` converts 22 cases in Chromium, WebKit and Firefox; `tools/hubstub` stands in for the hub and Imperium locally.

### Changed
- The browser app moved to `web/`.

### Fixed
- Merging: only the PDFs set to Merge are merged, and a group keeps one merge through retries, late joiners and stops.
- In browsers without `OffscreenCanvas` (Safari before 16.4 and the WebKit ports), every image conversion and PDF pages → PNG/JPEG failed with "Can't find variable: document". Those jobs now run on the page.

## 0.1.0 - 2026-11-08

The standalone browser converter: images, PDF, data, text, archives and hashes, converted in the tab, in nine languages, with no server state.
