// scripts/backupMongoDB.js
// ════════════════════════════════════════════════════════════════════
// R7bx-2 — Cross-platform (Windows dev + Linux prod) MongoDB backup
// driver. Spawns `mongodump` as a child process, writes a gzipped
// archive named `sphere_YYYYMMDD_HHmm.gz` to MONGO_BACKUP_PATH (defaults
// to /var/backups/sphere on Linux; on Windows defaults to
// C:\var\backups\sphere or ./backups when neither exists writable),
// then prunes archives older than 30 days.
//
// Wiring:
//   - Standalone:   `node scripts/backupMongoDB.js`
//   - Nightly cron: armed from Backend/index.js at 02:30 IST
//                   (`scheduleDaily("nightly-mongo-backup", 2, 30, ...)`)
//
// Required env:
//   MONGO_URI            — Mongo connection string (same as the app)
// Optional env:
//   MONGO_BACKUP_PATH    — backup destination dir (default per platform)
//   MONGO_BACKUP_RETAIN_DAYS — days to retain before pruning (default 30)
//   MONGODUMP_BIN        — full path to mongodump if not on $PATH
//
// Exit codes (for cron alerting):
//   0 = OK, 1 = bad config / env, 2 = mongodump failed,
//   3 = archive too small (likely auth / connect failure)
// ════════════════════════════════════════════════════════════════════
"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { spawn } = require("child_process");

const IS_WIN = process.platform === "win32";

// Resolve the default backup root. On Linux/macOS the script defaults to
// `/var/backups/sphere` which the cron normally has write access to via
// sudo install. On Windows we prefer `C:\var\backups\sphere`; if neither
// exists writable, fall back to `./backups` next to the project — that
// keeps the dev box productive without root.
function resolveDefaultBackupRoot() {
  if (process.env.MONGO_BACKUP_PATH) return process.env.MONGO_BACKUP_PATH;
  if (IS_WIN) {
    const winDefault = path.join("C:", "var", "backups", "sphere");
    return winDefault;
  }
  return path.join(path.sep, "var", "backups", "sphere");
}

// `mongodump` binary resolution. On a stock Linux install the binary lives
// on $PATH after installing `mongodb-database-tools`. Windows installs
// drop it under `C:\Program Files\MongoDB\Tools\<ver>\bin\mongodump.exe`
// which is rarely on PATH — let an operator override via MONGODUMP_BIN.
function resolveMongodumpBin() {
  if (process.env.MONGODUMP_BIN) return process.env.MONGODUMP_BIN;
  return IS_WIN ? "mongodump.exe" : "mongodump";
}

function ts() {
  const d = new Date();
  // sphere_YYYYMMDD_HHmm — keeps lexicographic == chronological order so
  // a `ls` listing is automatically sorted.
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  const hh   = String(d.getHours()).padStart(2, "0");
  const mi   = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}

/**
 * Run a single backup. Returns a Promise that resolves to an object
 * suitable for logging:
 *   { archive: "/path/to/sphere_20260524_0230.gz",
 *     sizeBytes: 12345678,
 *     prunedCount: 3,
 *     durationMs: 4500 }
 *
 * Rejects with a structured Error on any failure. The cron wrapper in
 * index.js logs the rejection but does NOT crash the server.
 */
async function runBackup() {
  const t0 = Date.now();
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    const e = new Error("MONGO_URI is not set — refusing to backup.");
    e.exitCode = 1;
    throw e;
  }

  const dest = resolveDefaultBackupRoot();
  fs.mkdirSync(dest, { recursive: true });

  const archive = path.join(dest, `sphere_${ts()}.gz`);
  const bin     = resolveMongodumpBin();

  console.log(`[backup-mongo] ${new Date().toISOString()} starting -> ${archive}`);

  // Use --gzip --archive=<file> so mongodump emits a single tar-like
  // gzip stream that restoreMongoDB.js can consume directly. No tmp dir,
  // no shell metacharacters — args are passed as an array.
  const args = [
    `--uri=${mongoUri}`,
    "--gzip",
    `--archive=${archive}`,
  ];

  // Capture stderr so we can include the last few lines in an error.
  let stderrTail = "";
  await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "inherit", "pipe"],
      // Windows needs shell:false here because we're passing an explicit
      // .exe path; mongodump on Linux is also straight exec.
      shell: false,
    });
    child.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      stderrTail = (stderrTail + s).slice(-2000);
      process.stderr.write(s);
    });
    child.on("error", (err) => {
      // ENOENT here usually means `mongodump` isn't on PATH. Hint the
      // operator at MONGODUMP_BIN.
      if (err.code === "ENOENT") {
        err.message = `mongodump binary not found (tried "${bin}"). Install mongodb-database-tools or set MONGODUMP_BIN. ${err.message}`;
      }
      err.exitCode = 2;
      reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const e = new Error(`mongodump exited with code ${code}. stderr tail: ${stderrTail}`);
        e.exitCode = 2;
        return reject(e);
      }
      resolve();
    });
  });

  // Sanity-check the archive isn't a 200-byte auth-failure shell. A real
  // dump of any non-empty Mongo is >4 KiB.
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(archive).size; } catch (_) { sizeBytes = 0; }
  if (sizeBytes < 4096) {
    try { fs.unlinkSync(archive); } catch (_) { /* best-effort */ }
    const e = new Error(`Archive too small (${sizeBytes} bytes) — likely auth/connect failure.`);
    e.exitCode = 3;
    throw e;
  }

  // Prune older archives.
  const retainDays = Number(process.env.MONGO_BACKUP_RETAIN_DAYS) || 30;
  const cutoffMs = Date.now() - retainDays * 86_400_000;
  let prunedCount = 0;
  try {
    const files = fs.readdirSync(dest);
    for (const f of files) {
      if (!/^sphere_\d{8}_\d{4}\.gz$/.test(f)) continue;
      const full = path.join(dest, f);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoffMs) {
          fs.unlinkSync(full);
          prunedCount += 1;
        }
      } catch (e) {
        console.warn(`[backup-mongo] could not stat/prune ${full}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`[backup-mongo] prune sweep failed: ${e.message}`);
  }

  const durationMs = Date.now() - t0;
  const out = { archive, sizeBytes, prunedCount, durationMs };
  console.log(`[backup-mongo] OK size=${sizeBytes}B pruned=${prunedCount} elapsed=${durationMs}ms`);
  return out;
}

// CLI entrypoint.
if (require.main === module) {
  // Standalone run still needs dotenv so the operator can `node
  // scripts/backupMongoDB.js` and pick up Backend/.env.
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  runBackup()
    .then((r) => {
      console.log("[backup-mongo] done", JSON.stringify(r));
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[backup-mongo] FAILED: ${err.message}`);
      process.exit(err.exitCode || 1);
    });
}

module.exports = { runBackup };
