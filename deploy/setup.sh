#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu 24.04 Vultr Cloud Compute VM. Run as root:
#   DOMAIN=safecode.example.com REPO=https://github.com/<you>/safecode-agent bash setup.sh
set -euo pipefail
ACCESS_TOKEN_SOURCE="${ACCESS_TOKEN_SOURCE:?set path to an existing private access-token file (at least 32 characters)}"
[ -r "$ACCESS_TOKEN_SOURCE" ] || { echo "Token file is not readable"; exit 1; }
DOMAIN="${DOMAIN:?set DOMAIN (DNS A record -> this VM)}"; REPO="${REPO:?set REPO git url}"
apt-get update && apt-get install -y ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https ufw
# Docker
curl -fsSL https://get.docker.com | sh
# gVisor (runsc) as an extra Docker runtime
curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" > /etc/apt/sources.list.d/gvisor.list
apt-get update && apt-get install -y runsc && runsc install && systemctl restart docker
docker run --rm --runtime=runsc hello-world >/dev/null && echo "gVisor OK"
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
# Caddy (automatic HTTPS)
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
# App user (in docker group so it can start sandbox containers; the app itself never runs user code)
id safecode >/dev/null 2>&1 || useradd -r -m -d /opt/safecode -s /usr/sbin/nologin safecode
usermod -aG docker safecode
[ -d /opt/safecode/app ] || git clone "$REPO" /opt/safecode/app
cd /opt/safecode/app && [ -f .env ] || cp .env.example .env
sed -i 's/^SANDBOX_MODE=.*/SANDBOX_MODE=docker/' .env
chown -R safecode:safecode /opt/safecode
docker pull python:3.12-alpine && docker pull bash:5
PYTHON_IMAGE_DIGEST=$(docker image inspect --format '{{index .RepoDigests 0}}' python:3.12-alpine)
BASH_IMAGE_DIGEST=$(docker image inspect --format '{{index .RepoDigests 0}}' bash:5)
install -o safecode -g safecode -m 600 "$ACCESS_TOKEN_SOURCE" /opt/safecode/access-token
[ -f /opt/safecode/receipt-key.pem ] || node scripts/create-signing-key.js /opt/safecode/receipt-key.pem
chown safecode:safecode /opt/safecode/receipt-key.pem /opt/safecode/receipt-key.pem.pub
mkdir -p /var/lib/safecode-work
WORK_UID=$(id -u safecode); WORK_GID=$(id -g safecode)
if ! mountpoint -q /var/lib/safecode-work; then
  mount -t tmpfs -o "size=64m,nr_inodes=8192,mode=0755,uid=$WORK_UID,gid=$WORK_GID,nosuid,nodev,noexec" tmpfs /var/lib/safecode-work
fi
if ! grep -q ' /var/lib/safecode-work ' /etc/fstab; then
  echo "tmpfs /var/lib/safecode-work tmpfs size=64m,nr_inodes=8192,mode=0755,uid=$WORK_UID,gid=$WORK_GID,nosuid,nodev,noexec 0 0" >> /etc/fstab
fi
# Append explicit deployment settings; config loader uses the first value, so replace existing entries.
set_config() { sed -i "/^$1=/d" .env; printf '%s=%s\n' "$1" "$2" >> .env; }
set_config SANDBOX_REQUIRED_RUNTIME runsc
set_config SANDBOX_IMAGE_PYTHON "$PYTHON_IMAGE_DIGEST"
set_config SANDBOX_IMAGE_BASH "$BASH_IMAGE_DIGEST"
set_config SAFECODE_WORK_DIR /var/lib/safecode-work
set_config SAFECODE_ACCESS_TOKEN_FILE /opt/safecode/access-token
set_config SAFECODE_SIGNING_KEY_FILE /opt/safecode/receipt-key.pem
set_config SAFECODE_ORIGIN "https://$DOMAIN"
chmod 600 .env
chown safecode:safecode .env
install -m 644 deploy/safecode.service /etc/systemd/system/safecode.service
sed "s/{\$DOMAIN}/$DOMAIN/" deploy/Caddyfile > /etc/caddy/Caddyfile
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
systemctl daemon-reload && systemctl enable --now safecode && systemctl reload caddy
echo "Now edit /opt/safecode/app/.env (VULTR_INFERENCE_API_KEY) and: systemctl restart safecode"
