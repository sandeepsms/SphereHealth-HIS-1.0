/**
 * nabhRegisterEmitter.js — R7bo / NABH AAC.4 + AAC.7
 *
 * Centralised auto-population for NABH compliance registers. Mirrors the
 * existing autoBillingService event-driven pattern: each emit*() call is
 * non-blocking (never throws upstream) and writes the register row atomically.
 *
 * Discovery: explicit emit calls from controllers / services so call sites
 * are greppable. Mongoose post-save hooks were considered but rejected — the
 * codebase uses findOneAndUpdate in many places and would silently skip the
 * hook, masking gaps from NABH surveyors.
 *
 * Current handlers:
 *   - emitBloodSugar({ patient, reading, source, actor })
 *       NABH RBS register — every BG reading in the facility.
 *   - emitEmergency({ visit, actor })
 *       NABH Emergency register — every ER arrival.
 *   - emitEmergencyTriage({ visit, actor })
 *       Updates door-to-triage minutes on the existing register row.
 *   - emitEmergencyDisposition({ visit, actor })
 *       Updates disposition + locks the row.
 *   - emitBloodTransfusion({ order, patient, admission, actor })
 *       NABH Blood Transfusion register — draft row on transfusion order.
 *
 * Every call is `await`able but the caller should treat failure as
 * non-fatal — register writes must never roll back primary clinical work.
 */
"use strict";

const BloodSugarRegister = require("../../models/Compliance/BloodSugarRegisterModel");
const EmergencyRegister  = require("../../models/Compliance/EmergencyRegisterModel");
const BloodTransfusionRegister = require("../../models/Compliance/BloodTransfusionRegisterModel");
const { nextSequence } = require("../../utils/counter");

const _CRIT_LOW  = Number(process.env.RBS_CRITICAL_LOW  || 70);
const _CRIT_HIGH = Number(process.env.RBS_CRITICAL_HIGH || 300);

function _actor(actor = {}) {
  return {
    byUserId: actor._id || actor.id || actor.userId || null,
    byName:   actor.fullName || actor.name || actor.byName || "",
    byRole:   actor.role || actor.byRole || "",
  };
}

function _safeYear() {
  try {
    const tz = process.env.HOSPITAL_TZ || "Asia/Kolkata";
    return Number(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(new Date()));
  } catch (_) {
    return new Date().getFullYear();
  }
}

function _diffMinutes(later, earlier) {
  if (!later || !earlier) return null;
  const ms = new Date(later).getTime() - new Date(earlier).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 60000));
}

// ─────────────────────────────────────────────────────────────────────────
// Blood Sugar Register
// ─────────────────────────────────────────────────────────────────────────

/**
 * Emit a blood-sugar reading into the NABH RBS register.
 * @param {object} args
 * @param {object} args.patient   — { _id, UHID, fullName/name, age, sex }
 * @param {object} [args.admission] — { _id, admissionNumber }
 * @param {object} args.reading   — { value, unit, type, sampleType, takenAt,
 *                                    location, notes, sourceRef, sourceType }
 * @param {object} [args.insulin] — { type, dose, route, marId }
 * @param {object} [args.actor]   — req.user
 */
async function emitBloodSugar(args = {}) {
  try {
    const { patient = {}, admission = null, reading = {}, insulin = null, actor = {} } = args;
    if (!patient._id || !patient.UHID) return null;
    if (reading.value == null || reading.value === "") return null;

    const value = Number(reading.value);
    if (!Number.isFinite(value) || value <= 0) return null;

    const unit = reading.unit || "mg/dL";
    // Normalise mmol/L to mg/dL for the critical-flag check (1 mmol/L ≈ 18 mg/dL)
    const valueMgDl = unit === "mmol/L" ? Math.round(value * 18) : value;
    const criticalFlag = valueMgDl < _CRIT_LOW || valueMgDl > _CRIT_HIGH;

    const actorMeta = _actor(actor);
    const row = await BloodSugarRegister.create({
      patientId: patient._id,
      UHID: patient.UHID,
      patientName: patient.fullName || patient.name || "",
      age: patient.age || null,
      sex: patient.gender || patient.sex || "",
      admissionId: admission?._id || null,
      admissionNumber: admission?.admissionNumber || "",
      readingValue: value,
      readingUnit: unit,
      readingType: reading.type || "RBS",
      sampleType: reading.sampleType || "capillary",
      takenAt: reading.takenAt ? new Date(reading.takenAt) : new Date(),
      insulinGiven: !!insulin,
      insulinType: insulin?.type || "",
      insulinDose: insulin?.dose || null,
      insulinRoute: insulin?.route || "",
      marId: insulin?.marId || null,
      location: reading.location || "Ward",
      criticalFlag,
      takenBy: actorMeta.byUserId,
      takenByName: actorMeta.byName,
      takenByRole: actorMeta.byRole,
      sourceRef: reading.sourceRef || null,
      sourceType: reading.sourceType || "Manual",
      notes: reading.notes || "",
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        reason: `source=${reading.sourceType || "Manual"}`,
      }, ...(criticalFlag ? [{
        action: "CRITICAL_FLAGGED",
        at: new Date(),
        ...actorMeta,
        reason: `value=${value}${unit} threshold=${_CRIT_LOW}-${_CRIT_HIGH}`,
      }] : [])],
    });
    return row;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitBloodSugar:", e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Emergency Register
// ─────────────────────────────────────────────────────────────────────────

async function _generateErNumber() {
  const year = _safeYear();
  const seq = await nextSequence(`ER-REG:${year}`);
  return `ER-${year}-${String(seq).padStart(6, "0")}`;
}

/**
 * Emit an ER arrival into the NABH Emergency register. Called from
 * emergencyController.createEmergencyVisit after the visit row is persisted.
 */
