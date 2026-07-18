/**
 * backfillEcgRegister.js — R7hr(REG-BACKFILL)
 *
 * Replays the NABH ECG-register auto-emit for historical ECG doctor-orders.
 *
 * WHY: until REG-V (`eb85e543`) emitECG passed the real ward name into the
 * register's closed `location` enum — every auto-emit threw ValidationError
 * (swallowed by design), so NO register row was ever created for ECG orders
 * placed before the fix. The register data itself is derivable from the
 * DoctorOrder rows, so this replay restores it.
 *
 * Idempotent: emitECG dedups on doctorOrderId — rows that already exist
 * (post-fix orders, or a second run of this script) are skipped.
 *
 * Usage:
 *   node scripts/backfillEcgRegister.js          # apply
 *   node scripts/backfillEcgRegister.js --dry    # count only, no writes
 *
 * NOTE — Restraint register: NOT backfillable. restraintController's ONLY
 * sink was emitRestraint (no source collection); while the sourceRef type
 * bug made every write fail, the submitted data was lost at request time.
 * Rows recorded after REG-V persist normally.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const DRY = process.argv.includes("--dry");

const isEcgName = (details = {}) => {
  const name = String(
    details.testName || details.displayName || details.investigationName || details.medicineName || ""
  ).toLowerCase();
  return /\becg\b/.test(name) || /\bekg\b/.test(name)
    || name.includes("electrocardiogram") || name.includes("electro-cardiogram");
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const DoctorOrder = require("../models/Doctor/DoctorOrderModel");
  const Patient = require("../models/Patient/patientModel");
  const Admission = require("../models/Patient/admissionModel");
  const ECGRegister = require("../models/Compliance/ECGRegisterModel");
  const { emitECG } = require("../services/Compliance/nabhRegisterEmitter");

  const orders = await DoctorOrder.find({ orderType: { $in: ["Investigation", "Lab"] } })
    .select("_id patientId admissionId orderType orderDetails orderedAt createdAt indication notes")
    .lean();
  const ecgOrders = orders.filter((o) => isEcgName(o.orderDetails || {}));
  console.log(`Scanned ${orders.length} investigation/lab orders — ${ecgOrders.length} are ECG orders.`);

  let created = 0, skipped = 0, failed = 0;
  for (const order of ecgOrders) {
    const existing = await ECGRegister.findOne({ doctorOrderId: order._id }).lean();
    if (existing) { skipped++; continue; }
    if (DRY) { created++; continue; }

    const details = order.orderDetails || {};
    const patient = order.patientId
      ? await Patient.findById(order.patientId).select("_id UHID fullName name age gender sex").lean()
      : null;
    const admission = order.admissionId
      ? await Admission.findById(order.admissionId).select("_id admissionNumber wardName ward").lean()
      : null;
    if (!patient) { failed++; console.warn(`  ⚠️  order ${order._id} — patient missing, skipped`); continue; }

    // Same payload shape as the live auto-emit in doctorOrderRoutes.
    const row = await emitECG({
      patient, admission,
      ecg: {
        orderedAt: order.orderedAt || order.createdAt || new Date(),
        performedAt: order.orderedAt || order.createdAt || new Date(),
        indication: details.indication || order.indication || order.notes || details.diagnosis || "",
        indicationCategory: details.indicationCategory || "Other",
        location: admission?.wardName || admission?.ward || "Ward",
        leadType: details.leadType || "12-lead",
        sourceType: "DoctorOrder",
        doctorOrderId: order._id,
      },
      actor: { fullName: "Backfill (REG-V)", role: "System" },
    });
    if (row) created++;
    else { failed++; console.warn(`  ⚠️  order ${order._id} — emitECG returned null`); }
  }

  console.log(`${DRY ? "[DRY RUN] would create" : "Created"} ${created} · skipped (already present) ${skipped} · failed ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
