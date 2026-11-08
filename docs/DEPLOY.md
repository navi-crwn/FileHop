# Deploying FileHop to file.hel.ink

FileHop is one Go binary with the browser app embedded. On the HOP VPS it runs
like NoteHop: systemd on `127.0.0.1:8095`, nginx in front, Cloudflare in front
of nginx with the `*.hel.ink` origin certificate.

Everything that needs root is in `deploy/install.sh`. Building does not.

## 1. DNS (Cloudflare)

Add `file` in the `hel.ink` zone, proxied (orange cloud), pointing where
`note` points (same A/AAAA, or a CNAME to `hel.ink`). The origin certificate
already covers `*.hel.ink`.

Cloudflare features that inject scripts break the CSP and must stay off for
this host: Rocket Loader, Email Address Obfuscation, and any "Web Analytics"
auto-injection. Check with `curl -sI https://file.hel.ink/` that exactly one
`content-security-policy` header arrives and `cross-origin-embedder-policy:
require-corp` survives.

## 2. Build and install (VPS)

```bash
git clone https://github.com/navi-crwn/FileHop ~/apps/filehop   # first time
cd ~/apps/filehop && git pull --ff-only
npm ci && npm run build
~/sdk/go/bin/go build -trimpath -ldflags "-s -w -X main.version=$(git describe --tags --always)" -o filehop ./cmd/filehop
sudo bash deploy/install.sh ./filehop
```

The first run creates `/etc/filehop/filehop.env` with a fresh
`FILEHOP_SSO_SECRET` and never prints it. Later runs keep the env file, keep
the previous binary as `/usr/local/bin/filehop.prev`, and restart.

Rollback: `sudo install -m0755 /usr/local/bin/filehop.prev /usr/local/bin/filehop && sudo systemctl restart filehop`.

## 3. Register FileHop with the hub

The hub (HEL.ink) needs the registry entry from its own PR, and the shared
secret. Copy the secret without displaying it:

```bash
sudo bash -c 's=$(sed -n "s/^FILEHOP_SSO_SECRET=//p" /etc/filehop/filehop.env);
  grep -q "^HOP_SSO_SECRET_FILEHOP=" /var/www/helink/hub/.env ||
  printf "\nHOP_SSO_SECRET_FILEHOP=%s\n" "$s" >> /var/www/helink/hub/.env'
```

Then deploy the hub as usual; the deploy runs
`php artisan db:seed --class='Database\Seeders\HopAppsSeeder'`, which adds the
`filehop` row to `apps` with the `events` capability.

Imperium reads `/hop/health`, `/hop/manifest`, `/hop/stats` and
`/hop/users/{sub}` signed as `imperium` with the same secret; it needs its own
entry for FileHop (an Imperium change, not part of this repo).

## 4. Check

```bash
curl -fsS https://file.hel.ink/healthz
curl -sI https://file.hel.ink/ | grep -iE 'cross-origin|content-security'
systemctl status filehop --no-pager
```

In a browser: open the site, sign in with HOP ID, convert one file, and check
`crossOriginIsolated` is `true` in the console. `npm run matrix` against the
public URL repeats the three-engine conversion check.