async function emitEmergency(args = {}) {
  try {
    const { visit, actor = {} } = args;
    if (!visit || !visit._id || !visit.UHID || !visit.patientId) return null;

    // Idempotency: don't double-write if already registered
    const existing = await EmergencyRegister.findOne({ emergencyId: visit._id }).lean();
    if (existing) return existing;

    const erNumber = await _generateErNumber();
    const actorMeta = _actor(actor);
    const row = await EmergencyRegister.create({
      erNumber,
      patientId: visit.patientId,
      UHID: visit.UHID,
      patientName: visit.patientName || "",
      age: visit.age || null,
      sex: visit.gender || "",
      contactNumber: visit.contactNumber || "",
      emergencyId: visit._id,
      emergencyNumber: visit.emergencyNumber || "",
      arrivalAt: visit.arrivalDate ? new Date(visit.arrivalDate) : new Date(),
      triageAt: visit.triageTime ? new Date(visit.triageTime) : null,
      doorToTriageMinutes: _diffMinutes(visit.triageTime, visit.arrivalDate),
      triageCategory: visit.triageCategory || "Urgent",
      presentingComplaint: visit.presentingComplaints || "",
      modeOfArrival: visit.arrivalMode || "Walk-in",
      consultantIncharge: visit.consultantIncharge || "",
      attendingDoctorId: visit.attendingDoctorId || null,
      isMLC: !!visit.isMLC,
      mlcNumber: visit.mlcNumber || "",
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `triage=${visit.triageCategory || "?"}`,
      }],
    });
    return row;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitEmergency:", e.message);
    return null;
  }
}

async function emitEmergencyTriage(args = {}) {
  try {
    const { visit, actor = {} } = args;
    if (!visit?._id) return null;
    const row = await EmergencyRegister.findOne({ emergencyId: visit._id });
    if (!row) return null;
    if (row.locked) return row;

    const triageAt = visit.triageTime ? new Date(visit.triageTime) : new Date();
    row.triageAt = triageAt;
    row.triageCategory = visit.triageCategory || row.triageCategory;
    row.doorToTriageMinutes = _diffMinutes(triageAt, row.arrivalAt);
    row.auditTrail.push({ action: "TRIAGED", at: new Date(), ..._actor(actor), notes: `category=${row.triageCategory}` });
    await row.save();
    return row;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitEmergencyTriage:", e.message);
    return null;
  }
}

async function emitEmergencyDisposition(args = {}) {
  try {
    const { visit, actor = {}, disposition, admissionLinkId, referredTo, notes } = args;
    if (!visit?._id || !disposition) return null;
    const row = await EmergencyRegister.findOne({ emergencyId: visit._id });
    if (!row) return null;
    if (row.locked) return row;

    const at = new Date();
    row.disposition = disposition;
    row.dispositionAt = at;
    row.doorToDispositionMinutes = _diffMinutes(at, row.arrivalAt);
    if (admissionLinkId) row.admissionLinkId = admissionLinkId;
    if (referredTo) row.referredTo = referredTo;
    if (notes) row.dispositionNotes = notes;
    row.locked = true;
    row.lockedAt = at;
    row.auditTrail.push({ action: "DISPOSITION_SET", at, ..._actor(actor), notes: `disposition=${disposition}` });
    row.auditTrail.push({ action: "LOCKED", at, ..._actor(actor), notes: "auto-lock on disposition" });
    await row.save();
    return row;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitEmergencyDisposition:", e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Blood Transfusion Register
// ─────────────────────────────────────────────────────────────────────────

async function _generateBtNumber() {
  const year = _safeYear();
  const seq = await nextSequence(`BTR:${year}`);
  return `BTR-${year}-${String(seq).padStart(6, "0")}`;
}

/**
 * Emit a blood-transfusion draft row when a doctor orders transfusion.
 * Caller passes the DoctorOrder document + patient/admission context.
 */
async function emitBloodTransfusion(args = {}) {
  try {
    const { order, patient = {}, admission = null, actor = {} } = args;
    if (!order?._id || !patient._id || !patient.UHID) return null;

    // Idempotency: one register row per doctor order
    const existing = await BloodTransfusionRegister.findOne({ doctorOrderId: order._id }).lean();
    if (existing) return existing;

    const btNumber = await _generateBtNumber();
    const actorMeta = _actor(actor);
    const row = await BloodTransfusionRegister.create({
      btNumber,
      patientId: patient._id,
      UHID: patient.UHID,
      patientName: patient.fullName || patient.name || "",
      age: patient.age || null,
      sex: patient.gender || patient.sex || "",
      admissionId: admission?._id || null,
      admissionNumber: admission?.admissionNumber || "",
      ward: admission?.ward || admission?.wardName || "",
      doctorOrderId: order._id,
      requestedByUserId: actorMeta.byUserId,
      requestedByName: actorMeta.byName || order.orderedByName || "",
      requestedAt: order.orderedAt || order.createdAt || new Date(),
      indication: order.indication || order.notes || order.description || "",
      bloodGroup: order.bloodGroup || patient.bloodGroup || "Unknown",
      rhFactor: order.rhFactor || "",
      unitsRequested: order.units || order.quantity || 1,
      status: "Draft",
      auditTrail: [{
        action: "ORDERED",
        at: new Date(),
        ...actorMeta,
        notes: `units=${order.units || order.quantity || 1} group=${order.bloodGroup || "?"}`,
      }],
    });
    return row;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitBloodTransfusion:", e.message);
    return null;
  }
}

module.exports = {
  emitBloodSugar,
  emitEmergency,
  emitEmergencyTriage,
  emitEmergencyDisposition,
  emitBloodTransfusion,
};
