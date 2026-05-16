/*
 * Scan models/ for fields that have both `index: true` (inline)
 * AND a separate `Schema.index({ field: 1 })` declaration.
 * Mongoose warns about these on startup.
 */
const fs = require("fs");
const path = require("path");

function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, files);
    else if (e.name.endsWith(".js")) files.push(p);
  }
  return files;
}

const FIELDS = [
  "patientId", "UHID", "visitNumber", "departmentCode", "doctorId",
  "tpaCode", "employeeId", "email", "categoryCode", "emergencyNumber",
  "orderNumber", "investigationCode", "serviceCode", "staffId",
  "admissionId", "status", "ipdNo",
];

const files = walk(path.join(__dirname, "..", "models"));
const report = {};
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const fld of FIELDS) {
    const inline = new RegExp(`\\b${fld}\\s*:\\s*\\{[^}]*index\\s*:\\s*true`, "s").test(src);
    const indexCall = new RegExp(`\\.index\\(\\s*\\{[^}]*\\b${fld}\\s*:\\s*1`, "s").test(src);
    if (inline && indexCall) {
      report[path.relative(path.join(__dirname, ".."), f)] = report[path.relative(path.join(__dirname, ".."), f)] || [];
      report[path.relative(path.join(__dirname, ".."), f)].push(fld);
    }
  }
}
console.log(JSON.stringify(report, null, 2));
