// scripts/backup/runBackup.js
// ════════════════════════════════════════════════════════════════════
// R7hr-254 — Hardened backup orchestrator (the scheduled entry point).
// Closes the 10-dim backup-audit findings so the system fails LOUDLY
// instead of looking healthy while broken:
//
//   • CONTENT FLOOR — a 0-doc / wrong-DB / shrunk backup aborts BEFORE
//     anything is archived or pruned (an empty backup can never win).
//   • PRUNE ONLY AFTER VALIDATION — the new backup must verify (and, on
//     monthly, pass a real restore-drill) before any old copy is deleted.
//   • RETENTION CLAMP — KEEP can never be 0/negative/NaN (no mass wipe).
//   • OFF-SITE IS MANDATORY — a missing ONLINE target is a hard failure
//     unless BACKUP_ALLOW_OFFLINE_ONLY=1 is explicitly set.
//   • DRILL CAN'T HIT THE LIVE DB — BACKUP_VERIFY_URI must be a different,
//     drill-named DB; the drill compares ACTUAL doc counts in the restored
//     DB (not file-read counts) and cleans up its PHI in finally.
//   • SINGLE-INSTANCE LOCK — overlapping runs can't race.
//
// Modes:  --mode=nightly (default) | --mode=monthly | --verify
// Exit:   0 = OK, 2 = failed (Scheduler/cron alerts on non-zero).
// ════════════════════════════════════════════════════════════════════
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const fs = require("fs");
const { backupDatabase } = require("./backupEngine");
const { verifyChecksum, validateBackupFile, restoreDatabase } = require("./restoreEngine");

const MONGO_URI    = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";
const OFFLINE      = process.env.BACKUP_OFFLINE_DIR || (process.platform === "win32" ? "C:\\SphereBackups" : "/var/backups/sphere");
const SYNCED       = process.env.BACKUP_SYNCED_DIR || (process.env.OneDrive ? path.join(process.env.OneDrive, "SphereBackups") : "");
const VERIFY_URI   = process.env.BACKUP_VERIFY_URI || "mongodb://localhost:27017/spherehealth_verify_drill";
const MIN_DOCS     = Math.max(0, Number(process.env.BACKUP_MIN_DOCS)  || 1);
const MIN_COLLS    = Math.max(0, Number(process.env.BACKUP_MIN_COLLS) || 1);
const ALLOW_OFFLINE_ONLY = process.env.BACKUP_ALLOW_OFFLINE_ONLY === "1";
const ALLOW_SHRINK = process.env.BACKUP_ALLOW_SHRINK === "1";

function clampKeep(env, def) { const k = Number(String(env ?? "").trim()); return (Number.isInteger(k) && k >= 1) ? k : def; }
const NIGHTLY_KEEP = clampKeep(process.env.BACKUP_NIGHTLY_KEEP, 14);
const MONTHLY_KEEP = clampKeep(process.env.BACKUP_MONTHLY_KEEP, 24);

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt  = (n, d) => { const m = argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.split("=").slice(1).join("=") : d; };

const pad = (n) => String(n).padStart(2, "0");
const stamp   = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`; };
const ymStamp = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}`; };

function dbNameOf(uri) {
  try { const u = new URL(uri); return (u.pathname || "").replace(/^\//, "").split("/")[0] || ""; }
  catch { const m = String(uri).match(/\/\/[^/]+\/([^?]+)/); return m ? m[1] : ""; }
}
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.mkdirSync(OFFLINE, { recursive: true }); fs.appendFileSync(path.join(OFFLINE, "backup.log"), line + "\n"); } catch (_) {}
}
function copyAtomic(srcFile, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(srcFile));
  fs.copyFileSync(srcFile, dest + ".part");
  fs.renameSync(dest + ".part", dest);            // atomic in-place
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
function cleanStaleArtifacts(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".partial") || f.endsWith(".part")) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} }
  }
}

// ── single-instance lock (steal if a crashed run left a >6h-old lock) ──
fs.mkdirSync(OFFLINE, { recursive: true });
const LOCK = path.join(OFFLINE, ".backup.lock");
let lockFd = null;
function acquireLock() {
  try { lockFd = fs.openSync(LOCK, "wx"); fs.writeSync(lockFd, `${process.pid} ${new Date().toISOString()}\n`); return true; }
  catch (e) {
    if (e.code !== "EEXIST") throw e;
    try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 6 * 3600 * 1000) { fs.unlinkSync(LOCK); return acquireLock(); } } catch (_) {}
    return false;
  }
}
function releaseLock() { try { if (lockFd != null) fs.closeSync(lockFd); fs.unlinkSync(LOCK); } catch (_) {} }

