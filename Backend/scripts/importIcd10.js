// scripts/importIcd10.js
// R7hr(ICD-P1.1) — seed/refresh the ICD-10-CM master from the CMS codes
// file shipped in Backend/data (or any newer file you download).
//
//   node scripts/importIcd10.js                          # ship-with-repo FY2026 file
//   node scripts/importIcd10.js path\to\icd10cm-codes-2027.txt --version FY2027
//
// Yearly refresh: download the new "Code Descriptions" zip from
// ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/<year>/,
// point this script at the codes .txt (or import via the admin UI).

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const DEFAULT_FILE = path.join(__dirname, "..", "data", "icd10cm-codes-2026.txt.gz");

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

  const { importIcd10 } = require("../services/Clinical/icd10ImportService");
  const res = await importIcd10(fs.readFileSync(file), {
    version,
    source: path.basename(file),
    importedBy: "importIcd10.js (CLI)",
  });

  console.log(`✓ parsed ${res.parsed} | new ${res.upserted} | updated ${res.modified} | deactivated ${res.deactivated}`);
  console.log(`✓ active codes now: ${res.count} (${res.version})`);
  await mongoose.disconnect();
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
