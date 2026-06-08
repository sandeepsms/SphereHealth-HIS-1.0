// services/Clinical/intakeOutputService.js
// ════════════════════════════════════════════════════════════════════
// R7bq-3 / R7bq-4 — Helpers for writing + reading IntakeOutputEntry.
//
// All writers are non-throwing — they log and swallow errors so the
// caller (marController.recordAdministration, infusion cron) never
// fails the parent action because of an I/O ledger hiccup. NABH MOM.4
// expects best-effort logging, not a hard dependency.
// ════════════════════════════════════════════════════════════════════
const mongoose = require("mongoose");
const IntakeOutputEntry = require("../../models/Clinical/IntakeOutputEntryModel");
const { logErr } = require("../../utils/logErr");

/**
 * Resolve admissionId from one of the identifiers the caller might
 * have. Order falls back UHID → admissionNumber → ipdNo so we still
 * stamp the row even if the upstream code didn't pre-resolve it.
 *
 * Returns the ObjectId or null.
 */
async function resolveAdmissionId({ admissionId, UHID, ipdNo, admissionNumber }) {
  if (admissionId && mongoose.isValidObjectId(admissionId)) return admissionId;
  if (!UHID && !ipdNo && !admissionNumber) return null;
  try {
    const Admission = mongoose.model("Admission");
    const q = { status: "Active" };
    if (UHID) q.UHID = UHID;
    else if (admissionNumber) q.admissionNumber = admissionNumber;
    else if (ipdNo) q.ipdNo = ipdNo;
    const admission = await Admission.findOne(q).select("_id").lean();
    return admission?._id || null;
  } catch (e) {
    logErr("intakeOutputService", "resolveAdmissionId")(e);
    return null;
  }
}

/**
 * R7bq-3 — Record a MAR-driven intake.
 * Called from marController.recordAdministration when status="GIVEN"
 * and the order carries orderDetails.dilutionVolume > 0.
 *
 * @param {Object} args
 * @param {Object} args.order        — DoctorOrder doc (lean OK)
 * @param {Object} args.adminRow     — administrationRecord entry just written
 * @param {String} args.doseId       — _id of the adminRow (for dedupe)
 * @returns {Promise<Object|null>}   — created entry doc, or null on no-op
 */
async function recordIntakeFromMAR({ order, adminRow, doseId }) {
  const dose = order?.orderDetails?.dilutionVolume;
  if (!dose || dose <= 0) return null;          // nothing to log
  if (adminRow?.status !== "given" && adminRow?.status !== "GIVEN") return null;

  const admissionId = await resolveAdmissionId({
    UHID: order.UHID,
    ipdNo: order.visitId,
    admissionNumber: order.visitId,
  });
  if (!admissionId) return null;

  const fluid = order.orderDetails?.dilutionFluid || "NS 0.9%";
  const overMin = order.orderDetails?.infuseOverMinutes;
  const drug = order.orderDetails?.medicineName || "Medication";
  const dosed = order.orderDetails?.dose || "";

  const label =
    `${drug}${dosed ? " " + dosed : ""} in ${dose} ml ${fluid}` +
    (overMin > 0 ? ` over ${overMin} min` : "");

  try {
    const entry = await IntakeOutputEntry.findOneAndUpdate(
      {
        source: "MAR",
        "meta.orderId": order._id,
        "meta.doseId": doseId,
      },
      {
        $setOnInsert: {
          admissionId,
          UHID: order.UHID,
          patientName: order.patientName || "",
          direction: "IN",
          ts: adminRow.givenAt || adminRow.actualTime || new Date(),
          volumeML: dose,
          fluidType: fluid,
          source: "MAR",
          sourceRefType: "DoctorOrder",
          sourceRefId: order._id,
          label,
          recordedBy: {
            name: adminRow.givenBy || adminRow.nurseName || "Nurse",
            role: adminRow.givenByRole || "Nurse",
          },
          meta: {
            orderId: order._id,
            doseId,
            drugName: drug,
            scheduledTime: adminRow.scheduledTime || "",
            infuseOverMinutes: overMin || null,
          },
        },
      },
      { upsert: true, new: true }
    );
    return entry;
  } catch (e) {
    // Dedupe-collision is fine — it means the dose was already logged.
    if (e?.code === 11000) return null;
    logErr("intakeOutputService", `recordIntakeFromMAR order=${order._id} dose=${doseId}`)(e);
    return null;
  }
}

/**
 * R7bq-4 — Record one hour-bucket worth of intake from a running
 * infusion. Called by the 1h cron sweep.
 *
 * `hourBucket` should be an ISO string truncated to the hour
 * ("2026-05-23T19:00:00.000Z") so we can `upsert` idempotently.
 */
