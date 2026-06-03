/**
 * retireLegacyRoomCharges.js — R7es
 *
 * One-time cleanup. After R7en-3 + R7ep + R7er, the per-room daily
 * charges (Bed Rent / Nursing / Doctor Visit / RMO / Monitoring /
 * Dietetics / Housekeeping / Linen) are sourced from
 * `RoomCategoryCharges` and emitted by autoBillingService with brand-
 * new dynamic codes (`BED-<CATEGORY>`, `NURSING-<CATEGORY>`, …). The
 * legacy ServiceMaster entries that used to drive the same rows
 * (IPD-RM-001 / IPD-ICU-001 / RM-004 / BED-DAYCARE etc.) are now
 * vestigial — the cron doesn't read them, but they still show up in
 * the Service Master UI and would silently double-bill if someone
 * manually added one to a bill.
 *
 * This script soft-deletes (isActive=false) every ServiceMaster entry
 * that matches the matrix's coverage zone:
 *
 *   isAutoCharged: true
 *   billingType:   "PER_DAY"
 *   category:      ROOM | ICU
 *
 * That filter intentionally leaves alone:
 *   • Bed Bath Assistance (NURSING)
 *   • Bed Allocation Charge (REGISTRATION, ONE_TIME)
 *   • Daycare Bed Up-to-6h (PER_SESSION)
 *   • Hourly Observation Bed (PER_HOUR)
 *   • Emergency Bed PER_SESSION
 *
 * Dry-run by default. Pass --apply to actually mutate.
 *
 * Usage:
 *   node Backend/scripts/retireLegacyRoomCharges.js          # dry-run
 *   node Backend/scripts/retireLegacyRoomCharges.js --apply  # commit
 */

"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/spherehealth";
  await mongoose.connect(uri);
  console.log(`[retire] connected to ${uri}`);

  const ServiceMaster = require("../models/ServiceMaster/serviceMasterModel");

  // R7et — broadened from R7es (ROOM+ICU only) to ALL categories the
  // RoomCategoryCharges matrix now covers:
  //   ROOM       → bedRent          (BED-<CAT>)
  //   NURSING    → nursingCharge    (NURSING-<CAT>)
  //   DOCTOR     → doctorVisitCharge + rmoCharge
  //                                  (DOC-VISIT-<CAT>, RMO-<CAT>)
  //   ICU        → monitoringCharge (ICU-MONITOR-<CAT>)
  //   SUPPORT    → dietetics + housekeeping + linen
  //                                  (DIET-<CAT>, HOUSEKEEPING-<CAT>, LINEN-<CAT>)
  //   DAYCARE    → daycare per-day rows that pre-dated the matrix
  // PER_DAY billingType + isAutoCharged together rule out per-procedure
  // nursing (PER_UNIT), one-time consults (PER_VISIT), one-time admin
  // charges (ONE_TIME), and the PACKAGE category (diagnosis-tagged
  // bundles which are intentionally separate from the matrix).
  // SUPPORT is intentionally excluded — those rows are equipment rentals
  // (air-bed, infusion pump, syringe pump, bedside monitor) that admin
  // staff still need to add manually when used. The matrix's
  // housekeeping/linen/dietetics line items emit fresh dynamic codes
  // (HOUSEKEEPING-<CAT> etc.) that don't have ServiceMaster duplicates,
  // so there's no double-billing risk to chase in that category.
  const filter = {
    isAutoCharged: true,
    billingType:   "PER_DAY",
    category:      { $in: ["ROOM", "ICU", "NURSING", "DOCTOR", "DAYCARE"] },
    isActive:      true,
  };

  const matches = await ServiceMaster.find(filter)
    .select("serviceCode serviceName domain category billingType defaultPrice isAutoCharged isActive")
    .sort({ category: 1, serviceCode: 1 })
    .lean();

  console.log(`\n[retire] ${APPLY ? "APPLY mode" : "DRY-RUN"} — found ${matches.length} legacy room-charge entries:\n`);

  if (matches.length === 0) {
    console.log("  (nothing to retire — collection already clean)\n");
    await mongoose.disconnect();
    process.exit(0);
  }

  const fmtINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
  const padRight = (s, n) => String(s || "").padEnd(n);
  console.log(
    "  " + padRight("CODE", 18) +
           padRight("DOMAIN", 10) +
           padRight("CAT", 8) +
           padRight("DEFAULT", 10) +
           "NAME",
  );
  console.log("  " + "-".repeat(80));
  for (const r of matches) {
    console.log(
      "  " + padRight(r.serviceCode, 18) +
             padRight(r.domain, 10) +
             padRight(r.category, 8) +
             padRight(fmtINR(r.defaultPrice), 10) +
             (r.serviceName || ""),
    );
  }
  console.log();

  if (!APPLY) {
    console.log("[retire] DRY-RUN — no changes written. Re-run with --apply to soft-delete.\n");
    await mongoose.disconnect();
    process.exit(0);
  }

  // Soft-delete: isActive=false. Preserves the row for audit, hides it
  // from the Service Master grid (which already filters on isActive),
  // and stops it from re-appearing on "Seed Default Data" idempotent
  // checks. We do NOT $set updatedAt — the existing pre-save hook +
  // updateMany run a $set on updatedAt automatically.
  const ids = matches.map((m) => m._id);
  const res = await ServiceMaster.updateMany(
    { _id: { $in: ids } },
    {
      $set: {
        isActive: false,
        description: `[Retired by R7es — replaced by RoomCategoryCharges matrix · ${new Date().toISOString()}]`,
      },
    },
  );
  console.log(`[retire] soft-deleted ${res.modifiedCount} of ${matches.length} entries.\n`);

  await mongoose.disconnect();
  console.log("[retire] done.\n");
  process.exit(0);
})().catch(async (e) => {
  console.error("[retire] error:", e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
