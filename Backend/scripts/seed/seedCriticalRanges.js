/**
 * scripts/seed/seedCriticalRanges.js — R9-FIX(R9-045)
 *
 * The lab critical-value auto-alert (investigationOrderService `_classifyResult`
 * → `criticalHits`) fires only when a result carries a numeric reference
 * interval AND critical thresholds. The whole pipeline already resolves those
 * from `InvestigationMaster.parameters[].referenceRanges[]`
 * (`resolveReferenceRange` returns low/high + criticalLow/criticalHigh) and
 * stamps them onto the result before classifying — but NO deployment ever
 * seeded that reference data, so `resolveReferenceRange` always returned null,
 * every result fell back to the hand-typed isAbnormal flag, and a PANIC value
 * (e.g. K 7.2, Hb 5, platelets 15k) NEVER raised an automatic critical alert.
 *
 * This script seeds the common life-threatening analytes with adult reference
 * intervals + critical (panic) thresholds. It is IDEMPOTENT: it never
 * duplicates a parameter or an overlapping range, and it only ADDS missing data
 * — it never overwrites ranges an operator has tuned. Run once per deployment:
 *
 *     node scripts/seed/seedCriticalRanges.js            # dry run (report only)
 *     node scripts/seed/seedCriticalRanges.js --apply    # write changes
 *
 * Critical thresholds are conservative, widely-published adult panic values
 * (Tietz / CAP survey ranges). A lab should review + adjust for its own
 * analysers and population — this is a safe default so the alert is REACHABLE,
 * not a substitute for the lab's validated limits.
 */
"use strict";

const mongoose = require("mongoose");

// ── Analyte catalog ────────────────────────────────────────────────────────
// Each panel matches one or more InvestigationMaster names/codes; each of its
// parameters carries name + aliases (matched case/space-insensitively against
// the master's existing parameter names) + unit + one or more ranges.
const CATALOG = [
  {
    match: ["complete blood count", "cbc", "hemogram", "haemogram", "path-001"],
    parameters: [
      { name: "Haemoglobin", aliases: ["hemoglobin", "haemoglobin", "hb", "hgb"], unit: "g/dL",
        ranges: [
          { sex: "M", low: 13, high: 17, criticalLow: 7, criticalHigh: 20 },
          { sex: "F", low: 12, high: 15, criticalLow: 7, criticalHigh: 20 },
        ] },
      { name: "Platelet Count", aliases: ["platelet count", "platelets", "platelet", "plt"], unit: "10^3/uL",
        ranges: [{ sex: "ANY", low: 150, high: 410, criticalLow: 20, criticalHigh: 1000 }] },
      { name: "Total WBC Count", aliases: ["total wbc count", "wbc", "tlc", "total leucocyte count", "total leukocyte count"], unit: "10^3/uL",
        ranges: [{ sex: "ANY", low: 4, high: 11, criticalLow: 1, criticalHigh: 50 }] },
    ],
  },
  {
    match: ["serum electrolytes", "electrolytes", "serum sodium", "serum potassium", "na k cl", "e-lytes", "lytes"],
    parameters: [
      { name: "Sodium", aliases: ["sodium", "na", "na+"], unit: "mmol/L",
        ranges: [{ sex: "ANY", low: 135, high: 145, criticalLow: 120, criticalHigh: 160 }] },
      { name: "Potassium", aliases: ["potassium", "k", "k+"], unit: "mmol/L",
        ranges: [{ sex: "ANY", low: 3.5, high: 5.1, criticalLow: 2.8, criticalHigh: 6.2 }] },
      { name: "Chloride", aliases: ["chloride", "cl", "cl-"], unit: "mmol/L",
        ranges: [{ sex: "ANY", low: 98, high: 107, criticalLow: 80, criticalHigh: 120 }] },
    ],
  },
  {
    match: ["blood glucose", "glucose", "rbs", "fbs", "ppbs", "random blood sugar", "fasting blood sugar", "blood sugar"],
    parameters: [
      { name: "Glucose", aliases: ["glucose", "blood sugar", "sugar", "rbs", "fbs", "ppbs"], unit: "mg/dL",
        ranges: [{ sex: "ANY", low: 70, high: 140, criticalLow: 40, criticalHigh: 500 }] },
    ],
  },
  {
    match: ["serum calcium", "calcium", "s. calcium"],
    parameters: [
      { name: "Calcium", aliases: ["calcium", "ca", "ca++"], unit: "mg/dL",
        ranges: [{ sex: "ANY", low: 8.5, high: 10.5, criticalLow: 6.5, criticalHigh: 13 }] },
    ],
  },
  {
    match: ["serum creatinine", "creatinine", "renal function test", "rft", "kft", "kidney function test"],
    parameters: [
      { name: "Creatinine", aliases: ["creatinine", "creat"], unit: "mg/dL",
        ranges: [
          { sex: "M", low: 0.7, high: 1.3, criticalLow: null, criticalHigh: 7.4 },
          { sex: "F", low: 0.6, high: 1.1, criticalLow: null, criticalHigh: 7.4 },
        ] },
    ],
  },
  {
    match: ["prothrombin time", "pt inr", "pt/inr", "inr", "coagulation profile"],
    parameters: [
      { name: "INR", aliases: ["inr"], unit: "ratio",
        ranges: [{ sex: "ANY", low: 0.8, high: 1.2, criticalLow: null, criticalHigh: 5 }] },
    ],
  },
  {
    match: ["arterial blood gas", "abg", "blood gas"],
    parameters: [
      { name: "pH", aliases: ["ph"], unit: "",
        ranges: [{ sex: "ANY", low: 7.35, high: 7.45, criticalLow: 7.2, criticalHigh: 7.6 }] },
    ],
  },
  {
    match: ["serum magnesium", "magnesium"],
    parameters: [
      { name: "Magnesium", aliases: ["magnesium", "mg"], unit: "mg/dL",
        ranges: [{ sex: "ANY", low: 1.7, high: 2.4, criticalLow: 1, criticalHigh: 4.7 }] },
    ],
  },
];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

