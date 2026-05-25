// scripts/backfillOpdBillVisitLink.js
// ════════════════════════════════════════════════════════════════════
// R7bw: backfill PatientBill.visitId for every OPD bill that pre-dates
// the visitId column.
//
// Background:
//   Pre-R7bw PatientBill had NO per-visit FK. The patient-history
//   aggregator (Backend/controllers/Clinical/patientHistoryController.js)
//   was forced to attach OPD bill items to OPDRegistration visits using
//   a same-day proximity join (`chargeDate ≈ visit.visitDate`). For any
//   patient with > 1 OPD visit on the same calendar day (return-visit,
//   multi-department, OPD→IPD-conversion-day) all bill items pooled
//   into every visit.
//
// What this script does:
//   • Find every PatientBill where visitType:"OPD" AND visitId is null.
//   • For each, find OPDRegistration rows matching `{ UHID, visitDate
//     same-day as bill.createdAt }`.
//   • If exactly 1 match → stamp `visitId = opdReg.visitNumber`.
//   • If 0 matches → skip + log (legacy bills with no OPD visit on
//     record, or bills created before any OPD visit).
//   • If 2+ matches → skip + log (multi-visit-same-day — ambiguous,
//     same edge case the aggregator can't resolve without this column,
//     so we don't risk a wrong stamp here either).
//
// USAGE:
//   node Backend/scripts/backfillOpdBillVisitLink.js              (DRY RUN — default)
//   node Backend/scripts/backfillOpdBillVisitLink.js --apply      (write to DB)
//
// Idempotent: re-running on an already-backfilled row is a no-op (visitId
// is only filled when null; the script never overwrites an existing value).
// ════════════════════════════════════════════════════════════════════

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

// ── Helper — same-day window in UTC. We mirror the aggregator's
// existing sameDay() helper (UTC-based) so the matches line up.
function sameDayRange(d) {
  const day = new Date(d);
  const start = new Date(Date.UTC(
    day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, 0,
  ));
  const end = new Date(Date.UTC(
    day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999,
  ));
  return { start, end };
}

