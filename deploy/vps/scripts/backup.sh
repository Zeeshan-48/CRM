#!/usr/bin/env bash
# ==============================================================================
# Bn Orbit - Automated PostgreSQL + Media Storage Daily Backup Script
# ==============================================================================
# 1. Takes a compressed pg_dump from bn-orbit-postgres.
# 2. Archives local uploaded media & call recordings from bn-orbit-prod_files.
# 3. Purges backups older than 14 days to preserve disk space.
#
# Cron setup (runs daily at 3:00 AM):
#   0 3 * * * /path/to/CRM/deploy/vps/scripts/backup.sh >> /var/log/bn-orbit-backup.log 2>&1
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VPS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${VPS_DIR}/.env.prod}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/bn-orbit}"
CONTAINER_NAME="${PG_CONTAINER:-bn-orbit-postgres}"
DB_USER="${PG_USER:-${PG_DATABASE_USER:-crm}}"
DB_NAME="${PG_DB:-${PG_DATABASE:-crm}}"
FILES_VOLUME="${FILES_VOLUME:-bn-orbit-prod_files}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_BACKUP_FILE="${BACKUP_DIR}/bn_orbit_db_${TIMESTAMP}.sql.gz"
FILES_BACKUP_FILE="${BACKUP_DIR}/bn_orbit_files_${TIMESTAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting PostgreSQL backup..."
docker exec "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip > "${DB_BACKUP_FILE}"
chmod 600 "${DB_BACKUP_FILE}"
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] DB backup completed: ${DB_BACKUP_FILE} ($(du -h "${DB_BACKUP_FILE}" | cut -f1))"

if docker volume inspect "${FILES_VOLUME}" >/dev/null 2>&1; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Archiving call recordings and uploaded documents (${FILES_VOLUME})..."
  docker run --rm -v "${FILES_VOLUME}:/source:ro" -v "${BACKUP_DIR}:/backup" alpine:3.20 \
    tar -czf "/backup/$(basename "${FILES_BACKUP_FILE}")" -C /source .
  chmod 600 "${FILES_BACKUP_FILE}"
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Files backup completed: ${FILES_BACKUP_FILE} ($(du -h "${FILES_BACKUP_FILE}" | cut -f1))"
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Purging backups older than 14 days..."
find "${BACKUP_DIR}" -type f \( -name "bn_orbit_db_*.sql.gz" -o -name "bn_orbit_files_*.tar.gz" -o -name "bn_orbit_backup_*.sql.gz" \) -mtime +14 -delete
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Backup finished successfully."
