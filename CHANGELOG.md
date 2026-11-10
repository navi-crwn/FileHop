# Changelog

What changed in FileHop, newest first. Each entry will link to its pull request once the repository is public.

## [Unreleased]

### Added
- A dashboard at `/dashboard` for people signed in with HOP ID: the same converter workspace as the home page (queue, per-file X button) without the marketing page, in the family's dashboard chrome (sidebar with Convert, Changelog and the HOP family; topbar with Add files, language, theme and the account menu, where the settings now live) plus a small account card that says files are never uploaded. A guest who opens it is sent through sign-in and comes back to it; after sign-in with no `next`, people land on it. The public home page is unchanged, and the headers (CSP, COOP, COEP) are the app's own. New text in all nine languages.
- A test for the sign-in/sign-out cases below, and a migration test for databases made before `sessions.verified_at`.
- A real `/changelog` page (server-rendered from the embedded snapshot `web/changelog.json`, nine languages, light and dark, same CSP and cross-origin isolation headers as the app), a footer link to it, and `scripts/build-changelog.py` / `scripts/check-changelog.py` like the other apps. FileHop is listed in the family changelog sources.
- `og:image` and Open Graph / Twitter card tags on the app and on `/changelog`; the image is `og-image.png` in this repository.
- A test that the family list in the app equals the family manifest (`tools/hop-apps.json`, hop-assets v8) without FileHop.

### Fixed
- FileHop could keep showing an account the browser was no longer signed in with at HOP ID (for example after switching accounts there without signing out, or signing out in another browser, when the hub's `session.revoked` did not arrive). A session now records when the hub last vouched for it; after five minutes the next page load (the home page or `/dashboard`, once, never while converting) asks the hub quietly (`prompt=none`, the hub never shows a login page): the same HOP ID keeps the session, another one replaces it, and a signed-out hub ends it. If the session still cannot be read after the round trip (cookies blocked) FileHop says so in nine languages instead of redirecting again. A new sign-in also ends the session the browser held before.

### Changed
- Every file row has an X button at its right end (32 px, 44 px on phones, always visible, with the file name in its label in all nine languages): it removes the file before it is processed, stops that one file while it runs (the others keep going), and drops a finished or failed row from the list without touching a download already made. Removing a PDF from a merge group keeps the group sound. The old per-state Remove, trash and Cancel buttons are replaced by it.
- The top bar no longer has the family app grid (primary action, language, theme, settings, account); the family list stays in the footer.
- (Earlier, now removed) The top bar has the family app switcher (grid button, the apps with their marks, the current one marked, arrow keys, Escape and outside click close it), placed before the language menu like in the other apps.
- The home page grids use the hop-assets v8 bento (five family tiles in one row from 1100 px, no lone box, art capped at 160-200 px); the 3D engine, bento stylesheet and BioHop assets are byte-identical v8 copies.
- In "What goes in, what comes out" the six format boxes fill two full rows and the "not here yet" note closes the grid as a full-width strip, so no box stands alone.

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
