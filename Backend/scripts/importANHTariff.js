// scripts/importANHTariff.js
// ════════════════════════════════════════════════════════════════════
// ONE-SHOT IMPORT — ANH (Arogya Nidhi / ABHI) tariff workbook
// from the hospital's published rate card. Idempotent — upserts only.
//
// Sources (Final ANH Tariff Bright Institute of Medical Sciences):
//   Sheet1: Surgical Packages (Cardiology, ENT, GS, Ortho, etc.) with
//           3-tier room-based pricing (General / Semi-Pvt / Private)
//   Sheet2: Medical Management Packages (MMP-1 … MMP-26) per-day rate
//   Sheet3: General Hospital Charges (room daily rates + specialist
//           visit fees per category + equipment per-unit charges)
//   Sheet4: Non-Package Surgical Grades (I … V) with surgeon/OT/anaes
//           charges per room category
//
// What it writes:
//   • RoomCategory.defaultPricing.{perBedDailyRate, nursingCharges}
//     for each tier (the engine reads these for BED-* / NURSING-* triggers)
//   • ServiceMaster rows for:
//       - Room codes  (BED + BED-GENW / SEMI / PVT / DELUXE / ICU / NICU / DAYCARE)
//       - Nursing codes (NURSING + same tiers)
//       - Doctor visit codes (DOC-SPEC-{tier}, DOC-SUPER-{tier})
//       - Equipment codes (VENT-12H/24H, CPAP-24H, BIPAP-24H, SYRINGE,
//         INFUSION, PULSE-OX, AIR-BED, MONITOR, NEB-SESSION, OXY-12H/24H)
//       - Surgical packages (PKG-SURG-001..134) with 3-tier pricing,
//         inclusions, exclusions, speciality, diagnosisTags
//       - Medical packages (PKG-MED-MMP-1..MMP-26) with per-day 3-tier
//         pricing + maxLOSDays
//       - Non-package surgical grades (SURG-GRADE-{1..5}-{component})
//   • ServicePricing CASH rows mirrored to the General Ward tier
//     (the cash list price patients pay by default; TPA negotiate
//     overrides via the Service Master UI on top of these).
//
// Run from worktree:
//   node scripts/importANHTariff.js
//   node scripts/importANHTariff.js --dry-run   (preview only)
// ════════════════════════════════════════════════════════════════════

require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");
const XLSX = require("xlsx");

const ServiceMaster  = require("../models/ServiceMaster/serviceMasterModel");
const ServicePricing = require("../models/ServicePricing/ServicePricingModel");
const RoomCategory   = require("../models/bedMgmt/roomCategoryModel");

const DRY = process.argv.includes("--dry-run");
const SRC = path.resolve(__dirname, "tariff-source.xlsx");

const TARIFF_SOURCE = "ANH-BRIGHT-INSTITUTE";

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
};
const txt = (v) => (v == null ? "" : String(v).trim().replace(/\s+/g, " "));
const slug = (s) => txt(s).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

const report = {
  roomCategoryUpdated: 0,
  roomCategoryCreated: 0,
  serviceMasterUpserted: 0,
  servicePricingMirrored: 0,
  packagesSurgical: 0,
  packagesMedical: 0,
  surgicalGrades: 0,
  equipment: 0,
  warnings: [],
};

// ── Upsert helper: ServiceMaster + mirror CASH ServicePricing ───────────
async function upsertService(svc) {
  if (DRY) { report.serviceMasterUpserted++; return null; }
  const existing = await ServiceMaster.findOne({ serviceCode: svc.serviceCode });
  let saved;
  if (existing) {
    Object.assign(existing, svc);
    saved = await existing.save();
  } else {
    saved = await ServiceMaster.create(svc);
  }
  report.serviceMasterUpserted++;

  // Mirror CASH price = general-ward tier (or defaultPrice if no tier)
  const cashPrice = svc.tierPricing?.generalWard ?? svc.defaultPrice ?? 0;
  if (cashPrice > 0) {
    const cash = await ServicePricing.findOne({
      serviceId: saved._id, tariffType: "CASH", isActive: true,
    });
    if (cash) {
      cash.price = cashPrice;
      cash.finalPrice = +(cashPrice * (1 - (cash.discount || 0) / 100)).toFixed(2);
      await cash.save();
    } else {
      await ServicePricing.create({
        serviceId: saved._id, tariffType: "CASH",
        price: cashPrice, discount: 0, finalPrice: cashPrice,
      });
    }
    report.servicePricingMirrored++;
  }
  return saved;
}

