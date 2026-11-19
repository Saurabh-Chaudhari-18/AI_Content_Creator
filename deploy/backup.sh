#!/bin/sh
# Nightly PostgreSQL dump for the production stack (the `backup` service).
# Connection settings come from PGHOST / PGUSER / PGPASSWORD / PGDATABASE.
#
# Restore (see deploy/README.md):
#   docker compose -f docker-compose.prod.yml exec -T backup \
#     pg_restore --clean --if-exists --no-owner --role=omnipost_owner -d ai_content /backups/<file>.dump
set -u

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p /backups

while true; do
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  file="/backups/omnipost-$stamp.dump"
  # Written under a temporary name, so a half-finished dump never looks like a backup.
  if pg_dump --format=custom --file="$file.partial"; then
    mv "$file.partial" "$file"
    echo "$(date -u +%FT%TZ) backup ok: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.partial"
    echo "$(date -u +%FT%TZ) BACKUP FAILED" >&2
  fi
  find /backups -name 'omnipost-*.dump' -mtime +"$KEEP_DAYS" -delete
  sleep "$INTERVAL"
done
