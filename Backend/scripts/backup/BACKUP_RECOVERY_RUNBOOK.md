# SphereHealth — Backup & Disaster-Recovery Runbook (R7hr-253)

**Goal:** never lose patient data. Every backup is written to **two places** (an
offline local/external drive *and* an online cloud-synced folder), is
**integrity-checked** (sha256), and is **proven recoverable** by a monthly
restore-drill — so a disk crash, ransomware, theft, or fire can't wipe your data.

> ⚠️ This is **tool-free** — it uses only Node + the MongoDB driver already in
> the app. It does **not** need `mongodump`/`mongorestore` installed.

---

## 1. What runs, and when

| Task | When | What it does |
|---|---|---|
| **Nightly** | every day 02:30 | Full backup → offline copy → online (cloud-synced) copy → verify both → prune to last 14 |
| **Monthly** | 1st of month 03:00 | Same, **plus a restore-drill** (restores into a throwaway DB and checks the doc count round-trips) → prune to last 24 |

Each backup is a single file `sphere_<timestamp>.shbak.gz` + a `.sha256`
sidecar. Layout in **both** the offline and online folders:

```
<BACKUP_OFFLINE_DIR>\
  nightly\  sphere_YYYYMMDD_HHmm.shbak.gz (+ .sha256)
  monthly\  sphere_YYYYMM.shbak.gz        (+ .sha256)
  backup.log          ← every run appends here
  last-backup.json    ← machine-readable status of the most recent run
```

---

## 2. One-time setup

1. **Pick your two destinations** and put them in `Backend/.env`
   (see `Backend/.env.backup.example`):
   ```
   BACKUP_OFFLINE_DIR=E:\SphereBackups          # an EXTERNAL / USB / NAS drive is best
   BACKUP_SYNCED_DIR=C:\Users\<you>\OneDrive\SphereBackups   # any cloud-synced folder
   ```
   - **Offline** should be a *different physical disk* than the DB (external/USB/NAS),
     so one disk dying doesn't take both the DB and its backups.
   - **Online** is any folder synced by **OneDrive / Google Drive / Dropbox desktop** —
     the sync app uploads it off-site automatically. No passwords are stored in the app.
   - If you leave `BACKUP_SYNCED_DIR` blank, it auto-uses `%OneDrive%\SphereBackups`.

2. **Register the scheduled tasks** (once, as Administrator):
   ```powershell
   cd Backend\scripts\backup
   powershell -ExecutionPolicy Bypass -File .\setup-backup-tasks.ps1
   ```

