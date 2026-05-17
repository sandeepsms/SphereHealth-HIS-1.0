#!/usr/bin/env bash
# scripts/backup-mongo.sh
#
# Daily MongoDB dump for SphereHealth HIS. Closes audit finding H-07.
#
# Usage (manual):
#   MONGO_URI=mongodb://... BACKUP_DEST=/var/backups/spherehealth ./backup-mongo.sh
#
# Cron (recommended — every night at 02:00 local time):
#   0 2 * * * /opt/spherehealth/Backend/scripts/backup-mongo.sh >> /var/log/sphere-backup.log 2>&1
#
# Required env:
#   MONGO_URI       — same value the app uses
# Optional env:
#   BACKUP_DEST     — local destination dir (default /var/backups/spherehealth)
#   BACKUP_RETAIN_D — days to keep before pruning (default 30)
#   BACKUP_S3_URI   — if set, also `aws s3 cp` the archive (requires aws cli + IAM)
#
# The script is intentionally minimal — it's a defensive operational
# baseline, not a full backup/restore pipeline. For production hospital
# deployments, layer this with:
#   - point-in-time recovery via the MongoDB oplog (replica set required)
#   - off-site cold storage with AES256 / SSE-KMS
#   - quarterly restore drills
#
# Exits non-zero on any failure so cron alerting kicks in.

set -euo pipefail

if [[ -z "${MONGO_URI:-}" ]]; then
  echo "FATAL: MONGO_URI is not set — refusing to backup." >&2
  exit 1
fi

DEST="${BACKUP_DEST:-/var/backups/spherehealth}"
RETAIN_DAYS="${BACKUP_RETAIN_D:-30}"
TS="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="${DEST}/sphere-${TS}.archive.gz"

mkdir -p "$DEST"

echo "[backup] $(date -Iseconds) — dumping to $ARCHIVE"
mongodump --uri="$MONGO_URI" --gzip --archive="$ARCHIVE"

# Verify the archive isn't empty (mongodump can return 0 on auth failure
# with a tiny header-only file in some configurations)
SIZE=$(stat -c %s "$ARCHIVE" 2>/dev/null || stat -f %z "$ARCHIVE")
if [[ "$SIZE" -lt 4096 ]]; then
  echo "FATAL: archive too small (${SIZE} bytes) — likely auth/connect failure." >&2
  rm -f "$ARCHIVE"
  exit 2
fi
echo "[backup] ok — size=${SIZE} bytes"

# Optional: ship to S3 (or any other object store with `aws s3 cp` semantics).
if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  echo "[backup] uploading to $BACKUP_S3_URI"
  aws s3 cp "$ARCHIVE" "$BACKUP_S3_URI/" --sse AES256
fi

# Prune older archives — keep N days. -mtime is days since modification.
echo "[backup] pruning archives older than ${RETAIN_DAYS} days"
find "$DEST" -maxdepth 1 -name 'sphere-*.archive.gz' -mtime "+${RETAIN_DAYS}" -print -delete

echo "[backup] done"
