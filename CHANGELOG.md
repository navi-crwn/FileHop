# Changelog

What changed in FileHop, newest first. Each entry will link to its pull request once the repository is public.

## [Unreleased]

## [1.2.2] - 2026-11-13

### Added
- A door to Send on the public home page: a "Send a file" button in the hero beside "Add files", a Send link in the top bar, and a "Two things you can do" band under the hero that names both halves of FileHop — convert here (nothing is uploaded) and send device to device (nothing is stored). The first view served before the app loads carries the same three places, so the door is there before any script runs and in every language.
- `/send`: "Accept all" and "Decline all" for a run of offered files, so a folder of ten files is one press instead of ten. Both reach only the group on offer: "Accept all" takes the later files of that group without asking, "Decline all" refuses them, and the next offer (a new group, a single file, an offer from an older device) asks again with its card. A file can still be accepted or declined on its own; accepting or declining one row never touches the others. A file the other device withdraws while the save dialog is open is dropped, so nothing is left waiting at 0 bytes and the next offer is not refused as busy.
- `/send`: every offered file has a cancel, and "Cancel the rest" appears while more than one file is still on its way, so a long queue stops where the person wants it. The sender sees its own queue with the file being sent marked, and a cancelled file leaves both lists.
- `/send`: "Save all" for the files received in one go, packed into a single ZIP on the device (no upload), up to 512 MiB of files in all. Each file is read as a stream into the archive, so the input is never held whole next to its copy; the finished ZIP is still collected in the tab before it is saved, so the peak is about twice the size of the group; names that differ only in capitals are kept apart; when a file of the group failed the button says so ("3 of 4"); and if the ZIP cannot be made the page says so and the files keep their own Save links. Above 512 MiB the button is not offered and each file keeps its own Save link.

### Changed
- `/send` is now two columns: "Connection" (the code, the QR code, the pairing number, the route) on one side and "Transfers" (the queue and the received files) on the other, with the "How it works" steps across the page under them, three steps, calm (before a room is open the two start cards sit beside a short reassurance card, so the page has no empty gap). On a phone the two columns become one stack, Connection first, and "How it works" stays open as it is in the first view. The words are new in all nine languages, and the first view served before the app loads shows the same layout.
- The file group travels on the wire: a sender now announces "3 of 8" and the bytes of the whole group before the first file, so the receiver can say how much is coming and refuse a group announcing more than 512 MiB at its first offer, before anything is written. The announced numbers are only a sender's claims: the receiver also counts the files it already holds and has not saved, and, while "Accept all" is on, refuses an offer that would take it past 512 MiB; otherwise the person decides on the card. One file is not a group: it travels without group fields and is limited only by the per-file limit, as before. A device that speaks the older protocol still pairs and transfers as before; the newer fields are optional.
- `/dashboard` is centred in one column like the other apps' dashboards, and the side column now has a Send card next to the account card: one door to `/send`, with the plain sentence that files go straight from one device to the other and are never stored.

## [1.2.1] - 2026-11-12

### Fixed
- "Save to PixelHop" reported a failure although PixelHop had stored the file. PixelHop answers with addresses on its link host (`p.hel.ink`), and FileHop only accepted addresses on the host it calls (`pixel.hel.ink`). A stored file (201, or 200 with `ok`, also when the answer is cut off) is now always reported as saved. When PixelHop does not answer in time, the page no longer says the save failed: the file may be stored, so it asks the person to look in PixelHop before trying again. An address from PixelHop is passed on to the page when it is exactly the configured PixelHop address, exactly the host in the new optional `FILEHOP_PIXELHOP_LINK_URL`, or a plain https address on the family's domain (the hub's host without its first label, never a public suffix such as `co.uk`; lower case, no port, no trailing dot, no user name, not a number); otherwise the link opens PixelHop itself. Pressing the button again for the same file shows "Already in your PixelHop library": PixelHop keeps one copy per member.
- `/send`: the code of a device that left is dead at once. A room is removed when its only device leaves before anyone joined, so an old QR code (a reloaded page, "Leave" then "Start") says the room does not exist instead of leaving the second device waiting with the old code on screen. Joining a room with nobody in it says the other device already left; the device that opens a room shows its code only once it is in the room itself. A new `#code` opened while the page is on `/send` (a second scan in the same tab or installed app) starts over with it, asking first during a pairing or a transfer. Too many new codes from one network says it is per hour and how to go on.
- `/send`: when several files were received one after another, receiving the next one deleted the earlier ones from the browser's private storage, so their Save links failed ("download failed"). Each page now keeps its own received files until it is closed; only leftovers of closed pages are removed.