async function run(opts = {}) {
  if (!acquireLock()) { log("another backup run is in progress (lock held) — skipping this run."); return { ok: true, skipped: "lock-held" }; }

  try {
  const mode = String(opts.mode || opt("mode", "nightly"));
  const isMonthly = mode === "monthly";
  const subdir = isMonthly ? "monthly" : "nightly";
  const name = isMonthly ? `sphere_${ymStamp()}.shbak.gz` : `sphere_${stamp()}.shbak.gz`;

  const offlineDir = path.join(OFFLINE, subdir);
  fs.mkdirSync(offlineDir, { recursive: true });
  cleanStaleArtifacts(offlineDir);
  const finalPath = path.join(offlineDir, name);
  const partial   = finalPath + ".partial";

  log(`=== ${mode.toUpperCase()} backup starting → ${finalPath} ===`);

  // 1) Backup to a .partial.
  let res;
  try {
    res = await backupDatabase({ uri: MONGO_URI, outFile: partial, log });
  } catch (e) { try { fs.unlinkSync(partial); fs.unlinkSync(partial + ".sha256"); } catch (_) {} throw e; }

  // 2) CONTENT FLOOR — never archive/prune behind a too-small or shrunk backup.
  const prev = readJson(path.join(OFFLINE, "last-backup.json"));
  const cleanup = () => { try { fs.unlinkSync(partial); fs.unlinkSync(partial + ".sha256"); } catch (_) {} };
  if (res.totalDocs < MIN_DOCS || res.collections.length < MIN_COLLS) {
    cleanup();
    throw new Error(`backup too small (${res.totalDocs} docs, ${res.collections.length} collections, floor ${MIN_DOCS}/${MIN_COLLS}) — likely wrong DB / auth failure. NOT archiving or pruning.`);
  }
  // R9-FIX(R9-103): read the last-GOOD doc count from either a successful prior
  // status (prev.ok) OR the preserved lastGoodTotalDocs carried on a failure
  // status. Pre-fix, a single failed run overwrote last-backup.json with a bare
  // {ok:false} (no totalDocs), so this guard saw prev.ok=false, skipped, and the
  // NEXT run could archive+prune a gutted backup unchecked.
  const _shrinkBaseline = prev ? (prev.ok ? prev.totalDocs : prev.lastGoodTotalDocs) : null;
  if (!ALLOW_SHRINK && _shrinkBaseline && res.totalDocs < _shrinkBaseline * 0.5) {
    cleanup();
    throw new Error(`backup has ${res.totalDocs} docs vs last good ${_shrinkBaseline} (>50% drop) — refusing to archive/prune. Set BACKUP_ALLOW_SHRINK=1 if this drop is real.`);
  }

  // 3) Atomic rename into place + sidecar; verify the on-disk OFFLINE copy
  //    (checksum + footer + per-collection completeness — catches truncation).
  fs.renameSync(partial, finalPath);
  try { fs.unlinkSync(partial + ".sha256"); } catch (_) {}
  fs.writeFileSync(finalPath + ".sha256", `${res.sha256}  ${name}\n`);
  const v = await validateBackupFile(finalPath);
  if (v.mismatches.length) throw new Error(`OFFLINE copy failed validation:\n  ${v.mismatches.join("\n  ")}`);
  log(`OFFLINE copy verified ✓ — ${(res.sizeBytes / 1048576).toFixed(2)} MB, ${res.totalDocs} docs, footer OK`);

  // 4) ONLINE (cloud-synced) copy — MANDATORY unless explicitly opted out.
  let onlineState = "skipped";
  if (SYNCED) {
    // Verify the CLOUD ROOT (parent of the SphereBackups folder) exists — that
    // catches a dead/unlinked OneDrive path — while still letting us create the
    // SphereBackups subfolder itself on first run.
    const syncedRoot = path.dirname(SYNCED);
    if (!fs.existsSync(syncedRoot)) {
      if (!ALLOW_OFFLINE_ONLY) throw new Error(`BACKUP_SYNCED_DIR root "${syncedRoot}" does not exist — the cloud-synced location looks dead/wrong, so the ONLINE/off-site copy would be lost. Fix the path or set BACKUP_ALLOW_OFFLINE_ONLY=1.`);
      log(`WARNING: synced root missing — OFFLINE-only (opt-out set).`);
    } else {
      const syncedPath = copyAtomic(finalPath, path.join(SYNCED, subdir));
      await verifyChecksum(syncedPath);
      onlineState = "copied-pending-cloud-upload"; // local bytes confirmed; cloud upload is the sync client's job
      log(`ONLINE copy written + locally verified: ${syncedPath} (cloud upload now handled by the sync client)`);
    }
  } else if (!ALLOW_OFFLINE_ONLY) {
    throw new Error("No ONLINE target — set BACKUP_SYNCED_DIR to a OneDrive/Drive/Dropbox folder, or set BACKUP_ALLOW_OFFLINE_ONLY=1 to accept OFFLINE-only (NOT recommended for DR).");
  } else {
    log("WARNING: OFFLINE-only run (BACKUP_ALLOW_OFFLINE_ONLY=1) — no off-site copy exists.");
  }

  // 5) MONTHLY: real restore-drill — restore into a SEPARATE drill DB and
  //    confirm the ACTUAL doc count in the restored DB (not file-read counts).
  if (isMonthly || (opts.verify != null ? !!opts.verify : flag("verify"))) {
    const liveDb = dbNameOf(MONGO_URI), drillDb = dbNameOf(VERIFY_URI);
    if (!drillDb || drillDb === liveDb || !/drill|verify/i.test(drillDb)) {
      throw new Error(`UNSAFE restore-drill target — BACKUP_VERIFY_URI db "${drillDb}" must differ from the live DB "${liveDb}" and contain "drill"/"verify". Refusing to wipe.`);
    }
    log(`restore drill: restoring into "${drillDb}" and counting the restored docs…`);
    const { MongoClient } = require("mongodb");
    const wipe = async () => { const c = new MongoClient(VERIFY_URI); await c.connect(); await c.db().dropDatabase().catch(() => {}); await c.close(); };
    try {
      await wipe();
      const r = await restoreDatabase({ uri: VERIFY_URI, inFile: finalPath, drop: true, log: () => {} });
      const c = new MongoClient(VERIFY_URI); await c.connect();
      const colls = (await c.db().listCollections().toArray()).filter((x) => x.type === "collection" && !x.name.startsWith("system."));
      let actual = 0; for (const cc of colls) actual += await c.db().collection(cc.name).countDocuments();
      await c.close();
      if (actual !== res.totalDocs) throw new Error(`restore-drill MISMATCH — backup ${res.totalDocs} docs, restored DB holds ${actual}`);
      if (r.indexErrors.length) throw new Error(`restore-drill — ${r.indexErrors.length} index(es) failed to rebuild: ${r.indexErrors.map((e) => e.collection).join(", ")}`);
      log(`restore drill PASSED ✓ — ${actual} docs verified IN the restored DB`);
    } finally { await wipe(); } // never leave PHI in the drill DB
  }

  // 6) Retention prune — ONLY now that the new backup is verified (and drilled).
  prune(offlineDir, isMonthly ? MONTHLY_KEEP : NIGHTLY_KEEP);
  if (SYNCED && onlineState !== "skipped") prune(path.join(SYNCED, subdir), isMonthly ? MONTHLY_KEEP : NIGHTLY_KEEP);

  // 7) Status for monitoring.
  const status = { ok: true, mode, offline: finalPath, online: onlineState, sizeBytes: res.sizeBytes, totalDocs: res.totalDocs, collections: res.collections.length, sha256: res.sha256, at: new Date().toISOString() };
  try { fs.writeFileSync(path.join(OFFLINE, "last-backup.json"), JSON.stringify(status, null, 2)); } catch (_) {}

  log(`=== ${mode.toUpperCase()} backup COMPLETE ===`);
  return status;
  } catch (e) {
    log(`BACKUP FAILED: ${e.stack || e.message}`);
    // R9-FIX(R9-103): preserve the last-GOOD doc-count baseline through a
    // failure so the >50%-shrink guard stays armed on the next run.
    try {
      fs.mkdirSync(OFFLINE, { recursive: true });
      const _p = readJson(path.join(OFFLINE, "last-backup.json"));
      const _lastGoodDocs = _p ? (_p.ok ? _p.totalDocs : _p.lastGoodTotalDocs) : null;
      const _lastGoodAt   = _p ? (_p.ok ? _p.at        : _p.lastGoodAt)        : null;
      fs.writeFileSync(path.join(OFFLINE, "last-backup.json"), JSON.stringify({ ok: false, error: e.message, at: new Date().toISOString(), lastGoodTotalDocs: _lastGoodDocs ?? null, lastGoodAt: _lastGoodAt ?? null }, null, 2));
    } catch (_) {}
    throw e;
  } finally {
    releaseLock();
  }
}

// CLI entry point — preserves the standalone / PowerShell-scheduled behaviour
// (`node runBackup.js --mode=nightly|--mode=monthly|--verify`): exit 0 on
// success, exit 2 on failure so Task Scheduler / an OS cron alerts on non-zero.
if (require.main === module) {
  run().then(() => process.exit(0)).catch(() => process.exit(2));
}

module.exports = { run };
