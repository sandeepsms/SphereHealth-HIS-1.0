/**
 * R7hr-109 + R7hr-110 — One-time heal for signed Doctor IA notes that
 * pre-date the new fan-out + backfill code in
 * services/Doctor/doctorNotesService.signDoctorNote.
 *
 * What it does (per signed DoctorNote where noteType=initial):
 *   1. backfillAdmissionFromIA → mirror chiefComplaint + provisionalDiagnosis
 *      onto admission.reasonForAdmission + admission.provisionalDiagnosis
 *      (only when those fields are currently blank/"—")
 *   2. fanOutMedReconToDoctorOrders   → Med Recon "Continue" → DoctorOrder
 *   3. fanOutMedsToDoctorOrders       → Prescription panel rows → DoctorOrder
 *   4. fanOutInfusionsToDoctorOrders  → Infusion panel rows → DoctorOrder
 *   5. fanOutInvestsToDoctorOrders    → Investigations panel rows → DoctorOrder
 *
 * Idempotent: every fan-out is gated by `sourceRef` so re-running the
 * script over an already-healed note does nothing. Admission backfill
 * is gated by `isBlank` so existing values are never overwritten.
 *
 * R25 compliance: additive only — runs against existing data without
 * mutating any UI/route/contract.
 *
 * Usage: node Backend/scripts/R7hr-109-110_iaHealExistingNotes.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

(async () => {
  const URI = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/spherehealth";
  await mongoose.connect(URI);
  console.log("[R7hr-109-110] connected to", URI.replace(/\/\/.*@/, "//****@"));

  const DoctorNotes = require("../models/Doctor/DoctorNotesModel");
  const fanOuts = require("../services/Doctor/medReconFanOut");

  const signedIAs = await DoctorNotes.find({
    noteType: "initial",
    status: "signed",
  }).lean();

  console.log(`[R7hr-109-110] found ${signedIAs.length} signed initial notes`);

  const summary = { processed: 0, admBackfilled: 0, medsCreated: 0, infusionsCreated: 0, investsCreated: 0, medReconCreated: 0 };

  for (const note of signedIAs) {
    summary.processed++;
    try {
      const a = await fanOuts.backfillAdmissionFromIA(note);
      if (a.updated) {
        summary.admBackfilled++;
        console.log(`  [adm] note ${note._id} → backfilled ${a.fields.join(", ")}`);
      }
    } catch (e) { console.error("  [adm] failed", note._id, e.message); }
    try {
      const r = await fanOuts.fanOutMedReconToDoctorOrders(note);
      summary.medReconCreated += r.created;
      if (r.created) console.log(`  [medRecon] note ${note._id} → ${r.created} created`);
    } catch (e) { console.error("  [medRecon] failed", note._id, e.message); }
    try {
      const r = await fanOuts.fanOutMedsToDoctorOrders(note);
      summary.medsCreated += r.created;
      if (r.created) console.log(`  [meds] note ${note._id} → ${r.created} created`);
    } catch (e) { console.error("  [meds] failed", note._id, e.message); }
    try {
      const r = await fanOuts.fanOutInfusionsToDoctorOrders(note);
      summary.infusionsCreated += r.created;
      if (r.created) console.log(`  [inf]  note ${note._id} → ${r.created} created`);
    } catch (e) { console.error("  [inf] failed", note._id, e.message); }
    try {
      const r = await fanOuts.fanOutInvestsToDoctorOrders(note);
      summary.investsCreated += r.created;
      if (r.created) console.log(`  [inv]  note ${note._id} → ${r.created} created`);
    } catch (e) { console.error("  [inv] failed", note._id, e.message); }
  }

  console.log("[R7hr-109-110] done:", JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error("[R7hr-109-110] fatal", e); process.exit(1); });