async function backfillOpdBillVisitLink(PatientBill, OPDRegistration, apply) {
  const stats = {
    candidates:  0,
    touched:     0,
    skippedNoMatch:    0,
    skippedAmbiguous:  0,
    errors:      0,
    sampleTouched:    [],
    sampleNoMatch:    [],
    sampleAmbiguous:  [],
  };

  // Stream the candidates so the script doesn't load everything into
  // memory on a large hospital. We only need a thin projection.
  const cursor = PatientBill.find({
    visitType: "OPD",
    $or: [
      { visitId: null },
      { visitId: { $exists: false } },
    ],
  })
    .select("_id UHID createdAt billDate visitId billItems billNumber")
    .lean()
    .cursor();

  for await (const bill of cursor) {
    stats.candidates++;

    // Prefer bill.billItems[0].chargeDate (the actual service date) over
    // bill.createdAt (the draft-row birth time); fall back through billDate
    // → createdAt. The aggregator did the same fallback chain.
    let anchor = null;
    if (Array.isArray(bill.billItems) && bill.billItems.length) {
      anchor = bill.billItems[0]?.chargeDate || null;
    }
    if (!anchor) anchor = bill.billDate || bill.createdAt;
    if (!anchor) {
      // No anchor date → can't resolve. Count as "no match" so the operator
      // can investigate later. Don't error out the whole script.
      stats.skippedNoMatch++;
      if (stats.sampleNoMatch.length < 10) {
        stats.sampleNoMatch.push({
          billId: bill._id.toString(),
          billNumber: bill.billNumber,
          UHID: bill.UHID,
          reason: "no chargeDate / billDate / createdAt to anchor",
        });
      }
      continue;
    }

    const { start, end } = sameDayRange(anchor);
    let matches;
    try {
      matches = await OPDRegistration.find({
        UHID: bill.UHID,
        visitDate: { $gte: start, $lte: end },
      })
        .select("_id visitNumber visitDate")
        .lean();
    } catch (e) {
      stats.errors++;
      console.error(`[backfillOpdBillVisitLink] OPD lookup failed UHID=${bill.UHID}:`, e.message);
      continue;
    }

    if (matches.length === 0) {
      stats.skippedNoMatch++;
      if (stats.sampleNoMatch.length < 10) {
        stats.sampleNoMatch.push({
          billId: bill._id.toString(),
          billNumber: bill.billNumber,
          UHID: bill.UHID,
          anchor: new Date(anchor).toISOString(),
        });
      }
      continue;
    }

    if (matches.length > 1) {
      stats.skippedAmbiguous++;
      if (stats.sampleAmbiguous.length < 10) {
        stats.sampleAmbiguous.push({
          billId: bill._id.toString(),
          billNumber: bill.billNumber,
          UHID: bill.UHID,
          anchor: new Date(anchor).toISOString(),
          matched: matches.map((m) => m.visitNumber).filter(Boolean),
        });
      }
      continue;
    }

    const opdVisit = matches[0];
    if (!opdVisit.visitNumber) {
      // OPD doc with null visitNumber (pre-R7bd race survivor). Skip.
      stats.skippedNoMatch++;
      if (stats.sampleNoMatch.length < 10) {
        stats.sampleNoMatch.push({
          billId: bill._id.toString(),
          billNumber: bill.billNumber,
          UHID: bill.UHID,
          reason: "matched OPD has null visitNumber",
        });
      }
      continue;
    }

    if (apply) {
      try {
        await PatientBill.collection.updateOne(
          { _id: bill._id },
          { $set: { visitId: opdVisit.visitNumber } },
        );
      } catch (e) {
        stats.errors++;
        console.error(`[backfillOpdBillVisitLink] update failed bill=${bill._id}:`, e.message);
        continue;
      }
    }
    stats.touched++;
    if (stats.sampleTouched.length < 10) {
      stats.sampleTouched.push({
        billId: bill._id.toString(),
        billNumber: bill.billNumber,
        UHID: bill.UHID,
        visitId: opdVisit.visitNumber,
      });
    }
  }

  return stats;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";
  await mongoose.connect(uri);

  const PatientBill     = require("../models/PatientBillModel/PatientBillModel");
  const OPDRegistration = require("../models/Patient/OPDModels");

  console.log(`[backfillOpdBillVisitLink] mode=${apply ? "APPLY" : "DRY-RUN"} uri=${uri}`);

  const stats = await backfillOpdBillVisitLink(PatientBill, OPDRegistration, apply);

  console.log(`[backfillOpdBillVisitLink] candidates=${stats.candidates}`);
  console.log(`[backfillOpdBillVisitLink] touched=${stats.touched}  (visitId stamped)`);
  console.log(`[backfillOpdBillVisitLink] skipped (no match)=${stats.skippedNoMatch}`);
  console.log(`[backfillOpdBillVisitLink] skipped (ambiguous)=${stats.skippedAmbiguous}`);
  console.log(`[backfillOpdBillVisitLink] errors=${stats.errors}`);
  if (stats.sampleTouched.length) {
    console.log(`[backfillOpdBillVisitLink] sample touched:`);
    for (const s of stats.sampleTouched) {
      console.log(`    bill ${s.billNumber || s.billId} (UHID ${s.UHID}) → visitId=${s.visitId}`);
    }
  }
  if (stats.sampleAmbiguous.length) {
    console.log(`[backfillOpdBillVisitLink] sample ambiguous (skipped — multi-visit same day):`);
    for (const s of stats.sampleAmbiguous) {
      console.log(`    bill ${s.billNumber || s.billId} (UHID ${s.UHID}) on ${s.anchor} matched ${s.matched.length} visits: ${s.matched.join(", ")}`);
    }
  }
  if (stats.sampleNoMatch.length) {
    console.log(`[backfillOpdBillVisitLink] sample no-match (skipped):`);
    for (const s of stats.sampleNoMatch) {
      console.log(`    bill ${s.billNumber || s.billId} (UHID ${s.UHID})${s.reason ? " — " + s.reason : (" on " + s.anchor)}`);
    }
  }

  console.log(`[backfillOpdBillVisitLink] done. ${apply ? "Wrote to DB." : "DRY RUN — pass --apply to commit."}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[backfillOpdBillVisitLink] FAILED:", err);
  process.exit(1);
});
