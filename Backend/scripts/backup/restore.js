// scripts/backup/restore.js
// ════════════════════════════════════════════════════════════════════
// R7hr-254 — Operator RESTORE CLI (tool-free). DESTRUCTIVE; refuses
// without --file AND a hand-typed --confirm. The .sha256 + footer are
// verified before any write. A clean --drop restore additionally requires
// --yes-overwrite, and prints the backup's age + size so you can't wipe
// live data with a wrong/stale file by accident.
//
//   node scripts/backup/restore.js --file=<x.shbak.gz> --confirm [--drop --yes-overwrite]
//        [--uri=mongodb://...] [--only=patients,admissions] [--allow-partial]
//
//   --drop          drop+recreate each collection (clean cold-recovery)
//   (no --drop)     MERGE: the backup version is authoritative (overwrites
//                   any existing _id), additive for new docs.
//   --allow-partial proceed even if the archive is truncated (NOT default)
// ════════════════════════════════════════════════════════════════════
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { restoreDatabase, validateBackupFile } = require("./restoreEngine");

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt  = (n, d) => { const m = argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.split("=").slice(1).join("=") : d; };

const USAGE = `
SphereHealth restore — DESTRUCTIVE. Refusing without --file and --confirm.

  node scripts/backup/restore.js --file=<path.shbak.gz> --confirm [options]

  --file=<path>     backup archive to restore (.shbak.gz)
  --confirm         required acknowledgement (type by hand)
  --drop            DROP + recreate each collection (clean cold-recovery).
                    Also requires --yes-overwrite. WITHOUT --drop = MERGE
                    (backup is authoritative, overwrites matching _ids).
  --yes-overwrite   second confirmation, required with --drop
  --uri=<uri>       target DB (default = MONGO_URI from Backend/.env)
  --only=a,b        restore only these collections
  --allow-partial   proceed even if the archive is truncated (default: refuse)

The .sha256 sidecar AND the footer/per-collection counts are verified before any
write — a corrupt or truncated backup is refused.
`;

(async () => {
  const file   = opt("file");
  const target = opt("uri", process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth");
  const drop   = flag("drop");
  const only   = opt("only") ? opt("only").split(",").map((s) => s.trim()).filter(Boolean) : null;

  if (!file || !flag("confirm")) { console.error(USAGE); process.exit(1); }
  if (drop && !flag("yes-overwrite")) {
    console.error("\n--drop will WIPE each collection before restoring. Re-run with --yes-overwrite once you're sure this is the right backup.\n");
    process.exit(1);
  }

  // Show what's in the file BEFORE touching the DB (right/newest file check).
  const info = await validateBackupFile(file);
  console.log(`Backup file : ${file}`);
  console.log(`  footer    : ${info.footerSeen ? "present" : "MISSING (truncated!)"}`);
  console.log(`  contents  : ${info.collections.length} collections, ${info.totalDocs} docs`);
  if (info.mismatches.length && !flag("allow-partial")) {
    console.error(`\nThis backup is INCOMPLETE/truncated:\n  ${info.mismatches.join("\n  ")}\nRefusing. Pass --allow-partial to force a partial restore.\n`);
    process.exit(2);
  }
  const masked = String(target).replace(/\/\/[^@]*@/, "//***:***@");
  console.log(`  target    : ${masked}`);
  console.log(`  mode      : ${drop ? "DROP + restore (clean)" : "MERGE (authoritative)"}${only ? ` · only [${only.join(", ")}]` : ""}\n`);

  const r = await restoreDatabase({ uri: target, inFile: file, drop, only, allowPartial: flag("allow-partial"), log: (m) => console.log(m) });
  console.log(`\nRESTORE COMPLETE — ${r.totalApplied} docs applied across ${r.restored.length} collections.`);
  if (r.indexErrors.length) console.warn(`⚠ ${r.indexErrors.length} index(es) could not be rebuilt: ${r.indexErrors.map((e) => `${e.collection} (${e.error})`).join("; ")}`);
  process.exit(0);
})().catch((e) => { console.error("RESTORE FAILED:", e.message); process.exit(2); });