function panelMatchesMaster(panel, master) {
  const hay = new Set([norm(master.investigationName), norm(master.investigationCode)]);
  return panel.match.some((m) => {
    const nm = norm(m);
    for (const h of hay) if (h && (h === nm || h.includes(nm) || nm.includes(h))) return true;
    return false;
  });
}

// Does an existing range already cover (same sex, overlapping age band)?
function rangeAlreadyPresent(existing, want) {
  return (existing || []).some((r) =>
    (r.sex || "ANY") === (want.sex || "ANY") &&
    Number(r.ageMinYears || 0) <= (want.ageMaxYears ?? 200) &&
    Number(r.ageMaxYears ?? 200) >= (want.ageMinYears ?? 0),
  );
}

function findParam(master, paramDef) {
  const wantNames = new Set([norm(paramDef.name), ...paramDef.aliases.map(norm)]);
  return (master.parameters || []).find((p) => wantNames.has(norm(p.name)));
}

async function run({ apply = false } = {}) {
  const InvestigationMaster = require("../../models/Investigation/InvestigationMasterModel");
  const masters = await InvestigationMaster.find({});
  let mastersTouched = 0, paramsAdded = 0, rangesAdded = 0;
  const log = [];

  for (const master of masters) {
    let changed = false;
    for (const panel of CATALOG) {
      if (!panelMatchesMaster(panel, master)) continue;
      for (const pdef of panel.parameters) {
        let param = findParam(master, pdef);
        if (!param) {
          // Add the parameter with all its ranges.
          param = { name: pdef.name, unit: pdef.unit, referenceRanges: [] };
          master.parameters.push(param);
          param = master.parameters[master.parameters.length - 1];
          paramsAdded++;
          changed = true;
          log.push(`  + param ${master.investigationCode}/${pdef.name}`);
        }
        if (!param.unit && pdef.unit) { param.unit = pdef.unit; changed = true; }
        for (const rg of pdef.ranges) {
          const want = { sex: rg.sex || "ANY", ageMinYears: rg.ageMinYears ?? 0, ageMaxYears: rg.ageMaxYears ?? 200 };
          if (rangeAlreadyPresent(param.referenceRanges, want)) continue;
          param.referenceRanges.push({
            sex: want.sex, ageMinYears: want.ageMinYears, ageMaxYears: want.ageMaxYears,
            low: rg.low ?? null, high: rg.high ?? null,
            criticalLow: rg.criticalLow ?? null, criticalHigh: rg.criticalHigh ?? null,
            text: rg.low != null || rg.high != null ? `${rg.low ?? ""} - ${rg.high ?? ""}`.trim() : "",
          });
          rangesAdded++;
          changed = true;
          log.push(`  + range ${master.investigationCode}/${param.name} ${want.sex} crit[${rg.criticalLow ?? "-"}, ${rg.criticalHigh ?? "-"}]`);
        }
      }
    }
    if (changed) {
      mastersTouched++;
      if (apply) { master.markModified("parameters"); await master.save(); }
    }
  }

  console.log(log.join("\n"));
  console.log(`\n[seedCriticalRanges] ${apply ? "APPLIED" : "DRY RUN"} — masters touched: ${mastersTouched}, params added: ${paramsAdded}, ranges added: ${rangesAdded}`);
  return { mastersTouched, paramsAdded, rangesAdded };
}

// CLI entry
if (require.main === module) {
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/spherehealth";
  mongoose.connect(uri)
    .then(() => run({ apply }))
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((e) => { console.error("[seedCriticalRanges] FAILED:", e.message); process.exit(1); });
}

module.exports = { run, CATALOG };
