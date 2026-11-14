#!/usr/bin/env bash
# ==============================================================================
# Bn Orbit - Automated PostgreSQL Daily Backup Script
# ==============================================================================
# 1. Takes a compressed pg_dump from the running postgres container.
# 2. Saves it to /var/backups/bn-orbit/bn_orbit_backup_YYYYMMDD_HHMMSS.sql.gz.
# 3. Automatically deletes backups older than 14 days to preserve disk space.
#
# Cron setup (runs daily at 3:00 AM):
#   0 3 * * * /path/to/CRM/deploy/vps/scripts/backup.sh >> /var/log/bn-orbit-backup.log 2>&1
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/bn-orbit}"
CONTAINER_NAME="${PG_CONTAINER:-bn-orbit-postgres}"
DB_USER="${PG_USER:-crm}"
DB_NAME="${PG_DB:-crm}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/bn_orbit_backup_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting database backup..."
docker exec "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip > "${BACKUP_FILE}"

FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Backup completed: ${BACKUP_FILE} (${FILE_SIZE})"

# Auto-purge backups older than 14 days
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Purging backups older than 14 days..."
find "${BACKUP_DIR}" -type f -name "bn_orbit_backup_*.sql.gz" -mtime +14 -delete
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Cleanup finished successfully."

