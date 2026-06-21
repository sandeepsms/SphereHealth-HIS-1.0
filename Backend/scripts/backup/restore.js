// scripts/backup/restore.js
// ════════════════════════════════════════════════════════════════════
// R7hr-253 — Operator-facing RESTORE command (tool-free). DESTRUCTIVE,
// so it refuses to run without an explicit --file AND a hand-typed
// --confirm. The backup's .sha256 is verified before any write.
//
//   node scripts/backup/restore.js --file=<x.shbak.gz> --confirm [--drop]
//        [--uri=mongodb://...] [--only=patients,admissions]
//
//   --drop  : drop each collection first (clean cold-recovery)
//   (no --drop) : MERGE — additive, keeps existing docs
// ════════════════════════════════════════════════════════════════════
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { restoreDatabase } = require("./restoreEngine");

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt  = (n, d) => { const m = argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.split("=").slice(1).join("=") : d; };

const USAGE = `
SphereHealth restore — DESTRUCTIVE. Refusing without an explicit --file and --confirm.

  node scripts/backup/restore.js --file=<path.shbak.gz> --confirm [options]

  --file=<path>   backup archive to restore (.shbak.gz)
  --confirm       required acknowledgement (type it by hand)
  --drop          drop each collection before restoring (clean cold-recovery).
                  WITHOUT --drop the restore MERGES (additive).
  --uri=<uri>     target DB (default = MONGO_URI from Backend/.env)
  --only=a,b      restore only these collections (comma-separated)

The .sha256 sidecar is verified before any write — a corrupt/truncated backup is refused.
`;

(async () => {
  const file   = opt("file");
  const target = opt("uri", process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth");
  const drop   = flag("drop");
  const only   = opt("only") ? opt("only").split(",").map((s) => s.trim()).filter(Boolean) : null;

  if (!file || !flag("confirm")) { console.error(USAGE); process.exit(1); }

  const masked = String(target).replace(/\/\/[^@]*@/, "//***:***@");
  console.log(`Restoring: ${file}`);
  console.log(`  target : ${masked}`);
  console.log(`  mode   : ${drop ? "DROP + restore (clean)" : "MERGE (additive)"}${only ? ` · only [${only.join(", ")}]` : ""}\n`);

  const r = await restoreDatabase({ uri: target, inFile: file, drop, only, log: (m) => console.log(m) });
  console.log(`\nRESTORE COMPLETE — ${r.totalDocs} docs into ${r.restored.length} collections.`);
  process.exit(0);
})().catch((e) => { console.error("RESTORE FAILED:", e.message); process.exit(2); });