// ── Upsert helper: RoomCategory pricing ─────────────────────────────────
async function upsertRoomCategory({ categoryCode, categoryName, roomType, perBedDailyRate, nursingCharges, specialistVisit, superSpecialistVisit }) {
  if (DRY) { report.roomCategoryUpdated++; return null; }
  let cat = await RoomCategory.findOne({ categoryCode });
  if (!cat) {
    cat = await RoomCategory.create({
      categoryCode, categoryName, roomType,
      defaultPricing: {
        perBedDailyRate, nursingCharges,
        specialistVisitCharge: specialistVisit,
        superSpecialistVisitCharge: superSpecialistVisit,
      },
      isActive: true,
    }).catch((e) => { report.warnings.push(`RoomCategory create ${categoryCode}: ${e.message}`); return null; });
    if (cat) report.roomCategoryCreated++;
    return cat;
  }
  cat.categoryName = categoryName || cat.categoryName;
  cat.roomType = roomType || cat.roomType;
  cat.defaultPricing = cat.defaultPricing || {};
  cat.defaultPricing.perBedDailyRate = perBedDailyRate;
  cat.defaultPricing.nursingCharges  = nursingCharges;
  if (specialistVisit != null)      cat.defaultPricing.specialistVisitCharge = specialistVisit;
  if (superSpecialistVisit != null) cat.defaultPricing.superSpecialistVisitCharge = superSpecialistVisit;
  await cat.save().catch((e) => report.warnings.push(`RoomCategory update ${categoryCode}: ${e.message}`));
  report.roomCategoryUpdated++;
  return cat;
}

