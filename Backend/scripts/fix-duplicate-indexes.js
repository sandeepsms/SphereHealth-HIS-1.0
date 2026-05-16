/*
 * For each (file, field) pair listed in DUPLICATES, find:
 *   <field>: { ..., index: true, ... }
 * and remove the `index: true` so only the explicit Schema.index()
 * call remains. The explicit calls are either compound indexes or
 * carry extra options (unique/sparse), which are strictly more
 * powerful than the inline shortcut.
 */
const fs = require("fs");
const path = require("path");

const DUPLICATES = {
  "models/Billing/BillingTrigger.js":         ["admissionId", "status"],
  "models/Clinical/ConsentFormModel.js":      ["UHID", "admissionId", "status"],
  "models/Clinical/DischargeSummaryModel.js": ["UHID", "admissionId", "status"],
  "models/Clinical/MARModel.js":              ["UHID", "admissionId", "ipdNo"],
  "models/Doctor/DoctorNotesModel.js":        ["ipdNo"],
  "models/Doctor/DoctorOrderModel.js":        ["UHID", "status"],
  "models/Nurse/NurseNotesModel.js":          ["ipdNo"],
  "models/Nurse/NursingCarePlanModel.js":     ["UHID", "admissionId", "status", "ipdNo"],
  "models/nursing/NursingChargeEntry.js":     ["admissionId"],
  "models/Patient/admissionModel.js":         ["patientId", "UHID"],
  "models/Patient/bedTransferModel.js":       ["status"],
  "models/PatientBillModel/PatientBillModel.js": ["UHID"],
};

const root = path.join(__dirname, "..");
let totalRemoved = 0;

for (const [relPath, fields] of Object.entries(DUPLICATES)) {
  const file = path.join(root, relPath);
  if (!fs.existsSync(file)) { console.log("SKIP missing:", relPath); continue; }
  let src = fs.readFileSync(file, "utf8");
  let removed = 0;

  for (const fld of fields) {
    // Match the inline field def. The schema syntax is one of:
    //   field: { type: ..., index: true }
    //   field: { type: ..., index: true, required: ... }
    //   field: { ..., index: true,
    //            ... }
    // We just find ", index: true" or "{ index: true," etc. on the
    // line(s) inside the curly-braced object that starts with `field:`.
    //
    // Use a per-field scoped block extraction.
    const re = new RegExp(`(\\b${fld}\\s*:\\s*\\{[^}]*?)\\bindex\\s*:\\s*true\\s*,?`, "s");
    const before = src;
    src = src.replace(re, (m, prefix) => {
      // Clean up: if the prefix ends with `, ` we leave it (next prop follows).
      // If the next char after removal is `}`, we may have a trailing comma to strip.
      return prefix;
    });
    if (src !== before) {
      removed++;
      // Clean up any double-comma or trailing-comma-before-} introduced
      src = src.replace(/,\s*,/g, ",").replace(/,\s*\}/g, " }");
    }
  }

  if (removed > 0) {
    fs.writeFileSync(file, src, "utf8");
    totalRemoved += removed;
    console.log(`${relPath}: removed ${removed} duplicate(s)`);
  }
}
console.log(`\nTOTAL: ${totalRemoved} duplicate inline index:true declarations removed`);