async function recordHourlyInfusionIntake({ order, hourBucket, ratePerHour, admissionIdHint }) {
  const ml = Number(ratePerHour);
  if (!ml || ml <= 0) return null;
  if (!order || !order._id) return null;

  const admissionId = admissionIdHint || await resolveAdmissionId({
    UHID: order.UHID,
    ipdNo: order.visitId,
    admissionNumber: order.visitId,
  });
  if (!admissionId) return null;

  // R7hr-137 — IV infusion orderDetails actually carry `fluidName` +
  // `displayName` (set by InfusionPanel + R7hr-97 IA fan-out). Pre-fix
  // we only read medicineName/fluidType — neither of which the producer
  // writes — so every auto-hourly row collapsed to "IV Fluid" in the
  // patient panel I/O ledger. NABH MOM.4 expects the I/O label to
  // identify the actual fluid (so a surveyor can reconcile intake
  // against the bag administered). Read the producer fields first;
  // legacy fallback kept for older rows.
  const fluid = order.orderDetails?.fluidName
              || order.orderDetails?.displayName
              || order.orderDetails?.medicineName
              || order.orderDetails?.fluidType
              || "IV Fluid";
  const additives = order.orderDetails?.additives || "";
  const route     = order.orderDetails?.route || "";
  // R7hr-137 — Notes line now carries the rate + route context so the
  // I/O row is self-describing without having to cross-reference the
  // infusion card. Pre-fix the Notes column was always empty.
  const noteParts = [];
  if (route)     noteParts.push(`Route: ${route}`);
  if (additives) noteParts.push(`Additives: ${additives}`);
  noteParts.push(`Rate: ${ml} ml/hr`);
  const notes = noteParts.join(" · ");
  const label =
    `${fluid}${additives ? " + " + additives : ""} — ${ml} ml/hr (auto-hourly)`;

  try {
    const entry = await IntakeOutputEntry.findOneAndUpdate(
      {
        source: "INFUSION_CRON",
        "meta.orderId": order._id,
        "meta.hourBucket": hourBucket,
      },
      {
        $setOnInsert: {
          admissionId,
          UHID: order.UHID,
          patientName: order.patientName || "",
          direction: "IN",
          ts: new Date(hourBucket),
          volumeML: ml,
          fluidType: fluid,
          source: "INFUSION_CRON",
          sourceRefType: "DoctorOrder",
          sourceRefId: order._id,
          label,
          notes,
          // R7hr-137 — "SYSTEM" was technically true but unhelpful at
          // bedside. A nurse reading the row needs to know WHY it's
          // there without cross-referencing the audit log. "Treatment
          // Chart (auto-hourly)" makes the source self-explanatory.
          recordedBy: { name: "Treatment Chart (auto-hourly)", role: "System" },
          meta: {
            orderId: order._id,
            hourBucket,
            ratePerHour: ml,
            additives,
            route,
          },
        },
      },
      { upsert: true, new: true }
    );
    return entry;
  } catch (e) {
    if (e?.code === 11000) return null;          // already recorded this hour
    logErr("intakeOutputService", `recordHourlyInfusionIntake order=${order._id} bucket=${hourBucket}`)(e);
    return null;
  }
}

/**
 * Add a manual entry (nurse "Intake / Output" chip submission).
 */
async function recordManualEntry({ admissionId, UHID, patientName, direction, volumeML, fluidType, label, notes, recordedBy, ts }) {
  if (!admissionId || !UHID || !direction || volumeML == null) {
    throw new Error("admissionId, UHID, direction and volumeML are required");
  }
  return IntakeOutputEntry.create({
    admissionId,
    UHID,
    patientName: patientName || "",
    direction,
    ts: ts || new Date(),
    volumeML: Number(volumeML),
    fluidType: fluidType || "",
    source: "MANUAL",
    label: label || "",
    notes: notes || "",
    recordedBy: recordedBy || { name: "Nurse", role: "Nurse" },
  });
}

/**
 * Range read for the I/O chart UI / print template.
 *
 * Returns rows sorted by ts ascending so the day grid renders top to
 * bottom in chronological order, plus pre-computed totals for the
 * KPI strip.
 */
async function listForAdmission({ admissionId, from, to }) {
  if (!admissionId) return { rows: [], totals: { in: 0, out: 0, net: 0 } };
  const q = { admissionId, voided: { $ne: true } };
  if (from || to) {
    q.ts = {};
    if (from) q.ts.$gte = new Date(from);
    if (to)   q.ts.$lte = new Date(to);
  }
  const rows = await IntakeOutputEntry.find(q).sort({ ts: 1 }).lean();
  const totals = rows.reduce(
    (acc, r) => {
      if (r.direction === "IN") acc.in += Number(r.volumeML) || 0;
      else                       acc.out += Number(r.volumeML) || 0;
      return acc;
    },
    { in: 0, out: 0 }
  );
  totals.net = totals.in - totals.out;
  return { rows, totals };
}

/**
 * Void a row (auto-entries can be corrected without losing audit).
 */
async function voidEntry({ id, voidedBy, reason }) {
  if (!mongoose.isValidObjectId(id)) throw new Error("Invalid id");
  return IntakeOutputEntry.findByIdAndUpdate(
    id,
    { $set: { voided: true, voidedBy: voidedBy || "", voidedAt: new Date(), voidReason: reason || "" } },
    { new: true }
  );
}

module.exports = {
  resolveAdmissionId,
  recordIntakeFromMAR,
  recordHourlyInfusionIntake,
  recordManualEntry,
  listForAdmission,
  voidEntry,
};
