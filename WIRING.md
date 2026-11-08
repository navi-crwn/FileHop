# Wiring FileHop into `file.hel.ink`

This app is standalone on purpose. It already has the shape the family needs, so wiring it in is additive: nothing in `src/lib/core/` or `src/App.svelte` has to be rewritten.

## Status, 2026-11-08

| Step | State |
|---|---|
| App moved to `web/`, Go server embeds `web/dist` | done (`cmd/filehop`, `internal/app`, `web/embed.go`) |
| Headers (COOP/COEP/CORP, CSP) from the Go handler | done, identical to section 3 except `connect-src 'self'` (no fetch to the hub is needed) |
| `/healthz`, `/hop/health`, `manifest`, `stats`, `users/{sub}`, `events` | done, signed with HOP App Protocol v1 |
| HOP ID sign-in, chained logout, account events | done; tested against `tools/hubstub`, not yet against the real hub |
| nginx vhost, systemd unit, env, installer | done in `deploy/`; see `docs/DEPLOY.md` |
| Three engines, `crossOriginIsolated` | Chromium, WebKit (Playwright), Firefox: 22/22 each; real Safari not yet |
| Hub registry row, `hop-auth` trusted hosts, Imperium entry | to do, in their own repos, after the owner approves |
| Prefs and stats (`/api/v1/prefs`, `/api/v1/stats`) | not started |
| "Send to" buttons, `/send` (P2P) | not started; `/send` already gets the app shell |

---

## 1. What is already decided (from the plan, 2026-11-05)

| Thing | Value |
|---|---|
| Name | FileHop |
| Slug in the hub registry | `filehop` |
| Subdomain | `file.hel.ink` |
| Repo | `navi-crwn/FileHop` |
| Colour | amber `#f59e0b` |
| Server | Go + SQLite, one binary, `web/` embedded (same pattern as NoteHop/PixelHop) |
| Browser | TypeScript + Svelte 5 (this repo) |
| Licence stance | no AGPL engine |

## 2. Public URLs the app expects

Nothing here is called yet, but these are the paths the code should use when it is:

| Path | Purpose |
|---|---|
| `/` | the app (this repo, `dist/`) |
| `/mark.svg` | the mark |
| `/vendor/pdf.worker.min.mjs` | pdf.js worker, must stay same-origin |
| `/hop-fonts/fonts-amnesia.css` | family fonts while standalone; switch to `https://hel.ink/hop-assets/v3/fonts-amnesia.css` after v3 exists |
| `/api/v1/prefs` | **to build** — presets and settings for a signed-in user |
| `/api/v1/stats` | **to build** — aggregate savings, numbers only |
| `/hop/health`, `/hop/stats`, `/hop/manifest`, `/hop/users/{sub}`, `/hop/events` | **to build** — Imperium protocol |

## 3. Headers (copy these to nginx)

The Go binary or nginx must send these for `/`; `tools/serve.mjs` already does, so the same strings are known to work:

```nginx
add_header Cross-Origin-Opener-Policy   "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;

# static assets
location /assets/ {
  add_header Cache-Control "public, max-age=31536000, immutable";
}

# engine bytes / pdf.js worker
location /vendor/ {
  add_header Cache-Control "public, max-age=31536000, immutable";
  types { application/wasm wasm; }
  brotli_static on;
  gzip_static on;
}
```

CSP goes in the Go handler, not nginx, so a nonce can be added later if the SSO callback ever needs one:

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' blob: data:;
media-src 'self' blob:;
connect-src 'self';
object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

`connect-src` grows by one entry per sibling app that gets a "send to" button (today it is `'self'` only). Do not add `https://hel.ink` to `connect-src`: fonts and icons are stylesheets and images, not fetches.

**Do not** put COEP on the marketing pages (`/privacy`, `/about`, `/licenses`). Isolation belongs to the app route only.

## 4. SSO: what to add, and where

The family uses short-lived HMAC tickets via `hub.hel.ink/sso/<client>` → `/auth/sso/callback`. NoteHop's `internal/app/sso.go` is the reference (Go), and this app should copy that, not invent a variant.

Minimum work:

1. `internal/app/sso.go` — ticket verification, app session cookie, logout on `session.revoked`.
2. `internal/db/` — SQLite with `users(sub)` , `prefs(user_id, key, json, updated_at)`, `stats(user_id, month, files, bytes_in, bytes_out)`.
3. `GET/PUT /api/v1/prefs/{key}` with the 64 KB per key and 50 keys per user limits from the plan.
4. Register `file.hel.ink` in `hop-auth` `trusted_hosts` and add the app row to the hub registry with `capabilities: [events]`.

In the browser, the only change is a small module that reads the app session and turns on:

- preset sync (the drawer already has a place for it),
- the "send to …" buttons on finished cards,
- the account menu in the topbar (currently absent by design — the standalone build has no account, and faking one would be worse than leaving it out).

`src/lib/core/` should not learn about identity. Keep it a converter; pass a `sendTo` callback into `JobCard` when the time comes.

## 5. Fonts and the hop-assets v3 question

The app vendors `hop-assets/v1` fonts under `public/hop-fonts/` so it works offline and with no third-party origin. Two options when wiring in:

- **Keep vendored.** Simplest, no CORP changes, works with COEP `require-corp` without touching the hub.
- **Use `hop-assets/v3`.** Requires `add_header Cross-Origin-Resource-Policy "cross-origin"` on the hop-assets location in the hub vhost, otherwise `require-corp` blocks the fonts.

The plan's open decision 5 (v3 for the 7th app in the manifest and the 3D tiles) is still open. Vendored fonts mean FileHop does not have to wait for it.

## 6. Where this repo should live

```
navi-crwn/FileHop/
  cmd/filehop/            # Go server (to add)
  internal/               # app, db, i18n, hop protocol (to add)
  web/                    # this Vite + Svelte app
    src/
    public/
    dist/                 # build output, embedded by Go
  deploy/                 # nginx, systemd, install.sh (to add)
  docs/                   # 9-language GitHub Pages (to add)
  tools/                  # checks, fixtures, static server (this repo)
```

Move `src/`, `public/`, `index.html`, `vite.config.ts`, `tsconfig.json` and `package.json` into `web/`, keep `tools/` at the root, and point the Go embed at `web/dist`.

## 7. Order of work, so nothing is blocked

1. Create the repo, move this app in, keep it working with `npm run build` → `dist/`.
2. Go server that serves `dist/` with the headers above; `/hop/health` first, since Imperium polls it.
3. Deploy behind nginx on a temporary host; confirm `crossOriginIsolated === true` in Chrome, Firefox and Safari.
4. SSO + prefs + stats.
5. Registry row, `hop-auth` trusted hosts, README family table.
6. Then the phase 2 work (video/audio) and the sibling-app buttons.

## 8. Checks before any of that ships

- `npm test`, `npm run lint:i18n`, `npm run build` — all green (they are, today).
- Open the app, convert one file of each category, and watch the Network tab stay same-origin.
- Run `testdata/hostile-*` through it: zip-slip, zip bomb, PDF `/OpenAction`, SVG `<script>`.
- Confirm the CSP in the response header matches the string in section 3, and that nothing is blocked in the console.
