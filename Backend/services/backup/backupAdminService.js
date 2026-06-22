// services/backup/backupAdminService.js
// R7hr-272 — thin admin layer over the R7hr-253/254 tool-free backup system so
// an Admin can see status / run a backup / download a backup FROM THE APP. It
// reuses the existing engine + orchestrator (scripts/backup/*) — no new backup
// logic. The destructive RESTORE is deliberately NOT exposed here (CLI-only).
"use strict";

const fs   = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const BACKUP_DIR_ROOT = path.join(__dirname, "..", "..", "scripts", "backup");
const RUN_SCRIPT      = path.join(BACKUP_DIR_ROOT, "runBackup.js");

// Mirror runBackup.js's directory resolution so we read the SAME locations.
function offlineDir() {
  return (
    process.env.BACKUP_OFFLINE_DIR ||
    (process.platform === "win32" ? "C:\\SphereBackups" : "/var/backups/sphere")
  );
}
function syncedDir() {
  return (
    process.env.BACKUP_SYNCED_DIR ||
    (process.env.OneDrive ? path.join(process.env.OneDrive, "SphereBackups") : "")
  );
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function listBackups(sub) {
  const dir = path.join(offlineDir(), sub);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.shbak\.gz$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, sub, sizeBytes: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

function getStatus() {
  const OFF = offlineDir();
  const SYN = syncedDir();
  const nightly = listBackups("nightly");
  const monthly = listBackups("monthly");
  return {
    offlineDir: OFF,
    syncedDir: SYN || null,
    offlineConfigured: !!process.env.BACKUP_OFFLINE_DIR,
    syncedConfigured: !!SYN,
    last: readJson(path.join(OFF, "last-backup.json")),
    nightly,
    monthly,
    totalFiles: nightly.length + monthly.length,
    running,
  };
}

let running = false;

// Run a backup now by spawning the existing orchestrator (full verify + retention
// + last-backup.json). If no off-site (cloud) dir is configured we allow an
// offline-only run so the button works out of the box; a configured user still
// gets the off-site copy.
function runBackupNow() {
  return new Promise((resolve) => {
    if (running) {
      return resolve({ ok: false, busy: true, message: "A backup is already running." });
    }
    if (!fs.existsSync(RUN_SCRIPT)) {
      return resolve({ ok: false, message: "Backup script not found on the server." });
    }
    running = true;
    const offlineOnly = !syncedDir();
    const env = { ...process.env };
    if (offlineOnly) env.BACKUP_ALLOW_OFFLINE_ONLY = "1";

    let out = "";
    const child = spawn(process.execPath, [RUN_SCRIPT, "--mode=nightly", "--verify"], {
      env,
      windowsHide: true,
    });
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { out += d.toString(); });

    const killTimer = setTimeout(() => {
      try { child.kill(); } catch { /* noop */ }
    }, 9 * 60 * 1000);

    child.on("close", (code) => {
      clearTimeout(killTimer);
      running = false;
      const status = readJson(path.join(offlineDir(), "last-backup.json"));
      const logTail = out.trim().split("\n").slice(-15).join("\n");
      resolve({ ok: code === 0, code, offlineOnly, logTail, status });
    });
    child.on("error", (e) => {
      clearTimeout(killTimer);
      running = false;
      resolve({ ok: false, code: -1, message: e.message });
    });
  });
}

// Resolve a download path with strict validation (no traversal). Only files that
// match the backup naming pattern AND live under the offline nightly/monthly
// dirs are downloadable.
function resolveDownload(filename) {
  if (typeof filename !== "string") return null;
  if (filename !== path.basename(filename)) return null;          // no slashes
  if (filename.includes("..")) return null;
  if (!/^sphere_[\w.-]+\.shbak\.gz$/.test(filename)) return null; // backup pattern only
  for (const sub of ["nightly", "monthly"]) {
    const p = path.join(offlineDir(), sub, filename);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

module.exports = { getStatus, runBackupNow, resolveDownload, offlineDir, syncedDir };