3. **Test immediately** (don't wait for 02:30):
   ```bash
   node Backend/scripts/backup/runBackup.js --mode=nightly --verify
   ```
   Then confirm `<BACKUP_OFFLINE_DIR>\last-backup.json` shows `"ok": true`, and that
   the file also appeared in your cloud-synced folder (and uploaded).

---

## 3. 🚨 RECOVERY — restoring after a failure

> The restore is **destructive**. It refuses to run without an explicit `--file`
> and a hand-typed `--confirm`, and it **verifies the sha256 first** — a
> corrupt/half-downloaded backup is rejected before it can touch the DB.

### A. Same machine, DB corrupted / data lost
```bash
# pick the newest good backup (offline or from the synced/cloud folder)
node Backend/scripts/backup/restore.js \
     --file="E:\SphereBackups\nightly\sphere_20260621_0230.shbak.gz" \
     --confirm --drop --yes-overwrite
```
`--drop` = clean restore (drops each collection first; requires `--yes-overwrite`).
Omit `--drop` to **merge** — the backup version overwrites any matching `_id`.

### B. Brand-new / replacement machine (total loss)
1. Install **Node.js** and **MongoDB** (Community Server) on the new box.
2. Copy the SphereHealth `Backend` folder over (or `git clone`), run `npm install`.
3. Get the latest backup file — from your **cloud folder** (download it) or the
   **external/USB drive**. Copy both the `.shbak.gz` and its `.sha256`.
4. Make sure `Backend/.env` has `MONGO_URI` pointing at the new Mongo.
5. Restore:
   ```bash
   node Backend/scripts/backup/restore.js --file="<path>\sphere_YYYYMM.shbak.gz" --confirm --drop --yes-overwrite
   ```
6. Start the app (`npm start`) and spot-check a few patients / bills.

### C. Restore just one collection (e.g. you only lost `patients`)
```bash
node Backend/scripts/backup/restore.js --file="<path>" --confirm --only=patients
```

### D. Restore into a *different* DB first (safe dry-run before overwriting prod)
```bash
node Backend/scripts/backup/restore.js --file="<path>" --confirm --drop --yes-overwrite \
     --uri="mongodb://localhost:27017/spherehealth_test"
```

---

## 4. Monitoring — "is it actually working?"

- **`last-backup.json`** in the offline folder = the latest run's result
  (`ok`, size, doc count, sha256, timestamp). Wire an alert if `ok:false` or if
  its `at` is older than ~36 h.
- **`backup.log`** = full history.
- The **monthly restore-drill** is the real proof — it logs
  `restore drill PASSED ✓` only after actually restoring the backup and matching
  the doc count. If it ever fails, the run exits non-zero and the Scheduled Task
  shows a failure.

---

## 5. Recommended hardening (optional, off by default)
- Keep the **offline** copy on an external drive you rotate / take off-site.
- Encrypt the cloud folder side (e.g. Cryptomator over the synced folder) for PHI
  at rest in the cloud.
- Do a **manual recovery drill** quarterly: restore the latest backup into a test
  DB (section 3-D) and open the app against it.
- Verify any single file by hand:
  `node -e "require('./Backend/scripts/backup/restoreEngine').verifyChecksum('<file>').then(r=>console.log(r))"`

---

## 6. Files in this system
| File | Role |
|---|---|
| `backupEngine.js` | reads the DB → single full-fidelity `.shbak.gz` (+sha256) |
| `restoreEngine.js` | reads a `.shbak.gz` → restores collections + indexes |
| `runBackup.js` | orchestrator: offline+online copy, retention, monthly restore-drill |
| `restore.js` | operator restore CLI (safety-gated) |
| `setup-backup-tasks.ps1` | registers the nightly + monthly Windows Scheduled Tasks |
| `.env.backup.example` | config template |

> Note: the older `backupMongoDB.js` / `restoreMongoDB.js` rely on `mongodump`/
> `mongorestore`, which are **not installed** on this machine — that path is
> non-functional here. This R7hr-253 engine replaces it and needs nothing extra.

---

## 7. R7hr-254 hardening — what now FAILS LOUDLY (and why)

A backup audit found the first version could "look healthy while broken." These
guards now make it fail loudly instead of silently losing data:

- **Empty / wrong-DB backup is refused.** A run that produces fewer than
  `BACKUP_MIN_DOCS` (1) docs or `BACKUP_MIN_COLLS` (1) collections — or **>50%
  smaller** than the last good backup — aborts (exit 2, `last-backup.json` →
  `ok:false`) and **does not prune** the existing good copies. (A real bulk
  delete? set `BACKUP_ALLOW_SHRINK=1`.)
- **Prune only after the new backup is verified** (and, monthly, after the
  restore-drill passes). Retention can never delete the last good copy, and
  `KEEP=0/negative` is clamped to a safe floor.
- **The monthly restore-drill is real.** It restores into a **separate** DB and
  counts the docs **actually in that DB** (not numbers read from the file), and
  the drill **refuses to run** unless `BACKUP_VERIFY_URI` is a different,
  `drill`/`verify`-named DB — so a misconfig can never drop the live DB.
- **Off-site is mandatory.** A missing / dead-OneDrive `BACKUP_SYNCED_DIR` fails
  the run unless you explicitly accept offline-only (`BACKUP_ALLOW_OFFLINE_ONLY=1`).
- **Truncation is caught.** Every backup carries a footer + per-collection
  counts; restore (and the nightly check) **refuse a truncated archive** even
  if its sha256 matches. Override only with `restore.js --allow-partial`.
- **Restore is authoritative + safe.** A `--drop` clean restore now also needs
  `--yes-overwrite` (and prints the backup's age/contents first). A **merge**
  restore overwrites matching `_id`s with the backup version (no more silently
  keeping a stale/corrupt live doc).
- **Runs logged-off.** The Scheduled Tasks use an **S4U** principal, so backups
  run even when no one is logged in. (Caveat: the OneDrive client only *uploads*
  the file when the user is next logged in — the local copy is written
  immediately; `last-backup.json.online = "copied-pending-cloud-upload"`.)

### PHI at rest — encrypt the cloud side
Backups are **plaintext patient PHI** (gzip ≠ encryption). The synced folder
goes to a cloud account, so protect it:
1. **Simplest:** enable **BitLocker** on the backup drive, and use **OneDrive
   Personal Vault** (or **Cryptomator** over the synced folder) so the cloud
   copy is encrypted at rest. No key for the app to lose.
2. Restrict the `BACKUP_OFFLINE_DIR` ACLs to Admins + SYSTEM.
> App-level backup encryption is intentionally NOT enabled by default: a lost
> `BACKUP_ENCRYPTION_KEY` would make every backup unrecoverable — a worse
> data-loss risk for a hospital than the cloud-at-rest exposure, which the
> options above already close.
