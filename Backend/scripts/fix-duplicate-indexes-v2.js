/*
 * Second pass: fields declared with `unique: true` (which already
 * creates a unique index) AND a separate `Schema.index({ field: 1 })`
 * call. Remove the redundant explicit Schema.index() call.
 */
const fs = require("fs");
const path = require("path");

const FIXES = [
  ["models/bedMgmt/roomCategoryModel.js",            "categoryCode"],
  ["models/Department/department.js",                "departmentCode"],
  ["models/Doctor/doctorModel.js",                   "doctorId"],
  ["models/Investigation/InvestigationMasterModel.js","investigationCode"],
  ["models/Investigation/InvestigationOrderModel.js","orderNumber"],
  ["models/Nurse/NurseStaffModel.js",                "staffId"],
  ["models/Patient/emergencyModel.js",               "emergencyNumber"],
  ["models/Patient/OPDModels.js",                    "visitNumber"],
  ["models/ServiceMaster/serviceMasterModel.js",     "serviceCode"],
  ["models/tpa/tpaModel.js",                         "tpaCode"],
  ["models/User/userModel.js",                       "employeeId"],
  ["models/User/userModel.js",                       "email"],
];

const root = path.join(__dirname, "..");
let total = 0;

for (const [rel, fld] of FIXES) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) { console.log("SKIP missing:", rel); continue; }
  let src = fs.readFileSync(file, "utf8");

  // Pattern 1: Schema.index({ field: 1 });  (single-field on its own line)
  const reSimple = new RegExp(
    `^[A-Za-z_]+Schema\\.index\\(\\s*\\{\\s*${fld}\\s*:\\s*1\\s*\\}\\s*\\)\\s*;\\s*\\n`,
    "m"
  );
  // Pattern 2: with options like { unique: true } — keep if unique is the option,
  // since `unique: true` on the inline def already creates a unique index.
  const reWithOpts = new RegExp(
    `^[A-Za-z_]+Schema\\.index\\(\\s*\\{\\s*${fld}\\s*:\\s*1\\s*\\}\\s*,\\s*\\{[^}]*\\}\\s*\\)\\s*;\\s*\\n`,
    "m"
  );

  let n = 0;
  if (reSimple.test(src))  { src = src.replace(reSimple,  ""); n++; }
  if (reWithOpts.test(src)){ src = src.replace(reWithOpts, ""); n++; }

  if (n > 0) {
    fs.writeFileSync(file, src, "utf8");
    console.log(`${rel}: removed ${n} duplicate .index() call(s) for '${fld}'`);
    total += n;
  } else {
    console.log(`${rel}: no match for '${fld}' — manual check needed`);
  }
}
console.log(`\nTOTAL: ${total} duplicate .index() calls removed`);
