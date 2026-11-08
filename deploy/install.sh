#!/usr/bin/env bash
# Installs or updates FileHop on the VPS. Run as root (sudo), from the
# repository root, after building the binary as a normal user:
#
#   npm ci && npm run build
#   ~/sdk/go/bin/go build -trimpath -ldflags "-s -w -X main.version=$(git describe --tags --always)" -o filehop ./cmd/filehop
#   sudo bash deploy/install.sh ./filehop
#
# First run: creates the filehop user, /etc/filehop/filehop.env (with a fresh
# secret that is never printed), the systemd unit and
# the nginx vhost. Later runs: replace the binary and restart. Never overwrites
# an existing env file.
set -euo pipefail

bin=${1:?usage: sudo bash deploy/install.sh ./filehop}
here=$(cd "$(dirname "$0")" && pwd)

[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
"$bin" -version >/dev/null || { echo "$bin does not run" >&2; exit 1; }

id filehop >/dev/null 2>&1 || useradd --system --home /var/lib/filehop --shell /usr/sbin/nologin filehop

if [ ! -f /etc/filehop/filehop.env ]; then
  install -d -m 0750 -o root -g filehop /etc/filehop
  ( umask 0137
    sed "s|^FILEHOP_SSO_SECRET=.*|FILEHOP_SSO_SECRET=$(openssl rand -hex 32)|" "$here/filehop.env.example" > /etc/filehop/filehop.env )
  chown root:filehop /etc/filehop/filehop.env
  chmod 0640 /etc/filehop/filehop.env
  echo "Created /etc/filehop/filehop.env with a fresh FILEHOP_SSO_SECRET (not printed)."
  echo "Copy it to the hub as HOP_SSO_SECRET_FILEHOP without showing it: see docs/DEPLOY.md, step 3."
fi

# keep the previous binary for a quick rollback
[ -f /usr/local/bin/filehop ] && cp -p /usr/local/bin/filehop /usr/local/bin/filehop.prev
install -m 0755 "$bin" /usr/local/bin/filehop

install -m 0644 "$here/filehop.service" /etc/systemd/system/filehop.service
systemctl daemon-reload
systemctl enable filehop >/dev/null
systemctl restart filehop

if [ ! -f /etc/nginx/sites-available/file.hel.ink ]; then
  install -m 0644 "$here/nginx/file.hel.ink.conf" /etc/nginx/sites-available/file.hel.ink
  ln -sf /etc/nginx/sites-available/file.hel.ink /etc/nginx/sites-enabled/file.hel.ink
fi
nginx -t
systemctl reload nginx

sleep 1
systemctl --no-pager --lines=3 status filehop | head -5
curl -fsS http://127.0.0.1:8095/healthz && echo "FileHop $(/usr/local/bin/filehop -version) is up"