// ════════════════════ SHEET 3 — ROOM + EQUIPMENT ════════════════════
async function importSheet3(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sheet3, { header: 1, defval: "" });

  // Map verbose tariff names → engine categoryCode (the engine fires
  // `BED-${cat.categoryCode}` / `NURSING-${cat.categoryCode}` / etc, so
  // serviceCode MUST match the RoomCategory.categoryCode — otherwise
  // the auto-billing trigger creates a synthetic row that ServicePricing
  // tariff lookup can't match.
  const tierMap = [
    // [Excel label fragment,         categoryCode, categoryName,    roomType]
    ["Day Care",                       "DAYCARE",  "Day Care",       "Daycare"],
    ["General Ward/Economy",           "GENW",     "General Ward",   "General Ward"],
    ["Twin Sharing/Semi-Private",      "SEMI",     "Semi-Private",   "Semi-Private"],
    ["Private/Single Deluxe",          "PVT",      "Private Room",   "Private Room"],
    ["HDU/PICU/ICU/SICU/MICU",         "ICU",      "ICU",            "ICU"],
    ["NICU",                           "NICU",     "NICU",           "NICU"],
  ];

  // Rows 4-9 hold the room tariff table
  for (let i = 3; i <= 8; i++) {
    const r = rows[i]; if (!r) continue;
    const label   = txt(r[1]);
    const tariff  = num(r[2]);
    const spec    = num(r[4]);
    const superSp = num(r[5]);
    const match = tierMap.find(([frag]) => label.toLowerCase().includes(frag.toLowerCase().split("/")[0]));
    if (!match || tariff == null) continue;
    const [, code, name, type] = match;
    // serviceCode uses categoryCode directly so the engine's
    // `BED-${cat.categoryCode}` lookups resolve.
    const tierKey = code;

    // 1. RoomCategory — the engine's source of truth for BED-*/NURSING-* rates
    //    Nursing for ANH is included in room rent ("Inclusions in Room Rent"
    //    for Day Care says "Nursing, RMO, Dietician..."). Set nursing=0 to
    //    avoid double-charging. Hospital admins can raise it later if they
    //    decide to bill it separately.
    await upsertRoomCategory({
      categoryCode: code, categoryName: name, roomType: type,
      perBedDailyRate: tariff, nursingCharges: 0,
      specialistVisit: spec, superSpecialistVisit: superSp,
    });

    // 2. ServiceMaster anchor rows so the audit UI shows them
    await upsertService({
      serviceCode: `BED-${tierKey}`,
      serviceName: `Bed Charge — ${name} (Daily)`,
      domain: code === "DAYCARE" ? "DAYCARE" : "IPD",
      category: "ROOM",
      applicableTo: code === "DAYCARE" ? ["DAYCARE"] : ["IPD"],
      billingType: "PER_DAY",
      defaultPrice: tariff,
      isAutoCharged: true,
      unitLabel: "per day",
      displayOrder: 9020,
      tariffSource: TARIFF_SOURCE,
      tierPricing: { generalWard: tariff, semiPrivate: tariff, private: tariff },
      serviceType: "room",
    });
    await upsertService({
      serviceCode: `NURSING-${tierKey}`,
      serviceName: `Nursing — ${name} (Daily, incl. RMO/Dietician)`,
      domain: code === "DAYCARE" ? "DAYCARE" : "IPD",
      category: "NURSING",
      applicableTo: code === "DAYCARE" ? ["DAYCARE"] : ["IPD"],
      billingType: "PER_DAY",
      defaultPrice: 0,           // ANH bundles nursing into room rent
      isAutoCharged: true,
      unitLabel: "per day",
      displayOrder: 9030,
      tariffSource: TARIFF_SOURCE,
      tierPricing: { generalWard: 0, semiPrivate: 0, private: 0 },
      serviceType: "nursing",
      description: "Nursing charges are bundled into the ANH room rent — set to ₹0 to avoid double-charging. Raise to a per-day rate if the hospital decides to bill nursing separately.",
    });
    // Specialist + Super-specialist visit charges per tier
    if (spec != null) {
      await upsertService({
        serviceCode: `DOC-SPEC-${tierKey}`,
        serviceName: `Specialist Visit — ${name}`,
        domain: "IPD", category: "DOCTOR",
        applicableTo: ["IPD", "DAYCARE"],
        billingType: "PER_VISIT", defaultPrice: spec,
        isAutoCharged: true, unitLabel: "per visit",
        displayOrder: 9040,
        tariffSource: TARIFF_SOURCE,
        tierPricing: { generalWard: spec, semiPrivate: spec, private: spec },
        serviceType: "consultation",
      });
    }
    if (superSp != null) {
      await upsertService({
        serviceCode: `DOC-SUPER-${tierKey}`,
        serviceName: `Super-Specialist Visit — ${name}`,
        domain: "IPD", category: "DOCTOR",
        applicableTo: ["IPD", "DAYCARE"],
        billingType: "PER_VISIT", defaultPrice: superSp,
        isAutoCharged: true, unitLabel: "per visit",
        displayOrder: 9041,
        tariffSource: TARIFF_SOURCE,
        tierPricing: { generalWard: superSp, semiPrivate: superSp, private: superSp },
        serviceType: "consultation",
      });
    }
  }

  // ── Equipment + Investigation table (rows 13-23) ───────────────────────
  // Excel column layout: [name in A, _, charge in C]
  const equipment = [
    { row: 12, code: "VENT-12H",       name: "Ventilator (up to 12 hrs)",   unit: "per 12h", auto: false },
    { row: 13, code: "VENT-24H",       name: "Ventilator (up to 24 hrs)",   unit: "per 24h", auto: true },
    { row: 14, code: "CPAP-24H",       name: "C-PAP (24 hrs)",               unit: "per 24h", auto: true },
    { row: 15, code: "BIPAP-24H",      name: "BiPAP (24 hrs)",               unit: "per 24h", auto: true },
    { row: 16, code: "SYRINGE-PUMP",   name: "Syringe Pump (per day)",       unit: "per day", auto: true },
    { row: 17, code: "INFUSION-PUMP",  name: "Infusion Pump (per day)",      unit: "per day", auto: true },
    { row: 18, code: "PULSE-OX",       name: "Pulse Oxymeter (one-time)",    unit: "one time", auto: false },
    { row: 19, code: "AIR-BED",        name: "Air Bed (per day)",            unit: "per day", auto: true },
    { row: 20, code: "MONITOR-DAY",    name: "Bedside Monitor (per day)",    unit: "per day", auto: true },
    { row: 21, code: "NEB-SESSION",    name: "Nebulizer (per session)",      unit: "per session", auto: false },
    { row: 22, code: "OXY-12H",        name: "Oxygen (12 hrs)",              unit: "per 12h", auto: true, price: 300 },
    { row: 22, code: "OXY-24H",        name: "Oxygen (24 hrs)",              unit: "per 24h", auto: true, price: 600 },
  ];
  for (const eq of equipment) {
    const r = rows[eq.row]; if (!r) continue;
    let price = eq.price ?? num(r[2]);
    if (price == null) continue;
    await upsertService({
      serviceCode: eq.code, serviceName: eq.name,
      domain: "IPD", category: "SUPPORT",
      applicableTo: ["IPD", "DAYCARE", "EMERGENCY"],
      billingType: eq.unit.includes("session") ? "PER_SESSION"
                  : eq.unit.includes("one") ? "ONE_TIME"
                  : eq.unit.includes("day") ? "PER_DAY"
                  : "PER_HOUR",
      defaultPrice: price, isAutoCharged: eq.auto,
      unitLabel: eq.unit, displayOrder: 9100 + report.equipment,
      tariffSource: TARIFF_SOURCE,
      serviceType: "consumable",
    });
    report.equipment++;
  }
}

