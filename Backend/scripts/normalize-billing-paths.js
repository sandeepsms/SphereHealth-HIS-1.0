/*
 * Normalize all billing path references to the actual folder casing
 * (Linux is case-sensitive; Windows is not, which hides the bug locally).
 *
 * Actual folder names on disk:
 *   services/Billing/        (capital B)
 *   controllers/Billing/     (capital B)
 *   models/Billing/          (capital B)
 *   routes/Billing/          (capital B)
 *
 * This script rewrites every require() / import to match.
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

const root = path.join(__dirname, "..");
let total = 0;
for (const f of walk(root)) {
  let src = fs.readFileSync(f, "utf8");
  const before = src;
  src = src.replace(/services\/billing\//g,    "services/Billing/");
  src = src.replace(/controllers\/billing\//g, "controllers/Billing/");
  src = src.replace(/models\/billing\//g,      "models/Billing/");
  src = src.replace(/routes\/billing\//g,      "routes/Billing/");
  if (src !== before) {
    fs.writeFileSync(f, src);
    total++;
    console.log("Fixed:", path.relative(root, f));
  }
}
console.log(`\nTOTAL: ${total} files updated`);
