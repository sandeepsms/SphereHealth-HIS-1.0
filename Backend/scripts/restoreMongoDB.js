// scripts/restoreMongoDB.js
// ════════════════════════════════════════════════════════════════════
// R7bx-2 — Companion to backupMongoDB.js. Restores a gzipped archive
// produced by `mongorestore --gzip --archive=<file>`.
//
// SAFETY:
//   This script is destructive — it can wipe production data. To
//   prevent an accidental run it REFUSES TO PROCEED unless BOTH:
//     --file=<path>     — explicit archive to restore
//     --confirm         — bare flag the operator must type by hand
//
// Default behaviour is "merge" — `mongorestore` will NOT drop existing
// collections unless you also pass `--drop` (which the operator must
// explicitly opt into via `--drop`). This protects against the common
// "I just wanted to restore one collection" foot-gun.
//
// Usage:
//   node scripts/restoreMongoDB.js \
//        --file=/var/backups/sphere/sphere_20260524_0230.gz \
//        --confirm
//
//   # full DB wipe + restore (cold-recovery only — make a fresh backup
//   # first):
//   node scripts/restoreMongoDB.js \
//        --file=/var/backups/sphere/sphere_20260524_0230.gz \
//        --confirm --drop
//
// Exit codes:
//   0 = OK, 1 = bad args / refused, 2 = restore failed
// ════════════════════════════════════════════════════════════════════
"use strict";

const fs   = require("fs");
const path = require("path");
const { spawn } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const IS_WIN = process.platform === "win32";

function resolveMongorestoreBin() {
  if (process.env.MONGORESTORE_BIN) return process.env.MONGORESTORE_BIN;
  return IS_WIN ? "mongorestore.exe" : "mongorestore";
}

function parseArgs(argv) {
  const out = { file: null, confirm: false, drop: false, _unknown: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--file=")) {
      out.file = a.slice("--file=".length);
    } else if (a === "--confirm") {
      out.confirm = true;
    } else if (a === "--drop") {
      out.drop = true;
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    } else {
      out._unknown.push(a);
    }
  }
  return out;
}

function usage() {
  console.log(
    "Usage: node scripts/restoreMongoDB.js --file=<path> --confirm [--drop]\n" +
      "\n" +
      "Required:\n" +
      "  --file=<path>   Gzipped archive previously produced by backupMongoDB.js.\n" +
      "  --confirm       Explicit acknowledgement that this run will mutate the DB.\n" +
      "\n" +
      "Optional:\n" +
      "  --drop          Drop each collection before restore (full cold-recovery).\n" +
      "\n" +
      "Env:\n" +
      "  MONGO_URI       Same connection string the app uses.\n" +
      "  MONGORESTORE_BIN  Path to mongorestore if not on $PATH.\n",
  );
}

async function runRestore() {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); process.exit(0); }

  const errs = [];
  if (!args.file)    errs.push("missing --file=<path>");
  if (!args.confirm) errs.push("missing --confirm (refusing destructive run)");
  if (errs.length) {
    console.error("[restore-mongo] REFUSED:\n  - " + errs.join("\n  - "));
    usage();
    process.exit(1);
  }
  if (!fs.existsSync(args.file)) {
    console.error(`[restore-mongo] file not found: ${args.file}`);
    process.exit(1);
  }
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("[restore-mongo] MONGO_URI is not set");
    process.exit(1);
  }

  const bin = resolveMongorestoreBin();
  const restoreArgs = [
    `--uri=${mongoUri}`,
    "--gzip",
    `--archive=${args.file}`,
  ];
  if (args.drop) restoreArgs.push("--drop");

  console.log(`[restore-mongo] ${new Date().toISOString()} restoring ${args.file}${args.drop ? " (--drop)" : ""}`);

  await new Promise((resolve, reject) => {
    const child = spawn(bin, restoreArgs, {
      stdio: ["ignore", "inherit", "inherit"],
      shell: false,
    });
    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        err.message = `mongorestore binary not found (tried "${bin}"). Install mongodb-database-tools or set MONGORESTORE_BIN. ${err.message}`;
      }
      reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const e = new Error(`mongorestore exited with code ${code}`);
        e.exitCode = 2;
        return reject(e);
      }
      resolve();
    });
  });

  console.log("[restore-mongo] OK");
}

if (require.main === module) {
  runRestore().catch((err) => {
    console.error(`[restore-mongo] FAILED: ${err.message}`);
    process.exit(err.exitCode || 2);
  });
}

module.exports = { runRestore };