// ════════════════════ SHEET 1 — SURGICAL PACKAGES ════════════════════
async function importSheet1(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, defval: "" });
  // Header row 6, data rows 7..140 (S.No 1..134)
  for (let i = 6; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const speciality = txt(r[0]);
    const sno  = num(r[1]);
    const name = txt(r[2]);
    const incl = txt(r[3]);
    const excl = txt(r[4]);
    const gen  = num(r[5]);
    const semi = num(r[6]);
    const pvt  = num(r[7]);
    if (!speciality || !sno || !name || gen == null) continue;
    if (speciality.toLowerCase().startsWith("part-1")) break;   // definitions footer

    const code = `PKG-SURG-${String(sno).padStart(3, "0")}`;
    const tags = name
      .toLowerCase()
      .replace(/\(.*?\)/g, "")
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4);

    await upsertService({
      serviceCode: code,
      serviceName: name,
      domain: "IPD",
      category: "PACKAGE",
      applicableTo: ["IPD", "DAYCARE"],
      billingType: "PER_PROCEDURE",
      defaultPrice: gen,                   // General Ward = CASH default
      isAutoCharged: false,                // packages added on confirmation, not auto
      isTaxable: false,
      unitLabel: "package",
      displayOrder: 8000 + sno,
      tariffSource: TARIFF_SOURCE,
      speciality,
      inclusions: incl ? `Inclusion grades: ${incl}` : undefined,
      exclusions: excl || undefined,
      tierPricing: { generalWard: gen, semiPrivate: semi || gen, private: pvt || semi || gen },
      diagnosisTags: tags,
      serviceType: "package",
      description: `${speciality} surgical package. Includes consultation, OT, anaesthesia, nursing, room rent and routine investigations as per ANH terms (${incl}). Excludes: ${excl || "n/a"}.`,
    });
    report.packagesSurgical++;
  }
}

// ════════════════════ SHEET 2 — MEDICAL MANAGEMENT PACKAGES ════════════════════
async function importSheet2(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sheet2, { header: 1, defval: "" });
  // Header row 2, data rows 3..28 (MMP-1..MMP-26)
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const mmpCode = txt(r[0]);
    if (!mmpCode.toUpperCase().startsWith("MMP")) continue;
    const subCat  = txt(r[1]);
    const losStr  = txt(r[2]);
    const incl    = txt(r[3]);
    const excl    = txt(r[4]);
    const gen     = num(r[5]);
    const semi    = num(r[6]);
    const pvt     = num(r[7]);
    if (!subCat || gen == null) continue;

    const code = `PKG-MED-${slug(mmpCode)}`;            // PKG-MED-MMP-1
    const los  = num(losStr) || 3;
    const tags = subCat.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length >= 4);

    await upsertService({
      serviceCode: code,
      serviceName: `${mmpCode}: ${subCat}`,
      domain: "IPD",
      category: "PACKAGE",
      applicableTo: ["IPD"],
      billingType: "PER_DAY",
      defaultPrice: gen,
      isAutoCharged: true,                 // MMP packages accrue per day automatically
      isTaxable: false,
      unitLabel: "per day",
      displayOrder: 8500 + (num(slug(mmpCode).replace("MMP-","")) || 0),
      tariffSource: TARIFF_SOURCE,
      speciality: "Medical Management",
      inclusions: incl || undefined,
      exclusions: excl || undefined,
      maxLOSDays: los,
      tierPricing: { generalWard: gen, semiPrivate: semi || gen, private: pvt || semi || gen },
      diagnosisTags: tags,
      serviceType: "package",
      description: `Medical management package, all-inclusive for up to ${los} days. Beyond ${los} days the bill switches to per-day room + nursing + investigations as per non-package tariff.`,
    });
    report.packagesMedical++;
  }
}

