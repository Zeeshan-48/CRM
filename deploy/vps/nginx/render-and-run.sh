#!/bin/sh
set -eu

: "${CRM_DOMAIN:?CRM_DOMAIN environment variable is required}"
CONSOLE_DOMAIN="${CONSOLE_DOMAIN:-$CRM_DOMAIN}"
EDGE_MODE="${EDGE_MODE:-proxy}"

mkdir -p /etc/nginx/conf.d
rm -f /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/console-subdomain.conf

if [ "$EDGE_MODE" = "proxy" ]; then
  if [ "$CONSOLE_DOMAIN" = "$CRM_DOMAIN" ]; then
    echo "[edge-nginx] Single-domain host-proxy mode: CRM=${CRM_DOMAIN}/, Console=${CRM_DOMAIN}/console/"
  else
    echo "[edge-nginx] Dual-domain host-proxy mode: CRM=${CRM_DOMAIN}, Console=${CONSOLE_DOMAIN}"
    envsubst '${CRM_DOMAIN} ${CONSOLE_DOMAIN}' \
      < /etc/nginx/templates/console.subdomain.proxy.conf.template \
      > /etc/nginx/conf.d/console-subdomain.conf
  fi
  TEMPLATE="/etc/nginx/templates/nginx.proxy.conf.template"
else
  CERT_CRM_FULL="/etc/letsencrypt/live/${CRM_DOMAIN}/fullchain.pem"
  CERT_CRM_KEY="/etc/letsencrypt/live/${CRM_DOMAIN}/privkey.pem"
  CERT_CONSOLE_FULL="/etc/letsencrypt/live/${CONSOLE_DOMAIN}/fullchain.pem"
  CERT_CONSOLE_KEY="/etc/letsencrypt/live/${CONSOLE_DOMAIN}/privkey.pem"

  if [ -f "$CERT_CRM_FULL" ] && [ -f "$CERT_CRM_KEY" ] && [ -f "$CERT_CONSOLE_FULL" ] && [ -f "$CERT_CONSOLE_KEY" ]; then
    echo "[edge-nginx] TLS certificates verified for ${CRM_DOMAIN} and ${CONSOLE_DOMAIN}; loading HTTPS config."
    TEMPLATE="/etc/nginx/templates/nginx.ssl.conf.template"
  else
    echo "[edge-nginx] TLS certificates missing; starting HTTP ACME bootstrap mode for Certbot issuance."
    TEMPLATE="/etc/nginx/templates/nginx.bootstrap.conf.template"
  fi
fi

# Replace only our two domain placeholders; preserve Nginx $host/$scheme/etc. variables.
envsubst '${CRM_DOMAIN} ${CONSOLE_DOMAIN}' < "$TEMPLATE" > /etc/nginx/nginx.conf
nginx -t

if [ "${NGINX_TEST_ONLY:-0}" = "1" ]; then
  exit 0
fi

exec nginx -g "daemon off;"