### Changed
- The theme and the language follow the family cookies `hop_theme` and `hop_lang`, shared by every HOP app on hel.ink: a choice made in one app is the choice in the others. The old `hop-theme` / `hop-lang` keys are still read (after the cookies), moved once into the cookies, and kept up to date; only a language the person picks is stored, never one guessed from the browser. `/changelog` follows `?lang=`, then the cookie, then the browser.
- `/` and `/send` are served with the page's first view already drawn (the app's own markup, words, fonts and colours, in the visitor's theme and language), so the page is readable at once and by search engines; the app takes its place without anything moving. The whole page, head included, is in one language; it varies on `Cookie` and `Accept-Language` and is `Cache-Control: private`. If the app's files are slow, it is shown after at most 3 seconds. Without scripts, the page says that FileHop needs JavaScript.

## [1.2.0] - 2026-11-12

### Added
- "Save to PixelHop" on a finished image or PDF (JPG, PNG, GIF, WebP, BMP, PDF), for signed-in people only and off unless `FILEHOP_PIXELHOP_SECRET` is set. It asks first, in nine languages, and says that this one file goes through FileHop's server to the person's PixelHop library and is not kept. `POST /api/v1/pixelhop/save` accepts only a same-origin call from a signed-in person, limits saves (20 a minute per person, one at a time per person, four at a time in all), checks the size (cap 20 MB by default) and the file type from its bytes, and forwards the file to PixelHop signed as that person. The file is held in memory only for the call, one call to PixelHop is made at a time, a "busy" or "body timeout" answer from PixelHop is retried once (signed afresh), and PixelHop's errors are shown as translated messages. The file name travels in a header. New environment: `FILEHOP_PIXELHOP_SECRET` (32+ characters, never the SSO secret), `FILEHOP_PIXELHOP_URL` (default `pixel.` + the hub's parent domain), `FILEHOP_PIXELHOP_MAX_MB`. The nginx vhost must be re-installed: it gets a `location = /api/v1/pixelhop/save` block with a 21 MB body limit (the server-wide limit stays 1 MB).
- `/send`: send a file straight from one device to another over WebRTC. Nothing is uploaded or stored; the server only introduces the two browsers through a WebSocket (`GET /api/send/signal`) and then drops out. A room is a six-digit code (`POST /api/send/room`), kept in memory for ten minutes, for exactly two devices, and sealed once the second joins. Pairing by QR code (the code is in the URL fragment, which is removed after it is read) or by typing the code. Guests can send; a signed-in account may send larger files (guest 2 GiB, account 4 GiB per file; the limit follows the sender, is told to the receiver by the server, and the receiver enforces it).
- Pairing check: both people compare a six-digit number derived from the two DTLS fingerprints and the room code, and press "Match"; no file can flow before both have, and a device that receives data or an offer earlier closes the connection. Each device first commits to its fingerprint (a hash with a nonce) before any session description is exchanged, and reveals the nonce when the channel opens, so the signalling server cannot pick a certificate after seeing the real one and sit in the middle unnoticed (a wrong pairing shows different numbers, with a one-in-a-million chance per attempt). The server also refuses to relay a description before both commitments.
- Transfer over one ordered, reliable data channel: JSON control messages as strings, file bytes as 16 KB ArrayBuffers, backpressure on the channel queue (4 MiB / 1 MiB) and on the receiver's disk writes (ack every 4 MiB, 16 MiB window), incremental SHA-256 (`hash-wasm`, in the receive worker) and an explicit accept/decline/cancel for every file. A file whose hash or size differs from what the sender announced is never offered for saving.
- Saving in three tiers: the browser's save dialog (File System Access, Chromium desktop; the file only replaces its destination after the check passes), else the browser's private file system (OPFS) written from the worker, else an in-memory Blob capped at 512 MiB.
- File names from the other device are cleaned before they are shown or used as a suggested name (Unicode NFC, control, bidirectional and zero-width characters, path and reserved characters, Windows device names, 200-character limit that keeps the extension).
- Honest failure: after 20 s without an open channel, or when the connection fails, the page stops and offers the three ways out (same Wi-Fi, a phone hotspot, PixelHop or NoteHop) with the technical detail; once connected it shows the route (same network, or across the internet through STUN). A warning that files are not scanned is always on screen.
- Environment: `FILEHOP_TRUST_PROXY` (read the visitor's address from `X-Forwarded-For`) and `FILEHOP_STUN_URLS` (comma-separated STUN servers, none built in; no TURN). `deploy/nginx/file.hel.ink.conf` gets the `location = /api/send/signal` WebSocket block. New dependencies: `github.com/coder/websocket` (Go), `qrcode-generator` (bundled, no CDN). New text in all nine languages; Send is in the sidebar, the footer and the page chrome of `/send`.

### Changed
- The places that said nothing is ever uploaded (hero text, privacy text, dashboard card, README) now name this one optional exception, in all nine languages. The headline and meta descriptions stay as they are.
- The toast after adding files reads "Files added: {n}" (no more "1 files added") in English, German, Portuguese, Spanish and French.

## [1.1.0] - 2026-11-11

### Added
- PayHop (`pay.hel.ink`) in the family list (footer, dashboard sidebar and `/changelog`), its mark `hop-marks/payhop.svg`, and the Unbounded name class `hop-name-payhop` in `hop-brand.css`.
- `sitemap.xml` (the home page and `/changelog`, nothing signed-in) and a `Sitemap:` line in `robots.txt`.
- A dashboard at `/dashboard` for people signed in with HOP ID: the same converter workspace as the home page (queue, per-file X button) without the marketing page, in the family's dashboard chrome (sidebar with Convert, Changelog and the HOP family; topbar with Add files, language, theme and the account menu, where the settings now live) plus a small account card that says files are never uploaded. A guest who opens it is sent through sign-in and comes back to it; after sign-in with no `next`, people land on it. The public home page is unchanged, and the headers (CSP, COOP, COEP) are the app's own. New text in all nine languages.
- A test for the sign-in/sign-out cases below, and a migration test for databases made before `sessions.verified_at`.
- A real `/changelog` page (server-rendered from the embedded snapshot `web/changelog.json`, nine languages, light and dark, same CSP and cross-origin isolation headers as the app), a footer link to it, and `scripts/build-changelog.py` / `scripts/check-changelog.py` like the other apps. FileHop is listed in the family changelog sources.
- `og:image` and Open Graph / Twitter card tags on the app and on `/changelog`; the image is `og-image.png` in this repository.
- A test that the family list in the app equals the family manifest (`tools/hop-apps.json`, hop-assets v8) without FileHop.

### Fixed
- FileHop could keep showing an account the browser was no longer signed in with at HOP ID (for example after switching accounts there without signing out, or signing out in another browser, when the hub's `session.revoked` did not arrive). A session now records when the hub last vouched for it; after five minutes the next page load (the home page or `/dashboard`, once, never while converting) asks the hub quietly (`prompt=none`, the hub never shows a login page): the same HOP ID keeps the session, another one replaces it, and a signed-out hub ends it. The home page skips the check while files are queued or a conversion runs, and no check is offered while the hub is unreachable (a one-minute cached probe): then the page acts as a guest and `/dashboard` says the hub cannot be reached. If the session still cannot be read after the round trip (cookies blocked) FileHop says so in nine languages instead of redirecting again. A new sign-in also ends the session the browser held before.

### Changed
- hop-assets v9: the family manifest `tools/hop-apps.json`, the 3D engine and `hop-brand.css` are vendored byte-identical to v9 (v1-v8 untouched); the README family table (all nine READMEs) and `scripts/check-hop-family.sh` come from HEL.ink and name PayHop.
- The settings gear is gone from the top bar of the public page (top bar = primary action, language, theme, account). Settings stay reachable by everyone: a "Settings" item in the footer (guests and signed-in people), the hero button, and an item in the account menu on every page for signed-in people.
- With the hub unreachable (the family rule), an existing FileHop session stays trusted: nobody is redirected, signed out or shown as a guest, and `/dashboard` keeps opening with that session; the quiet re-check runs once the hub is back. The hub probe is now `GET <hub>/up` (2xx only, short timeout, cached about 60 s) instead of a HEAD on the hub root; a 502 from the hub's proxy counts as down.
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
