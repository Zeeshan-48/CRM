#!/usr/bin/env bash
# ==============================================================================
# Bn Orbit - First-Boot VPS Deploy & Let's Encrypt TLS Bootstrap
# ==============================================================================
# Safely eliminates the Nginx/Certbot chicken-and-egg problem:
#   1. Starts stack with edge-nginx in HTTP ACME bootstrap mode (no crash!).
#   2. Obtains real Let's Encrypt TLS certs for CRM_DOMAIN and CONSOLE_DOMAIN.
#   3. Recreates edge-nginx, which automatically detects certs and switches to HTTPS.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VPS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${VPS_DIR}/docker-compose.prod.yml"
ENV_FILE="${VPS_DIR}/.env.prod"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy .env.prod.example first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

: "${CRM_DOMAIN:?Set CRM_DOMAIN in deploy/vps/.env.prod}"
: "${CONSOLE_DOMAIN:?Set CONSOLE_DOMAIN in deploy/vps/.env.prod}"
: "${CERTBOT_EMAIL:?Set CERTBOT_EMAIL in deploy/vps/.env.prod}"

if [[ "${CRM_DOMAIN}" == *"example.com"* || "${CONSOLE_DOMAIN}" == *"example.com"* || "${CERTBOT_EMAIL}" == *"example.com"* ]]; then
  echo "Replace example.com placeholders in deploy/vps/.env.prod before issuing TLS certificates." >&2
  exit 1
fi

echo "==> Step 1: Building and starting stack (edge-nginx starts in ACME bootstrap mode)..."
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --build

echo "==> Step 2: Issuing Let's Encrypt TLS certificates for ${CRM_DOMAIN} and ${CONSOLE_DOMAIN}..."
docker run --rm \
  -v bn-orbit-prod_certbot_conf:/etc/letsencrypt \
  -v bn-orbit-prod_certbot_www:/var/www/certbot \
  certbot/certbot:latest certonly \
  --webroot -w /var/www/certbot \
  --email "${CERTBOT_EMAIL}" \
  --agree-tos --no-eff-email \
  --cert-name "${CRM_DOMAIN}" \
  -d "${CRM_DOMAIN}"

docker run --rm \
  -v bn-orbit-prod_certbot_conf:/etc/letsencrypt \
  -v bn-orbit-prod_certbot_www:/var/www/certbot \
  certbot/certbot:latest certonly \
  --webroot -w /var/www/certbot \
  --email "${CERTBOT_EMAIL}" \
  --agree-tos --no-eff-email \
  --cert-name "${CONSOLE_DOMAIN}" \
  -d "${CONSOLE_DOMAIN}"

echo "==> Step 3: Enabling full HTTPS configuration on edge-nginx..."
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --force-recreate edge-nginx

echo "==> Deployment & TLS setup complete!"
echo "    CRM App:          https://${CRM_DOMAIN}"
echo "    Operator Console: https://${CONSOLE_DOMAIN}"
