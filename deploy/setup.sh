#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu 24.04 Vultr Cloud Compute VM. Run as root:
#   DOMAIN=safecode.example.com REPO=https://github.com/<you>/safecode-agent bash setup.sh
set -euo pipefail
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
install -m 644 deploy/safecode.service /etc/systemd/system/safecode.service
sed "s/{\$DOMAIN}/$DOMAIN/" deploy/Caddyfile > /etc/caddy/Caddyfile
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
systemctl daemon-reload && systemctl enable --now safecode && systemctl reload caddy
echo "Now edit /opt/safecode/app/.env (VULTR_INFERENCE_API_KEY) and: systemctl restart safecode"