// ════════════════════ SHEET 4 — NON-PACKAGE SURGICAL GRADES ════════════════════
async function importSheet4(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sheet4, { header: 1, defval: "" });
  let currentGrade = null;
  // data rows 4..25
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const gradeCell = txt(r[0]);
    const partic    = txt(r[1]);
    const gen  = num(r[2]);
    const semi = num(r[3]);
    const pvt  = num(r[4]);
    if (gradeCell) {
      const m = gradeCell.match(/GRADE\s+(I+V?|V)/i);
      if (m) currentGrade = ({ I: 1, II: 2, III: 3, IV: 4, V: 5 })[m[1].toUpperCase()];
    }
    if (!currentGrade || !partic || gen == null) continue;

    const partSlug =
        /surgeon|procedure/i.test(partic) ? "SURGEON"
      : /assistant/i.test(partic)         ? "ASST"
      : /\bot\b/i.test(partic)            ? "OT"
      : /anesth.*medic|medicines/i.test(partic) ? "ANES-MEDS"
      : /anesth/i.test(partic)            ? "ANES"
      : /gas/i.test(partic)               ? "GASES"
      : slug(partic).slice(0, 16);

    const code = `SURG-GRADE-${currentGrade}-${partSlug}`;
    await upsertService({
      serviceCode: code,
      serviceName: `Grade ${["", "I (Minor)", "II (Intermediate)", "III (Major)", "IV (Supra-Major)", "V (Supra-Major Plus)"][currentGrade]} — ${partic}`,
      domain: "IPD",
      category: "OT",
      applicableTo: ["IPD", "DAYCARE"],
      billingType: "PER_PROCEDURE",
      defaultPrice: gen,
      isAutoCharged: false,                  // surgery charges added at OT booking
      unitLabel: "per procedure",
      displayOrder: 8800 + currentGrade * 10,
      tariffSource: TARIFF_SOURCE,
      tierPricing: { generalWard: gen, semiPrivate: semi || gen, private: pvt || semi || gen },
      serviceType: partSlug === "OT" ? "ot" : "procedure",
      description: `Non-package surgical grade ${currentGrade} — applies when patient's diagnosis isn't covered by an ANH package. Add along with separate room + nursing accrual.`,
    });
    report.surgicalGrades++;
  }
}

// ════════════════════════ MAIN ════════════════════════
(async () => {
  console.log("[tariff] connecting to MongoDB", DRY ? "(DRY RUN)" : "");
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/spherehealth");
  console.log("[tariff] reading", SRC);
  const wb = XLSX.readFile(SRC);

  console.log("\n[tariff] ▶ Sheet 3 — Room + Equipment");
  await importSheet3(wb);
  console.log("\n[tariff] ▶ Sheet 1 — Surgical Packages");
  await importSheet1(wb);
  console.log("\n[tariff] ▶ Sheet 2 — Medical Management Packages");
  await importSheet2(wb);
  console.log("\n[tariff] ▶ Sheet 4 — Non-Package Surgical Grades");
  await importSheet4(wb);

  console.log("\n────────────────────────────────────────────");
  console.log("ANH TARIFF IMPORT SUMMARY", DRY ? "(DRY RUN — no DB writes)" : "");
  console.log("  RoomCategory created       :", report.roomCategoryCreated);
  console.log("  RoomCategory updated       :", report.roomCategoryUpdated);
  console.log("  ServiceMaster upserted     :", report.serviceMasterUpserted);
  console.log("  ServicePricing CASH mirror :", report.servicePricingMirrored);
  console.log("  Surgical packages          :", report.packagesSurgical);
  console.log("  Medical packages           :", report.packagesMedical);
  console.log("  Non-package surgical rows  :", report.surgicalGrades);
  console.log("  Equipment rows             :", report.equipment);
  if (report.warnings.length) {
    console.log("\nWARNINGS:");
    for (const w of report.warnings) console.log("  -", w);
  }
  console.log("────────────────────────────────────────────");
  await mongoose.disconnect();
})().catch((e) => {
  console.error("[tariff] FAILED:", e?.stack || e?.message || e);
  process.exit(1);
});
