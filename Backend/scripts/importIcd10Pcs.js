// scripts/importIcd10Pcs.js
// R7hr(PCS-P1) — seed/refresh the ICD-10-PCS procedure master from the
// codes file shipped in Backend/data (or any newer file you download).
//
//   node scripts/importIcd10Pcs.js                            # ship-with-repo FY2026 file
//   node scripts/importIcd10Pcs.js path\to\icd10pcs-codes-2027.txt --version FY2027
//
// Yearly refresh: download the new "ICD-10-PCS Codes File" zip from
// cms.gov/medicare/coding-billing/icd-10-codes, point this script at the
// codes .txt (or import via POST /api/icd10/pcs/import).

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const DEFAULT_FILE = path.join(__dirname, "..", "data", "icd10pcs-codes-2026.txt.gz");

(async () => {
  const args = process.argv.slice(2);
  const vIdx = args.indexOf("--version");
  const version = vIdx !== -1 ? args[vIdx + 1] : "FY2026";
  const file = args.find((a) => !a.startsWith("--") && a !== version) || DEFAULT_FILE;

  if (!fs.existsSync(file)) {
    console.error(`✗ File not found: ${file}`);
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Importing ${path.basename(file)} as ${version} …`);

  const { importIcd10Pcs } = require("../services/Clinical/icd10PcsImportService");
  const res = await importIcd10Pcs(fs.readFileSync(file), {
    version,
    source: path.basename(file),
    importedBy: "importIcd10Pcs.js (CLI)",
  });

  console.log(`✓ parsed ${res.parsed} | new ${res.upserted} | updated ${res.modified} | deactivated ${res.deactivated}`);
  console.log(`✓ active codes now: ${res.count} (${res.version})`);
  await mongoose.disconnect();
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
