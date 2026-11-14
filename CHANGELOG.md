# Changelog

What changed in FileHop, written for the people who use it. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with one addition: every release has a short title, and every item starts with the place it concerns in bold, then says what changed, what that means for you and why. The /changelog page of the site is built from this file by scripts/build-changelog.py; nothing on the page is copied from commit or pull request titles.

## [Unreleased]

## [1.2.3] - 2026-11-14 - Back to your dashboard, announcements, a calmer changelog

### Added

- **Dashboard, sidebar.** The line "Part of Hop Easy Link" now sits at the bottom of the sidebar on the dashboard and on the Send page, as in the other HOP apps. Reason: the dashboard had no such line, and it belongs with the family list.
- **Dashboard, announcements.** A notice card can appear at the top of the dashboard. You can close it and it stays away for seven days. Nothing is shown, and no space is kept, while there is no announcement. Reason: every HOP dashboard should have a place for announcements.

### Changed

- **Send, changelog and the home page for signed-in people.** The logo, the Convert link, the main button, the Back link and the privacy link now lead to your dashboard when you are signed in, and to the home page when you are not. The account menu on the home page has a Dashboard entry. Reason: people who opened Send from the dashboard were taken to the public home page and had no way back.
- **Changelog page.** The page now shows one card per release with what changed, where, what it means for you and why, instead of a list of pull request titles. The text of the entries is in English; the page labels are in all nine languages. Reason: the old list was hard to read and showed internal wording.
- **Changelog history.** Every earlier release was rewritten in the same plain form, and the page is up to date again (it had stopped at an older release).

## [1.2.2] - 2026-11-13 - Send several files at once, a calmer Send page

### Added

- **Home page, Send.** A "Send a file" button beside "Add files", a Send link in the top bar and a short band that explains both halves of FileHop: convert here and nothing is uploaded, send device to device and nothing is stored. The same three places are in the page that loads before the app, in every language. Reason: many visitors did not know Send existed.
- **Send, groups of files.** "Accept all" and "Decline all" deal with a whole run of offered files at once, so a folder of ten files is one press instead of ten. They only reach the group on offer; the next group, a single file or an offer from an older device asks again. A file the other device withdraws while the save window is open is dropped, so nothing is left waiting. Reason: accepting ten files one by one was tedious.
- **Send, cancel.** Every offered file has a cancel button, and "Cancel the rest" appears while more than one file is on its way. The sender sees its own queue. Reason: a long queue could not be stopped.
- **Send, save all.** "Save all" packs the files received in one go into a single ZIP on your device, up to 512 MiB; nothing is uploaded. The files are read as a stream, names that differ only in capitals are kept apart, the button says so when one file failed (for example "3 of 4"), and if the ZIP cannot be made the page says so and every file keeps its own Save link. Reason: saving many files one by one was tedious.

### Changed

- **Send, layout.** The page has two columns, Connection (code, QR code, pairing number, route) and Transfers (queue and received files), with the three "How it works" steps below. On a phone it is one column with Connection first. The words are in all nine languages. Reason: the page had empty gaps and the steps were hard to find.
- **Send, groups on the wire.** A sender now announces how many files and how many bytes are coming before the first one, so the receiver can say how much to expect and refuse a group above 512 MiB before anything is written. One file is not a group and is limited only by the per-file limit. Older devices still pair and transfer as before. Reason: the receiver could not tell how much was coming.
- **Dashboard.** The dashboard is centred in one column like the other apps, with a Send card next to the account card that says files go straight from one device to the other and are never stored. Reason: Send had no door from the dashboard.

## [1.2.1] - 2026-11-12 - Fixes for saving to PixelHop and for Send

### Fixed

- **Save to PixelHop.** The page reported a failure although PixelHop had stored the file. A stored file is now always reported as saved, and when PixelHop does not answer in time the page asks you to look in PixelHop before trying again. Reason: PixelHop answers with an address on its own link host, which FileHop did not accept.
- **Send, old codes.** The code of a device that left is dead at once, so an old QR code says the room does not exist instead of leaving the second device waiting. Opening a new code while on Send starts over with it, asking first during a pairing or a transfer. Reason: old codes kept devices waiting for nothing.
- **Send, several files.** Receiving the next file no longer deletes the earlier ones from the browser's private storage, so their Save links keep working until the page is closed. Reason: earlier files failed with "download failed".

### Changed

- **Theme and language.** The theme and the language follow the choice made in any HOP app on hel.ink. A language is stored only when you pick one; it is never guessed from the browser. Reason: a choice made in one app was not followed in the next.
- **Home page and Send, first view.** The page is drawn in your theme and language before the app loads, so it is readable at once and by search engines; without scripts it says that FileHop needs JavaScript. Reason: the page used to be blank until the app arrived.

## [1.2.0] - 2026-11-12 - Send a file from one device to another

### Added

