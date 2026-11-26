#!/usr/bin/env bash
# ==============================================================================
# Bn Orbit - Automated Let's Encrypt TLS Renewal & Nginx Reload
# ==============================================================================
# Cron setup (runs twice daily as recommended by Let's Encrypt):
#   0 4,16 * * * /path/to/CRM/deploy/vps/scripts/renew-ssl.sh >> /var/log/bn-orbit-ssl.log 2>&1
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VPS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${VPS_DIR}/docker-compose.prod.yml"
ENV_FILE="${VPS_DIR}/.env.prod"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Checking TLS certificate renewals..."
docker run --rm \
  -v bn-orbit-prod_certbot_conf:/etc/letsencrypt \
  -v bn-orbit-prod_certbot_www:/var/www/certbot \
  certbot/certbot:latest renew --webroot -w /var/www/certbot --quiet

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T edge-nginx sh -c 'nginx -t && nginx -s reload'
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Renewal check & Nginx reload complete."
