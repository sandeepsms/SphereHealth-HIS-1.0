// scripts/backup/runBackup.js
// ════════════════════════════════════════════════════════════════════
// R7hr-253 — Backup orchestrator. The single entry point that Windows
// Task Scheduler (or cron) calls. It:
//   1. takes a full, tool-free backup (backupEngine) to an atomic temp
//      file, then renames it into place (no half-written file ever looks
//      valid);
//   2. verifies the on-disk OFFLINE copy against its sha256;
//   3. copies it to the ONLINE cloud-synced folder + verifies that too;
//   4. prunes old backups per retention policy;
//   5. on the MONTHLY run, performs a RESTORE DRILL — restores the backup
//      to a throwaway DB and checks the doc-count round-trips, so you know
//      the backup is actually recoverable, not just present;
//   6. writes last-backup.json + backup.log for monitoring.
//
// Modes:  --mode=nightly  (default)  |  --mode=monthly  |  --verify
// Exit:   0 = OK, 2 = failed (Task Scheduler / cron alerts on non-zero).
//
// Config (env, see .env.backup.example):
//   MONGO_URI              same value the app uses
//   BACKUP_OFFLINE_DIR     local/external-drive folder   (default C:\SphereBackups)
//   BACKUP_SYNCED_DIR      cloud-synced folder (OneDrive/Drive/Dropbox);
//                          auto-detects %OneDrive%\SphereBackups if unset
//   BACKUP_NIGHTLY_KEEP    nightly files to retain        (default 14)
//   BACKUP_MONTHLY_KEEP    monthly files to retain        (default 24)
//   BACKUP_VERIFY_URI      throwaway DB for the drill      (default …_verify_drill)
// ════════════════════════════════════════════════════════════════════
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const fs = require("fs");
const { backupDatabase } = require("./backupEngine");
const { verifyChecksum, restoreDatabase } = require("./restoreEngine");

const MONGO_URI     = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";
const OFFLINE       = process.env.BACKUP_OFFLINE_DIR || (process.platform === "win32" ? "C:\\SphereBackups" : "/var/backups/sphere");
const SYNCED        = process.env.BACKUP_SYNCED_DIR || (process.env.OneDrive ? path.join(process.env.OneDrive, "SphereBackups") : "");
const NIGHTLY_KEEP  = Number(process.env.BACKUP_NIGHTLY_KEEP || 14);
const MONTHLY_KEEP  = Number(process.env.BACKUP_MONTHLY_KEEP || 24);
const VERIFY_URI    = process.env.BACKUP_VERIFY_URI || "mongodb://localhost:27017/spherehealth_verify_drill";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt  = (n, d) => { const m = argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.split("=").slice(1).join("=") : d; };

const pad = (n) => String(n).padStart(2, "0");
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`; };
const ymStamp = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}`; };

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.mkdirSync(OFFLINE, { recursive: true }); fs.appendFileSync(path.join(OFFLINE, "backup.log"), line + "\n"); } catch (_) {}
}

function copyWithSidecar(srcFile, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(srcFile));
  fs.copyFileSync(srcFile, dest);
  fs.copyFileSync(srcFile + ".sha256", dest + ".sha256");
  return dest;
}

function prune(dir, keep) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".shbak.gz")).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    try {
      fs.unlinkSync(path.join(dir, f));
      if (fs.existsSync(path.join(dir, f + ".sha256"))) fs.unlinkSync(path.join(dir, f + ".sha256"));
      log(`pruned old backup ${f}`);
    } catch (_) {}
  }
}

(async () => {
  const mode = String(opt("mode", "nightly"));
  const isMonthly = mode === "monthly";
  const subdir = isMonthly ? "monthly" : "nightly";
  const name = isMonthly ? `sphere_${ymStamp()}.shbak.gz` : `sphere_${stamp()}.shbak.gz`;

  fs.mkdirSync(OFFLINE, { recursive: true });
  const offlineDir = path.join(OFFLINE, subdir);
  fs.mkdirSync(offlineDir, { recursive: true });
  const finalPath = path.join(offlineDir, name);
  const partial   = finalPath + ".partial";

  log(`=== ${mode.toUpperCase()} backup starting → ${finalPath} ===`);

  // 1) Backup to a .partial, then atomically rename into place.
  const res = await backupDatabase({ uri: MONGO_URI, outFile: partial, log });
  fs.renameSync(partial, finalPath);
  try { fs.unlinkSync(partial + ".sha256"); } catch (_) {}
  fs.writeFileSync(finalPath + ".sha256", `${res.sha256}  ${name}\n`);
  log(`OFFLINE copy written: ${finalPath} — ${(res.sizeBytes / 1048576).toFixed(2)} MB, ${res.totalDocs} docs`);

  // 2) Verify the on-disk offline copy.
  await verifyChecksum(finalPath);
  log("OFFLINE integrity verified ✓");

  // 3) ONLINE: copy to the cloud-synced folder + verify the copy.
  let syncedPath = null;
  if (SYNCED) {
    syncedPath = copyWithSidecar(finalPath, path.join(SYNCED, subdir));
    await verifyChecksum(syncedPath);
    log(`ONLINE (cloud-synced) copy written + verified: ${syncedPath}`);
  } else {
    log("WARNING: no ONLINE target — set BACKUP_SYNCED_DIR to a OneDrive/Drive/Dropbox folder. OFFLINE-only this run.");
  }

  // 4) Retention prune (both locations).
  prune(offlineDir, isMonthly ? MONTHLY_KEEP : NIGHTLY_KEEP);
  if (SYNCED) prune(path.join(SYNCED, subdir), isMonthly ? MONTHLY_KEEP : NIGHTLY_KEEP);

  // 5) Restore drill on monthly (or when --verify is passed): prove it's recoverable.
  if (isMonthly || flag("verify")) {
    log("restore drill: restoring into a throwaway DB to confirm recoverability…");
    const { MongoClient } = require("mongodb");
    const wipe = async () => { const c = new MongoClient(VERIFY_URI); await c.connect(); await c.db().dropDatabase().catch(() => {}); await c.close(); };
    await wipe();
    const r = await restoreDatabase({ uri: VERIFY_URI, inFile: finalPath, drop: true, log: () => {} });
    await wipe();
    if (r.totalDocs !== res.totalDocs) throw new Error(`restore drill mismatch — backup ${res.totalDocs} docs, restored ${r.totalDocs}`);
    log(`restore drill PASSED ✓ — ${r.totalDocs} docs round-tripped cleanly`);
  }

  // 6) Status file for monitoring / a dashboard widget.
  const status = { ok: true, mode, offline: finalPath, online: syncedPath, sizeBytes: res.sizeBytes, totalDocs: res.totalDocs, collections: res.collections.length, sha256: res.sha256, at: new Date().toISOString() };
  try { fs.writeFileSync(path.join(OFFLINE, "last-backup.json"), JSON.stringify(status, null, 2)); } catch (_) {}

  log(`=== ${mode.toUpperCase()} backup COMPLETE ===`);
  process.exit(0);
})().catch((e) => {
  log(`BACKUP FAILED: ${e.stack || e.message}`);
  try { fs.mkdirSync(OFFLINE, { recursive: true }); fs.writeFileSync(path.join(OFFLINE, "last-backup.json"), JSON.stringify({ ok: false, error: e.message, at: new Date().toISOString() }, null, 2)); } catch (_) {}
  process.exit(2);
});