- **Send.** A new page, Send, sends a file straight from one device to another. Nothing is uploaded or stored; the server only introduces the two browsers. A room is a six-digit code, valid for ten minutes, for exactly two devices. Pairing is by QR code or by typing the code, and guests can send. Reason: people wanted to move a file between their own devices without an upload.
- **Send, pairing check.** Both people compare a six-digit number and press Match; no file can flow before both have. Reason: this shows that nobody sits between the two devices.
- **Send, transfer.** Files travel over one reliable connection with flow control, a check of every file against what the sender announced, and an explicit accept, decline or cancel for each file. A file that does not match is never offered for saving. Reason: files must arrive complete and unchanged.
- **Send, saving.** Files are saved through the browser's save window where it exists, otherwise through the browser's private storage, otherwise from memory up to 512 MiB. Reason: browsers differ in how they can write large files.
- **Send, names and failures.** File names from the other device are cleaned before they are shown. After 20 seconds without a connection the page stops and offers three ways out (same Wi-Fi, a phone hotspot, PixelHop or NoteHop), and a warning that files are not scanned is always on screen. Reason: unclear failures and unsafe names.
- **Save to PixelHop.** A finished image or PDF can be saved to your PixelHop library, for signed-in people only. It asks first, in nine languages, and says that this one file passes through the FileHop server and is not kept. Reason: people wanted converted images in their library.

### Changed

- **Texts about uploads.** The hero, privacy text and dashboard card now name this one optional exception to "nothing is uploaded", in nine languages. Reason: the old wording was no longer fully true.
- **Toast after adding files.** It reads "Files added: 3" instead of "1 files added" in English, German, Portuguese, Spanish and French. Reason: wrong grammar.

## [1.1.0] - 2026-11-11 - Dashboard, changelog page and PayHop

### Added

- **Dashboard.** Signed-in people get a dashboard with the same converter workspace without the marketing page, a sidebar with the HOP family and a top bar with the main action, language, theme and account. A guest who opens it is sent through sign-in and comes back to it. Reason: members should not wade through the marketing page.
- **Changelog page.** FileHop has its own changelog page in nine languages, light and dark. Reason: people could not see what changed.
- **Family.** PayHop appears in the family lists, and a sitemap helps search engines find the home page and the changelog. Reason: PayHop joined the family.

### Fixed

- **Signed-in account.** FileHop could keep showing an account that the browser was no longer signed in with at HOP ID. After five minutes the next page load asks the hub quietly: the same account keeps the session, another account replaces it, and a signed-out hub ends it. If the hub cannot be reached, the existing session stays trusted. Reason: switching accounts in another tab left FileHop on the old one.

### Changed

- **Settings.** The settings button is gone from the top bar; settings stay one tap away in the footer, the hero button and the account menu. Reason: the top bar should hold only the main action, language, theme and account.
- **File rows.** Every file row has an X button that removes the file before it is processed, stops it while it runs, or drops a finished row without touching a download already made. Reason: the old separate buttons were confusing.
- **Top bar.** The family app grid was removed from the top bar; the family list stays in the footer. Reason: the family rule for dashboards.
- **Home page.** The format boxes fill whole rows and no box stands alone. Reason: an uneven layout.

## [1.0.0] - 2026-11-10 - Sign in with HOP ID and a calmer look

### Added

- **Sign-in.** You can sign in with HOP ID; converting still works without an account. Signing out at the hub signs you out of FileHop too. Reason: one account for the whole family.
- **Account control.** The top bar shows a sign-in button or the account menu when sign-in is available, with errors in your language. Reason: people need a way in and out.
- **Family integration.** FileHop talks to the family's administration app and to the hub for account changes, and offers a health check. Reason: the administrators need to see and manage accounts.
- **Footer.** The footer starts with the HOP ID mark and "Part of Hop Easy Link". Reason: the family look.
- **Installing.** One-command install, update and uninstall scripts. Reason: easier self-hosting.

### Changed

- **Look.** The header and footer show the mark and the app name in the app's own typeface; the formats section is one grid with a small scene in each box; the top bar uses the family language menu; controls follow one standard; surfaces use a flat style as an optional Clean style in settings. Reason: FileHop looked different from the other apps.
- **Icons.** Install icons for phones and computers match the family mark. Reason: the old icons did not match.
- **Dialogs.** "Drop everything" and "Clear finished" ask first, with the shared HOP dialog. Reason: one click could discard work.
- **Phones.** The top bar is one row on phones. Reason: it wrapped onto two rows.

### Fixed

- **Sign-out.** The sign-out link returns you to FileHop. Reason: people ended up on the hub.
- **Merging PDFs.** Only the PDFs set to merge are merged, and a group keeps one merge through retries and late joiners. Reason: other PDFs were merged by mistake.
- **Older browsers.** Image conversion and PDF to picture failed in browsers without a certain canvas feature (Safari before 16.4); those jobs now run on the page. Reason: the conversion simply failed there.

## [0.1.0] - 2026-11-08 - The first converter

### Added

- **Converter.** The first FileHop: images, PDF, data, text, archives and hashes converted in the browser tab, in nine languages, with nothing stored on the server. Reason: a private converter that never uploads files.
