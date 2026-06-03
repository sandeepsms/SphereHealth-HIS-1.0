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
const PainAssessmentRegister  = require("../../models/Compliance/PainAssessmentRegisterModel");
const FallRiskRegister        = require("../../models/Compliance/FallRiskRegisterModel");
const PressureUlcerRegister   = require("../../models/Compliance/PressureUlcerRegisterModel");
const DVTRegister             = require("../../models/Compliance/DVTRegisterModel");
// R7en — ECG register (NABH AAC.4 + IPSG.2 + COP.7)
const ECGRegister             = require("../../models/Compliance/ECGRegisterModel");
// R7bu — six new NABH registers (COP.10/13/16/17/18 + MOM.7)
const OTRegister               = require("../../models/Compliance/OTRegisterModel");
const ASARegister              = require("../../models/Compliance/ASARegisterModel");
const ReadmissionRegister      = require("../../models/Compliance/ReadmissionRegisterModel");
const MortalityRegister        = require("../../models/Compliance/MortalityRegisterModel");
const RestraintRegister        = require("../../models/Compliance/RestraintRegisterModel");
const AntimicrobialUseRegister = require("../../models/Compliance/AntimicrobialUseRegisterModel");
const Admission               = require("../../models/Patient/admissionModel");
const { nextSequence } = require("../../utils/counter");

// ─────────────────────────────────────────────────────────────────────────
// R7bw — Canonical admission resolver
// ─────────────────────────────────────────────────────────────────────────
// Pre-R7bw: register emitters trusted the admissionId passed by the caller.
// But when the dedupe script (R7bq-A) merges duplicate active admissions, the
// frontend page may still carry the stale loser admissionId in component
// state. The nurse saves a Fall-Risk / DVT assessment, the route forwards
// that stale id, and the register row gets linked to a Cancelled admission —
// so NABH dashboards filtered by "Active admissionId" miss the row.
//
// Resolution: always look up the patient's CURRENT canonical active admission
// by UHID. Fall back to the caller's id only if no active admission exists
// (e.g. the patient was discharged between form-load and form-submit, in
// which case the historical id is still meaningful).
async function _resolveCanonicalAdmissionId(UHID, callerSupplied = null) {
  if (!UHID) return callerSupplied || null;
  try {
    const adm = await Admission.findOne({ UHID, status: "Active" })
      .select("_id")
      .lean();
    if (adm?._id) return adm._id;
  } catch (_) { /* non-fatal — fall through */ }
  return callerSupplied || null;
}

const _CRIT_LOW  = Number(process.env.RBS_CRITICAL_LOW  || 70);
const _CRIT_HIGH = Number(process.env.RBS_CRITICAL_HIGH || 300);

function _actor(actor = {}) {
  return {
    byUserId: actor._id || actor.id || actor.userId || null,
    byName:   actor.fullName || actor.name || actor.byName || "",
    byRole:   actor.role || actor.byRole || "",
  };
}

// R7bx-3 — Some legacy clinical models (notably DoctorOrder.orderedBy) carry
// either an ObjectId reference OR a free-form name string in the same field,
// because two generations of frontend code populated it differently. Register
// models that ref User on those linkage fields refuse a string value with a
// BSONError on save. Coerce to ObjectId or null — never let a bad string
// abort the register write.
const _mongooseSafe = require("mongoose");
function _asObjectId(v) {
  if (!v) return null;
  if (typeof v === "object" && v._bsontype === "ObjectID") return v;
  if (typeof v === "object" && v._id) return _mongooseSafe.isValidObjectId(v._id) ? v._id : null;
  if (typeof v === "string") return _mongooseSafe.isValidObjectId(v) ? v : null;
  return null;
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
    // R7bw — resolve canonical active admission so the row links to the
    // KEEPER admission even if the caller is still holding a stale id.
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(patient.UHID, admission?._id || null);
    const row = await BloodSugarRegister.create({
      patientId: patient._id,
      UHID: patient.UHID,
      patientName: patient.fullName || patient.name || "",
      age: patient.age || null,
      sex: patient.gender || patient.sex || "",
      admissionId: canonicalAdmissionId,
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
    // R7bn-6 / D2-fix: stamp door-to-doctor metrics + police info on
    // creation, not just on disposition. NABH AAC.1 surveyors want
    // these in the row from the start. firstSeenByDoctorAt defaults
    // to triageAt when not separately recorded (typical small-ER
    // workflow); doorToDoctorMinutes is the same diff vs arrival.
    const arrivalAt = visit.arrivalDate ? new Date(visit.arrivalDate) : new Date();
    const triageAt = visit.triageTime ? new Date(visit.triageTime) : null;
    const firstSeenByDoctorAt = visit.firstSeenByDoctorAt
      ? new Date(visit.firstSeenByDoctorAt)
      : triageAt;

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
      arrivalAt,
      triageAt,
      doorToTriageMinutes: _diffMinutes(triageAt, arrivalAt),
      firstSeenByDoctorAt,
      doorToDoctorMinutes: _diffMinutes(firstSeenByDoctorAt, arrivalAt),
      triageCategory: visit.triageCategory || "Urgent",
      presentingComplaint: visit.presentingComplaints || "",
      modeOfArrival: visit.arrivalMode || "Walk-in",
      consultantIncharge: visit.consultantIncharge || "",
      attendingDoctorId: visit.attendingDoctorId || null,
      isMLC: !!visit.isMLC,
      mlcNumber: visit.mlcNumber || "",
      // R7bn-6 / D2-fix: police info — required when isMLC=true so the
      // disposition step can verify the case is properly registered.
      policeStation:  visit.policeStation  || "",
      policeOfficer:  visit.policeOfficer  || "",
      policeFIRNo:    visit.policeFIRNo    || "",
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `triage=${visit.triageCategory || "?"}`,
      }],
    });
    return row;
  } catch (e) {
    // R7bn-6 / D2-fix: silent-catch was masking real validation
    // errors (missing UHID / unknown enum). Log to stderr so an
    // operator monitoring the backend can see emit failures and
    // investigate — the calling clinical write already succeeded.
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitEmergency FAILED:", e.message, "— visitId:", args?.visit?._id);
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
    // R7bw — resolve canonical active admission for accurate NABH MOM.4 linkage.
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(patient.UHID, admission?._id || null);

    // R7gv / B6-T09-B — Verify that the claimed consentFormId actually
    // resolves to a Signed/Biometric-Verified ConsentForm before we stamp
    // consentSigned=true on the BT row. Pre-fix the flag was trusted blind,
    // so a frontend bug or a hand-rolled API call could record a transfusion
    // as consented without a real signed consent document.
    const preTransfusion = order?.preTransfusion;
    if (preTransfusion?.consentSigned === true && preTransfusion?.consentFormId) {
      try {
        const ConsentForm = require('../../models/Clinical/ConsentFormModel');
        const cf = await ConsentForm.findById(preTransfusion.consentFormId).select('_id status').lean();
        if (!cf || !['Signed', 'Biometric-Verified'].includes(cf.status)) {
          const err = new Error('BT_CONSENT_NOT_FOUND or unsigned: consentFormId did not resolve to a Signed/Biometric-Verified ConsentForm');
          err.code = 'BT_CONSENT_NOT_FOUND';
          throw err;
        }
      } catch (e) {
        if (e.code === 'BT_CONSENT_NOT_FOUND') throw e;
        // model lookup error — log and continue (defensive)
        console.warn('[emitBloodTransfusion] consent verify lookup failed (non-fatal):', e.message);
      }
    }

    const row = await BloodTransfusionRegister.create({
      btNumber,
      patientId: patient._id,
      UHID: patient.UHID,
      patientName: patient.fullName || patient.name || "",
      age: patient.age || null,
      sex: patient.gender || patient.sex || "",
      admissionId: canonicalAdmissionId,
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
      // R7bn-6 / D2-fix: consentSigned + preTransfusion vitals stamped
      // at order time so the post-tx audit can verify NABH MOM.4 pre-
      // checks. Frontend doctor-order form pushes these via `order.preTransfusion`.
      // R7em-D-FIX: BT model nests pre-tx vitals under .vitals (VitalsSchema),
      // not flat. Earlier shape silently dropped bp/pulse/temp/spo2 because
      // Mongoose strict mode rejected unknown top-level keys.
      preTransfusion: {
        consentSigned: !!order?.preTransfusion?.consentSigned,
        consentFormId: order?.preTransfusion?.consentFormId || "",
        vitals: {
          bp:    order?.preTransfusion?.bp    || "",
          pulse: order?.preTransfusion?.pulse || null,
          temp:  order?.preTransfusion?.temp  || null,
          spo2:  order?.preTransfusion?.spo2  || null,
        },
      },
      status: "Draft",
      auditTrail: [{
        action: "ORDERED",
        at: new Date(),
        ...actorMeta,
        notes: `units=${order.units || order.quantity || 1} group=${order.bloodGroup || "?"} consent=${!!order?.preTransfusion?.consentSigned}`,
      }],
    });
    return row;
  } catch (e) {
    // R7bn-6 / D2-fix: log the order id so an operator can correlate
    // the failed emit back to the originating clinical write.
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitBloodTransfusion FAILED:", e.message, "— orderId:", args?.order?._id);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Pain Assessment Register (R7bp — auto-pop from NursingAssessment type=pain)
// ─────────────────────────────────────────────────────────────────────────

function _painSeverity(score) {
  const n = Number(score);
  if (!Number.isFinite(n) || n <= 0) return "None";
  if (n <= 3) return "Mild";
  if (n <= 6) return "Moderate";
  return "Severe";
}

// R7el-2: Auto-derive next pain reassessment window from severity. NABH
// IPSG.5: severe pain after parenteral analgesia → reassess in 30 min;
// moderate → 1 h; mild → 4 h; no pain → no scheduled reassessment.
function _painReassessmentDue(severity, baseAt = new Date()) {
  const base = new Date(baseAt);
  const mins = severity === "Severe" ? 30
             : severity === "Moderate" ? 60
             : severity === "Mild" ? 240
             : 0;
  if (!mins) return null;
  const d = new Date(base.getTime() + mins * 60 * 1000);
  return d;
}

async function emitPain(args = {}) {
  try {
    const { assessment, actor = {} } = args;
    if (!assessment?._id || !assessment?.UHID) return null;
    const data = assessment.data || {};
    // R7em-1: PainAssessmentPage.jsx posts `nrsScore` (not `painScale`).
    // Accept both so legacy callers and the live form both work; `??` (not
    // `||`) preserves 0 = "No Pain" as a valid value.
    const score = Number(data.painScale ?? data.nrsScore);
    if (!Number.isFinite(score)) return null;

    const severity = _painSeverity(score);
    const escalated = score >= 7;
    const actorMeta = _actor(actor);
    // R7bw — resolve canonical active admission so stale form-state can't
    // strand the row on a dedupe-cancelled admission (NABH IPSG cohort).
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(assessment.UHID, assessment.admissionId || null);
    const assessedAtVal = assessment.recordedAt || new Date();
    // R7el-2: derive reassessmentDue from severity if the form didn't
    // explicitly set it. Surveyors check that severe pain has a follow-up
    // entry within the reassessment window — automating this means the
    // window is never left blank.
    const reassessmentDue = data.reassessmentDue
      ? new Date(data.reassessmentDue)
      : _painReassessmentDue(severity, assessedAtVal);

    // R7em-1: Frontend posts arrays for location/character (PillSelect
    // multi-select) and a separate analgesicDrug/Dose/Route trio for the
    // intervention. Normalise to the register's string-shaped columns.
    const siteStr      = Array.isArray(data.site) ? data.site.join(", ")
                       : Array.isArray(data.location) ? data.location.join(", ")
                       : (data.site || data.location || "");
    const characterStr = Array.isArray(data.character) ? data.character.join(", ")
                       : (data.character || "");
    // R7em-1: intervention = explicit field OR derived from analgesic trio.
    const interventionStr = data.intervention
      || [data.analgesicDrug, data.analgesicDose, data.analgesicRoute].filter(Boolean).join(" ")
      || "";

    const row = await PainAssessmentRegister.create({
      patientId: assessment.patientId || null,
      UHID: assessment.UHID,
      patientName: assessment.patientName || "",
      admissionId: canonicalAdmissionId,
      painScale: score,
      severity,
      scaleUsed: data.scaleUsed || "NRS",
      site: siteStr,                                          // R7em-1: array→string
      character: characterStr,                                // R7em-1: array→string
      durationMinutes: data.durationMinutes || null,
      intervention: interventionStr,                          // R7em-1: alias analgesic trio
      reassessmentDue,
      assessedAt: assessedAtVal,
      assessedBy: assessment.recordedBy || actorMeta.byName || "",
      assessedByUserId: assessment.recordedByUser || actorMeta.byUserId,
      assessedByRole: actorMeta.byRole,
      sourceRef: assessment._id,
      escalatedFlag: escalated,
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
      }, ...(escalated ? [{ action: "ESCALATED", at: new Date(), ...actorMeta }] : [])],
    });
    return row;
  } catch (e) {
    console.error("[nabhRegisterEmitter] emitPain:", e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Fall Risk Register (auto-pop from NursingAssessment type=fall-risk)
// ─────────────────────────────────────────────────────────────────────────

function _morseRiskTier(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "Low";
  if (n >= 45) return "High";
  if (n >= 25) return "Moderate";
  return "Low";
}

// R7el-2: Auto-suggest the standard fall-precaution bundle keyed by risk
// tier (NABH PSQ + IPSG.6). Saves the nurse retyping the same boilerplate
// every shift and ensures the register row never has a blank intervention
// column for a known-risk patient.
const _FALL_BUNDLES = {
  Low: "Standard precautions: bed in low position, call bell within reach, non-slip footwear",
  Moderate: "Yellow wristband + bed rails up + call bell + frequent rounding (q2h) + non-slip footwear",
  High: "Yellow wristband + bed rails up + bed in low position + call bell + fall mat + frequent rounding (q1h) + bedside sitter if confused + post-fall huddle if event occurs",
};

async function emitFallRisk(args = {}) {
  try {
    const { assessment, actor = {} } = args;
    if (!assessment?._id || !assessment?.UHID) return null;
    const data = assessment.data || {};
    // R7em-1: FallRiskAssessmentPage.jsx posts `score` (Morse total) and a
    // nested `scores` object keyed by MORSE_ITEMS fields. Accept both names;
    // `??` keeps 0 as a valid (no-risk) score.
    const score = Number(data.morseScore ?? data.score);
    if (!Number.isFinite(score)) return null;

    const riskTier = _morseRiskTier(score);
    const highRisk = riskTier === "High";
    const actorMeta = _actor(actor);
    // R7bw — resolve canonical active admission so stale form-state can't
    // strand the row on a dedupe-cancelled admission.
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(assessment.UHID, assessment.admissionId || null);
    // R7el-2: auto-fill intervention bundle from tier if the form didn't
    // pass one. Lets surveyors see the actual care plan rather than an
    // empty column.
    const interventionBundle = data.interventionBundle
      || data.actions                                          // R7em-1: FallRiskAssessmentPage posts `actions`
      || _FALL_BUNDLES[riskTier] || "";

    // R7em-1: Morse sub-scores are numeric points (e.g. fallHistory: 25=Yes,
    // 0=No). Read them off data.scores (FallRiskAssessmentPage shape) or off
    // data directly (legacy callers). Accept the IPDInitialAssessment naming
    // (`secondDiagnosis`, `ivAccess`) plus the schema names. >0 = positive.
    const sub = (data.scores && typeof data.scores === "object") ? data.scores : data;
    const _bool = (v) => Number(v) > 0;                        // R7em-1: numeric→boolean
    const historyOfFalling = data.historyOfFalling != null
      ? !!data.historyOfFalling
      : _bool(sub.fallHistory ?? sub.historyOfFalling);
    const secondaryDx = data.secondaryDx != null
      ? !!data.secondaryDx
      : _bool(sub.secondDiagnosis ?? sub.secondaryDx);
    const ivTherapy = data.ivTherapy != null
      ? !!data.ivTherapy
      : _bool(sub.ivAccess ?? sub.ivTherapy);
    // R7em-1: ambulatoryAid/gait/mentalStatus stored as numeric points by
    // FallRiskAssessmentPage. Map back to the schema's free-text columns
    // when only the numeric value is available — keeps the register human-
    // readable even when the form didn't pass the original label.
    const _ambLabel  = (v) => v >= 30 ? "Furniture" : v >= 15 ? "Crutches/Cane/Walker" : v > 0 ? "Other" : "None";
    const _gaitLabel = (v) => v >= 20 ? "Impaired" : v >= 10 ? "Weak" : "Normal";
    const _mentLabel = (v) => v >= 15 ? "Forgets limitations" : "Oriented";
    const ambRaw  = sub.ambulatoryAid;
    const gaitRaw = sub.gait;
    const mentRaw = sub.mentalStatus;
    const ambulatoryAid = (typeof ambRaw === "string" && isNaN(Number(ambRaw))) ? ambRaw
                        : (ambRaw != null) ? _ambLabel(Number(ambRaw)) : "";
    const gait          = (typeof gaitRaw === "string" && isNaN(Number(gaitRaw))) ? gaitRaw
                        : (gaitRaw != null) ? _gaitLabel(Number(gaitRaw)) : "";
    const mentalStatus  = (typeof mentRaw === "string" && isNaN(Number(mentRaw))) ? mentRaw
                        : (mentRaw != null) ? _mentLabel(Number(mentRaw)) : "";

    const row = await FallRiskRegister.create({
      patientId: assessment.patientId || null,
      UHID: assessment.UHID,
      patientName: assessment.patientName || "",
      admissionId: canonicalAdmissionId,
      morseScore: score,
      riskTier,
      historyOfFalling,                                        // R7em-1
      secondaryDx,                                             // R7em-1
      ambulatoryAid,                                           // R7em-1
      ivTherapy,                                               // R7em-1
      gait,                                                    // R7em-1
      mentalStatus,                                            // R7em-1
      interventionBundle,
      assessedAt: assessment.recordedAt || new Date(),
      assessedBy: assessment.recordedBy || data.nurse || actorMeta.byName || "",
      assessedByUserId: assessment.recordedByUser || actorMeta.byUserId,
      assessedByRole: actorMeta.byRole,
      sourceRef: assessment._id,
      highRiskFlag: highRisk,
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
      }, ...(highRisk ? [{ action: "ESCALATED", at: new Date(), ...actorMeta }] : [])],
    });
    // R7gw-B9-T01 — auto-trigger Sentinel-event register when a fall
    // actually occurred AND a major injury was recorded. Non-blocking.
    const fallOccurred = !!(data.fallOccurred || data.fallEvent);
    const majorInjury = !!(data.majorInjury || data.injurySeverity === "Major" || data.injurySeverity === "Severe");
    if (fallOccurred && majorInjury) {
      try {
        await emitSentinelEvent({
          UHID: assessment.UHID,
          patientId: assessment.patientId || null,
          patientName: assessment.patientName || "",
          admissionId: canonicalAdmissionId,
          eventType: "Fall-with-Major-Injury",
          discoveredAt: assessment.recordedAt || new Date(),
          discoveredByEmpId: assessment.recordedBy || actorMeta.byName || "",
          severity: "Critical",
          immediateAction: data.postFallActions || "Post-fall huddle activated; vitals + neuro check; imaging ordered; doctor informed",
          rcaInitiated: false,
          sourceRef: `FallRisk:${row._id}`,
          autoTriggeredFrom: "emitFallRisk",
          actor: actor || {},
        });
      } catch (sentinelErr) {
        console.error("[nabhRegisterEmitter] emitFallRisk → emitSentinelEvent chain failed:", sentinelErr.message);
      }
    }
    return row;
  } catch (e) {
    console.error("[nabhRegisterEmitter] emitFallRisk:", e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Pressure Ulcer Register (auto-pop from NursingAssessment type=pressure-area)
// ─────────────────────────────────────────────────────────────────────────

function _bradenRiskTier(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "No Risk";
  if (n <= 9) return "Severe";
  if (n <= 12) return "High";
  if (n <= 14) return "Moderate";
  if (n <= 18) return "Mild";
  return "No Risk";
}

// R7el-3: Auto-suggest repositioning frequency per Braden tier (NPUAP /
// NABH HIC.4). Severe risk needs q1-2h with offloading; High q2h with
// pressure mattress; Moderate q2-4h; Mild ambulate q4h; No Risk standard.
const _BRADEN_REPOSITION = {
  Severe:   "q1-2h with full offload + heel suspension; pressure-redistribution mattress mandatory",
  High:     "q2h turning with 30° lateral tilt; pressure-redistribution mattress",
  Moderate: "q2-4h turning; reassess skin q-shift",
  Mild:     "Ambulate q4h or assist with position change; skin check q-shift",
  "No Risk": "Standard mobility; routine skin check daily",
};

async function emitPressureUlcer(args = {}) {
  try {
    const { assessment, actor = {} } = args;
    if (!assessment?._id || !assessment?.UHID) return null;
    const data = assessment.data || {};
    // R7em-1: PressureAreaCarePage.jsx posts `score` (Braden total). Accept
    // both `bradenScore` (legacy) and `score`; `??` preserves 0 as valid.
    const score = Number(data.bradenScore ?? data.score);
    if (!Number.isFinite(score)) return null;

    const riskTier = _bradenRiskTier(score);
    const ulcerPresent = !!data.ulcerPresent;
    const ulcerStage = String(data.ulcerStage || "");
    const hospitalAcquired = !!data.hospitalAcquired;
    // HAPU stage III or worse = NABH sentinel event
    const sentinel = hospitalAcquired && ["III", "IV", "Unstageable", "DTI"].includes(ulcerStage);
    const actorMeta = _actor(actor);
    // R7bw — resolve canonical active admission so the sentinel event links
    // to the live admission, not a stale id orphaned by dedupe.
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(assessment.UHID, assessment.admissionId || null);
    // R7el-3: auto-suggest care bundle defaults from tier. High/Severe
    // patients automatically get pressureMattress = true and nutritionConsult
    // = true because NABH HIC.4 mandates both for those tiers; nurse can
    // override by passing explicit false in data.
    const isHighRisk = riskTier === "High" || riskTier === "Severe";
    const repositioningFreq = data.repositioningFreq || _BRADEN_REPOSITION[riskTier] || "";
    const pressureMattress = data.pressureMattress != null ? !!data.pressureMattress : isHighRisk;
    const nutritionConsult = data.nutritionConsult != null ? !!data.nutritionConsult : isHighRisk;

    const row = await PressureUlcerRegister.create({
      patientId: assessment.patientId || null,
      UHID: assessment.UHID,
      patientName: assessment.patientName || "",
      admissionId: canonicalAdmissionId,
      bradenScore: score,
      riskTier,
      ulcerPresent,
      ulcerStage,
      ulcerSite: data.ulcerSite || "",
      ulcerSize: data.ulcerSize || "",
      hospitalAcquired,
      repositioningFreq,
      pressureMattress,
      nutritionConsult,
      dressingType: data.dressingType || "",
      assessedAt: assessment.recordedAt || new Date(),
      assessedBy: assessment.recordedBy || actorMeta.byName || "",
      assessedByUserId: assessment.recordedByUser || actorMeta.byUserId,
      assessedByRole: actorMeta.byRole,
      sourceRef: assessment._id,
      sentinelFlag: sentinel,
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
      }],
    });
    // R7gw-B9-T01 — auto-trigger Sentinel-event register when HAPU is
    // stage III+. Non-blocking — the pressure-ulcer write must succeed
    // even if the sentinel emit fails.
    if (sentinel) {
      try {
        await emitSentinelEvent({
          UHID: assessment.UHID,
          patientId: assessment.patientId || null,
          patientName: assessment.patientName || "",
          admissionId: canonicalAdmissionId,
          eventType: "HAPU-stage3-4",
          discoveredAt: assessment.recordedAt || new Date(),
          discoveredByEmpId: assessment.recordedBy || actorMeta.byName || "",
          severity: "Critical",
          immediateAction: `HAPU detected stage ${ulcerStage} at ${data.ulcerSite || "site unknown"}; repositioning bundle activated; wound care + nutrition consult triggered`,
          rcaInitiated: false,
          sourceRef: `PressureUlcer:${row._id}`,
          autoTriggeredFrom: "emitPressureUlcer",
          actor: actor || {},
        });
      } catch (sentinelErr) {
        console.error("[nabhRegisterEmitter] emitPressureUlcer → emitSentinelEvent chain failed:", sentinelErr.message);
      }
    }
    return row;
  } catch (e) {
    console.error("[nabhRegisterEmitter] emitPressureUlcer:", e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DVT / Caprini Register (R7bq — auto-pop from NursingAssessment type=dvt)
// ─────────────────────────────────────────────────────────────────────────

/** Caprini 2010 tier breakpoints. */
function _capriniTier(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "Very Low";
  if (n >= 9) return "Highest";
  if (n >= 5) return "High";
  if (n >= 3) return "Moderate";
  if (n >= 1) return "Low";
  return "Very Low";
}

/** IMPROVE bleed-risk tier (≥7 = high). */
function _improveTier(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "";
  return n >= 7 ? "High" : "Low";
}

/**
 * Caprini × IMPROVE prophylaxis decision matrix. Returns:
 *   { recommendedProphylaxis, recommendedAgent, recommendedDuration, escalated }
 * Encodes the standard 5-tier × 2-bleed-tier guideline (ACCP 9th, IMPROVE
 * 2011). Hard contraindications override pharmacological → mechanical-only.
 */
function _decideProphylaxis({ capriniTier, improveTier, contraindications = [] }) {
  const hasContra = Array.isArray(contraindications) && contraindications.length > 0;
  const highBleed = improveTier === "High" || hasContra;

  switch (capriniTier) {
    case "Very Low":
      return { recommendedProphylaxis: "Ambulation", recommendedAgent: "", recommendedDuration: "" };
    case "Low":
      return { recommendedProphylaxis: "Mechanical", recommendedAgent: "IPC/SCD or graduated compression stockings", recommendedDuration: "Until ambulatory" };
    case "Moderate":
      return highBleed
        ? { recommendedProphylaxis: "Mechanical-only-reassess", recommendedAgent: "IPC/SCD; reassess bleed risk q24h", recommendedDuration: "Until ambulatory" }
        : { recommendedProphylaxis: "Pharmacological", recommendedAgent: "Enoxaparin 40 mg SC OD (or UFH 5000 U SC BD/TDS)", recommendedDuration: "Until ambulatory" };
    case "High":
    case "Highest":
      return highBleed
        ? { recommendedProphylaxis: "Mechanical-only-reassess", recommendedAgent: "IPC/SCD; daily bleed-risk reassessment, start pharmaco when safe", recommendedDuration: "Until bleed risk resolves" }
        : { recommendedProphylaxis: "Combined", recommendedAgent: "Enoxaparin 40 mg SC OD + IPC/SCD (renal-dose 30 mg SC OD if CrCl<30)", recommendedDuration: capriniTier === "Highest" ? "Extended 28-35 days post-op" : "Until ambulatory; extend for major orthopaedic/cancer surgery" };
    default:
      return { recommendedProphylaxis: "Ambulation", recommendedAgent: "", recommendedDuration: "" };
  }
}

async function emitDVT(args = {}) {
  try {
    const { assessment, actor = {} } = args;
    if (!assessment?._id || !assessment?.UHID) return null;
    const data = assessment.data || {};
    const capriniScore = Number(data.capriniScore);
    if (!Number.isFinite(capriniScore)) return null;

    const improveScore = data.improveScore != null ? Number(data.improveScore) : null;
    const capriniTier = _capriniTier(capriniScore);
    const improveTier = improveScore != null ? _improveTier(improveScore) : "";
    const bleedingRiskFlag = improveTier === "High";
    const contraindications = Array.isArray(data.contraindications) ? data.contraindications : [];

    const decision = _decideProphylaxis({ capriniTier, improveTier, contraindications });

    const escalated = capriniTier === "High" || capriniTier === "Highest";
    const actorMeta = _actor(actor);
    const auditTrail = [{ action: "CREATED", at: new Date(), ...actorMeta, notes: `caprini=${capriniScore} tier=${capriniTier}` }];
    if (escalated) auditTrail.push({ action: "ESCALATED", at: new Date(), ...actorMeta, notes: `auto-escalate Caprini ${capriniTier}` });
    if (contraindications.length) auditTrail.push({ action: "CONTRAINDICATED", at: new Date(), ...actorMeta, notes: contraindications.join(", ") });

    // R7bw — resolve canonical active admission so the row escapes stale
    // form-state and lands on the keeper admission post-dedupe.
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(assessment.UHID, assessment.admissionId || null);

    const row = await DVTRegister.create({
      patientId: assessment.patientId || null,
      UHID: assessment.UHID,
      patientName: assessment.patientName || "",
      admissionId: canonicalAdmissionId,
      capriniScore,
      capriniTier,
      improveScore,
      improveTier,
      bleedingRiskFlag,
      factorBreakdown: Array.isArray(data.factorBreakdown) ? data.factorBreakdown : [],
      ...decision,
      contraindications,
      contraindicationNotes: String(data.contraindicationNotes || "").slice(0, 1000),
      escalatedFlag: escalated,
      escalationStatus: escalated ? "PENDING" : "",
      escalationSlaMinutes: 60,
      reassessmentTrigger: data.reassessmentTrigger || "Admission",
      assessedAt: assessment.recordedAt || new Date(),
      assessedBy: assessment.recordedBy || actorMeta.byName || "",
      assessedByUserId: assessment.recordedByUser || actorMeta.byUserId,
      assessedByRole: actorMeta.byRole,
      sourceRef: assessment._id,
      auditTrail,
    });
    return row;
  } catch (e) {
    console.error("[nabhRegisterEmitter] emitDVT:", e.message);
    return null;
  }
}

/**
 * Dispatcher — called once from nursingAssessmentsRoutes after every
 * NursingAssessment.create(). Branches by type so the route stays type-
 * agnostic and new register types only require adding an emit* function
 * here + a case below.
 */
async function emitFromNursingAssessment(assessment, actor = {}) {
  if (!assessment?.type) return null;
  switch (assessment.type) {
    case "pain":          return emitPain({ assessment, actor });
    case "fall-risk":     return emitFallRisk({ assessment, actor });
    case "pressure-area": return emitPressureUlcer({ assessment, actor });
    case "dvt":           return emitDVT({ assessment, actor });
    default:              return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Vitals → Blood Sugar bulk extractor (R7bp — auto-pop RBS from vital sheet)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Called from vitalSheetController.saveVitalSheet after the sheet is
 * persisted. Iterates the sheet's tableData[] looking for blood-sugar
 * readings (keys: bloodSugar / glucose / rbs / grbs — case-insensitive)
 * and emits one BloodSugarRegister row per non-zero reading.
 */
async function emitBloodSugarFromVitalSheet(sheet, patient = {}, actor = {}) {
  try {
    if (!sheet || !Array.isArray(sheet.tableData)) return 0;
    if (!patient?._id || !patient?.UHID) return 0;
    const dateBase = sheet.date ? new Date(sheet.date) : new Date();
    let emitted = 0;
    const bgKeys = ["bloodsugar", "glucose", "rbs", "grbs", "fbs", "ppbs"];

    // R7el-1: vital-sheet field names are `admission` / `ipdNo` (not
    // `admissionId` / `admissionNumber` — those were the old emit args).
    // Reading the wrong key meant the RBS register row was orphaned from
    // its admission for every IPD reading. Fixed by reading the real field
    // names off the sheet doc.
    const admissionRef = sheet.admission
      ? { _id: sheet.admission, admissionNumber: sheet.ipdNo || sheet.admissionNumber || "" }
      : null;
    // R7el-1: location derivation — IPD vital sheets are charted in a ward;
    // OPD sheets have no admission. Derive a sensible location instead of
    // hardcoding "Ward" so surveyor reports show where the reading was taken.
    const sheetLocation = admissionRef ? "Ward"
                        : (sheet.departmentName || "").toLowerCase().includes("emergency") ? "ER"
                        : (sheet.departmentName || "").toLowerCase().includes("icu") ? "ICU"
                        : (sheet.departmentName || "").toLowerCase().includes("opd") ? "OPD"
                        : "Ward";

    for (const entry of sheet.tableData) {
      const map = entry?.values;
      if (!map) continue;
      // mongoose Map → entries iterator; plain object also supported
      const iter = typeof map.entries === "function" ? map.entries() : Object.entries(map);
      for (const [k, v] of iter) {
        if (!bgKeys.includes(String(k).toLowerCase().replace(/[\s_-]/g, ""))) continue;
        const value = v?.value;
        if (value == null || value === 0) continue;
        const [hh, mm] = String(entry.time || "00:00").split(":").map(Number);
        const takenAt = new Date(dateBase);
        takenAt.setHours(hh || 0, mm || 0, 0, 0);
        // R7el-1: prefer the per-entry recorder (nurse who actually took the
        // reading) over req.user (could be a different nurse opening the
        // sheet for review). Falls back to req.user via the standard actor
        // path when the per-entry recorder isn't denormalized on the row.
        const entryActor = entry.nurseName
          ? { _id: entry.recordedBy || actor?._id, name: entry.nurseName, role: "Nurse" }
          : actor;
        await emitBloodSugar({
          patient,
          admission: admissionRef,
          reading: {
            value,
            unit: v?.unit || "mg/dL",
            type: String(k).toUpperCase().includes("FBS") ? "FBS"
                : String(k).toUpperCase().includes("PPBS") ? "PPBS"
                : "RBS",
            sampleType: "capillary",
            takenAt,
            location: sheetLocation,
            sourceRef: sheet._id,
            sourceType: "VitalSheet",
            notes: entry.notes || "",
          },
          actor: entryActor,
        });
        emitted++;
      }
    }
    return emitted;
  } catch (e) {
    console.error("[nabhRegisterEmitter] emitBloodSugarFromVitalSheet:", e.message);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ECG Register — NABH AAC.4 + IPSG.2 + COP.7 (R7en)
// ─────────────────────────────────────────────────────────────────────────

async function _generateEcgNumber() {
  const year = _safeYear();
  const seq = await nextSequence(`ECG-REG:${year}`);
  return `ECG-${year}-${String(seq).padStart(6, "0")}`;
}

/**
 * Derive abnormal + critical flags from filed ECG findings.
 *
 * abnormalFlag — rhythm != NSR OR HR<50 OR HR>100 OR stChanges != None OR QTc>500
 * criticalFlag — rhythm in {VT, VF, AV-Block-3, Asystole} OR stChanges == STE
 *
 * Returns { abnormalFlag, criticalFlag, criticalReason }. The reason is for
 * audit / cross-link narration only.
 */
function _deriveEcgFlags(findings = {}) {
  const rhythm = String(findings.rhythm || "").trim();
  const hr = Number(findings.heartRate);
  const qtc = Number(findings.qtcInterval);
  const st = String(findings.stChanges || "").trim();

  const CRITICAL_RHYTHMS = new Set(["VT", "VF", "AV-Block-3", "Asystole"]);
  const criticalRhythm = CRITICAL_RHYTHMS.has(rhythm);
  const criticalSt = st === "STE";
  const criticalFlag = criticalRhythm || criticalSt;

  const abnormalRhythm = !!rhythm && rhythm !== "NSR";
  const abnormalHr = Number.isFinite(hr) && (hr < 50 || hr > 100);
  const abnormalSt = !!st && st !== "None";
  const abnormalQtc = Number.isFinite(qtc) && qtc > 500;
  const abnormalFlag =
    criticalFlag || abnormalRhythm || abnormalHr || abnormalSt || abnormalQtc;

  let criticalReason = "";
  if (criticalRhythm) criticalReason = `rhythm=${rhythm}`;
  else if (criticalSt) criticalReason = "ST-elevation";

  return { abnormalFlag, criticalFlag, criticalReason };
}

/**
 * Emit an ECG into the NABH ECG register.
 *
 * @param {object} args
 * @param {object} args.patient   — { _id, UHID, fullName/name, age, sex }
 * @param {object} [args.admission] — { _id, admissionNumber }
 * @param {object} args.ecg       — plain object of input fields. Common keys:
 *   { performedAt, location, leadType, indication, indicationCategory,
 *     rhythm, heartRate, prInterval, qrsDuration, qtInterval, qtcInterval,
 *     axis, stChanges, leadsAffected, interpretation,
 *     performedByName, reportedByName,
 *     orderedAt, reportedAt,
 *     doctorOrderId, sourceType }
 * @param {object} [args.actor]   — req.user (defaults takenByName etc.)
 */
async function emitECG(args = {}) {
  try {
    const { patient = {}, admission = null, ecg = {}, actor = {} } = args;
    if (!patient._id || !patient.UHID) return null;

    // ── Idempotency for the auto-emit path: one register row per DoctorOrder.
    // If the doctor places an ECG investigation order and the route fires
    // twice (network retry, dedupe), we want the same pending row, not two.
    if (ecg.doctorOrderId) {
      const existing = await ECGRegister.findOne({ doctorOrderId: ecg.doctorOrderId }).lean();
      if (existing) return existing;
    }

    const ecgNumber = await _generateEcgNumber();
    const actorMeta = _actor(actor);
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(
      patient.UHID,
      admission?._id || ecg.admissionId || null,
    );

    const performedAtVal = ecg.performedAt ? new Date(ecg.performedAt) : new Date();
    const orderedAtVal = ecg.orderedAt ? new Date(ecg.orderedAt) : null;
    const reportedAtVal = ecg.reportedAt ? new Date(ecg.reportedAt) : null;

    const tatOrderToPerformedMin = orderedAtVal && performedAtVal
      ? _diffMinutes(performedAtVal, orderedAtVal)
      : null;
    const tatPerformedToReportedMin = performedAtVal && reportedAtVal
      ? _diffMinutes(reportedAtVal, performedAtVal)
      : null;

    const { abnormalFlag, criticalFlag, criticalReason } = _deriveEcgFlags(ecg);

    // Status: if findings + interpretation already present at emit time, treat
    // as Reported; otherwise PendingReport. Auto-emit from DoctorOrder always
    // lands as PendingReport because there are no findings yet.
    const hasFindings = !!(ecg.rhythm || ecg.heartRate || ecg.interpretation);
    const initialStatus = hasFindings ? "Reported" : "PendingReport";

    const auditTrail = [{
      action: "CREATED",
      at: new Date(),
      ...actorMeta,
      reason: `source=${ecg.sourceType || "Manual"}`,
    }];
    if (hasFindings) {
      auditTrail.push({
        action: "REPORTED",
        at: new Date(),
        ...actorMeta,
        reason: `rhythm=${ecg.rhythm || "?"} HR=${ecg.heartRate ?? "?"}`,
      });
    }
    if (criticalFlag) {
      auditTrail.push({
        action: "CRITICAL_FLAGGED",
        at: new Date(),
        ...actorMeta,
        reason: criticalReason || "critical ECG finding",
      });
    }

    const row = await ECGRegister.create({
      patientId: patient._id,
      UHID: patient.UHID,
      patientName: patient.fullName || patient.name || ecg.patientName || "",
      age: patient.age || null,
      sex: patient.gender || patient.sex || "",
      admissionId: canonicalAdmissionId,
      admissionNumber: admission?.admissionNumber || ecg.admissionNumber || "",

      ecgNumber,
      performedAt: performedAtVal,
      location: ecg.location || "Ward",
      leadType: ecg.leadType || "12-lead",

      indication: ecg.indication || "",
      indicationCategory: ecg.indicationCategory || "Other",

      rhythm: ecg.rhythm || "",
      heartRate: ecg.heartRate != null && ecg.heartRate !== "" ? Number(ecg.heartRate) : null,
      prInterval: ecg.prInterval != null && ecg.prInterval !== "" ? Number(ecg.prInterval) : null,
      qrsDuration: ecg.qrsDuration != null && ecg.qrsDuration !== "" ? Number(ecg.qrsDuration) : null,
      qtInterval: ecg.qtInterval != null && ecg.qtInterval !== "" ? Number(ecg.qtInterval) : null,
      qtcInterval: ecg.qtcInterval != null && ecg.qtcInterval !== "" ? Number(ecg.qtcInterval) : null,
      axis: ecg.axis || "",
      stChanges: ecg.stChanges || "",
      leadsAffected: Array.isArray(ecg.leadsAffected) ? ecg.leadsAffected : [],
      interpretation: ecg.interpretation || "",

      abnormalFlag,
      criticalFlag,
      criticalValueAlertId: null,

      orderedAt: orderedAtVal,
      reportedAt: hasFindings ? (reportedAtVal || new Date()) : null,
      tatOrderToPerformedMin,
      tatPerformedToReportedMin,

      performedBy: _asObjectId(ecg.performedBy) || _asObjectId(actorMeta.byUserId),
      performedByName: ecg.performedByName || actorMeta.byName || "",
      reportedBy: _asObjectId(ecg.reportedBy),
      reportedByName: ecg.reportedByName || "",
      reviewedBy: null,
      reviewedByName: "",

      doctorOrderId: ecg.doctorOrderId || null,
      sourceType: ecg.sourceType || "Manual",

      status: initialStatus,
      auditTrail,

      hospitalId: ecg.hospitalId || null,
    });
    return row;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitECG FAILED:", e.message, "— orderId:", args?.ecg?.doctorOrderId);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// R7bu — Six new NABH registers (COP.10/13/16/17/18 + MOM.7)
// ═════════════════════════════════════════════════════════════════════════
// Each helper below:
//   • is non-blocking — wrapped in try/catch, logs to stderr on failure;
//   • is idempotent — checks for an existing row before insert (by sourceRef
//     / doctorOrderId / unique compound, depending on the register);
//   • returns the created/existing row (or null on no-op / failure);
//   • normalises actor + patient metadata through the shared `_actor()` and
//     resolves the canonical active admission via `_resolveCanonicalAdmissionId`.
//
// Discovery: explicit emit calls from the originating clinical write
// (DoctorOrder save, Procedure note save, Discharge finalize, Admission create).
// ═════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────
// OT Register — NABH COP.10
// ─────────────────────────────────────────────────────────────────────────

async function _generateOtNumber() {
  const year = _safeYear();
  const seq = await nextSequence(`OT-REG:${year}`);
  return `OT-${year}-${String(seq).padStart(6, "0")}`;
}

/**
 * Emit an OT case-log row.
 * Called from:
 *   (a) doctorOrderRoutes when a Procedure order with requiresOT=true is
 *       acknowledged → creates a Scheduled row;
 *   (b) procedureNote save → updates / creates a Completed row.
 *
 * @param {object} args
 * @param {object} args.order        — DoctorOrder doc (when called from (a))
 * @param {object} [args.procedureNote] — Procedure note doc (when called from (b))
 * @param {object} args.patient      — { _id, UHID, fullName/name, age, sex }
 * @param {object} [args.admission]  — { _id, admissionNumber }
 * @param {object} [args.actor]      — req.user
 */
async function emitOT(args = {}) {
  try {
    const { order = null, procedureNote = null, patient = {}, admission = null, actor = {} } = args;
    if (!patient._id || !patient.UHID) return null;

    const source = order || procedureNote;
    if (!source?._id) return null;

    // Idempotency: one row per source ref
    const existing = await OTRegister.findOne({ sourceRef: source._id }).lean();
    if (existing) return existing;

    const otNumber = await _generateOtNumber();
    const actorMeta = _actor(actor);
    const admId = await _resolveCanonicalAdmissionId(patient.UHID, admission?._id);

    const isCompleted = !!procedureNote;
    const details = source.orderDetails || source.details || source;
    const startTime = procedureNote?.startTime
      ? new Date(procedureNote.startTime)
      : (source.scheduledAt ? new Date(source.scheduledAt) : null);
    const endTime = procedureNote?.endTime ? new Date(procedureNote.endTime) : null;
    const durationMinutes = (startTime && endTime) ? _diffMinutes(endTime, startTime) : null;

    const row = await OTRegister.create({
      patientId: patient._id,
      UHID: patient.UHID,
      patientName: patient.fullName || patient.name || "",
      age: patient.age || null,
      sex: patient.gender || patient.sex || "",
      admissionId: admId,
      admissionNumber: admission?.admissionNumber || "",
      otNumber,
      otTheatre: details.otTheatre || details.otNumber || "",
      surgeryName: details.surgeryName || details.procedureName || details.medicineName || details.displayName || "Procedure",
      plannedProcedure: source.plannedProcedure || details.plannedProcedure || details.procedureName || "",
      actualProcedure: procedureNote?.actualProcedure || procedureNote?.procedureDone || "",
      surgicalSpeciality: details.speciality || details.department || "",
      surgeonName: details.surgeonName || source.surgeonName || "",
      surgeonId: _asObjectId(details.surgeonId || source.surgeonId),
      assistantNames: Array.isArray(details.assistantNames) ? details.assistantNames : [],
      anaesthetistName: details.anaesthetistName || procedureNote?.anaesthetistName || "",
      anaesthetistId: _asObjectId(details.anaesthetistId || procedureNote?.anaesthetistId),
      anaesthesiaType: details.anaesthesiaType || procedureNote?.anaesthesiaType || "",
      asaGrade: details.asaGrade || procedureNote?.asaGrade || "",
      emergencyCase: !!(details.emergencyCase || source.priority === "STAT"),
      scheduledAt: source.scheduledAt ? new Date(source.scheduledAt) : null,
      startTime,
      endTime,
      durationMinutes,
      complications: procedureNote?.complications || "",
      bloodLossMl: procedureNote?.bloodLossMl || null,
      specimensSent: Array.isArray(procedureNote?.specimensSent) ? procedureNote.specimensSent : [],
      status: isCompleted ? "Completed" : "Scheduled",
      doctorOrderId: order?._id || null,
      procedureNoteId: procedureNote?._id || null,
      sourceRef: source._id,
      sourceType: order ? "DoctorOrder" : "ProcedureNote",
      occurredAt: startTime || new Date(),
      locked: isCompleted,
      lockedAt: isCompleted ? new Date() : null,
      auditTrail: [{
        action: isCompleted ? "COMPLETED" : "SCHEDULED",
        at: new Date(),
        ...actorMeta,
        notes: `source=${order ? "DoctorOrder" : "ProcedureNote"}`,
      }],
      createdBy: _asObjectId(actorMeta.byUserId),
      createdByName: actorMeta.byName,
      createdByRole: actorMeta.byRole,
    });
    return row;
  } catch (e) {
    console.error("[nabhRegisterEmitter] emitOT FAILED:", e.message, "— sourceId:", args?.order?._id || args?.procedureNote?._id);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ASA Register — NABH COP.13
// ─────────────────────────────────────────────────────────────────────────

/**
 * Emit an anaesthesia register row.
 * Called from pre-op note save (creates PreOp row) and procedure note save
 * (updates / creates Recovered row).
 *
 * @param {object} args
 * @param {object} args.note     — PreOp note or Procedure note doc
 * @param {object} args.patient  — { _id, UHID, fullName/name, age, sex }
 * @param {object} [args.admission]
 * @param {object} [args.actor]
 * @param {object} [args.otRegister] — linked OTRegister row, if any
 */
async function emitASA(args = {}) {
  try {
    const { note, patient = {}, admission = null, actor = {}, otRegister = null } = args;
    if (!note?._id || !patient._id || !patient.UHID) return null;

    // ASA grade is the foundational field. Without it the row is meaningless.
    // R7em-2 — Frontend posts "ASA I" / "ASA IE"; strip prefix + emergency suffix,
    // capture emergency as separate modifier flag (model has emergencyModifier:Boolean).
    const asaRaw = String(note.asaGrade || note.data?.asaGrade || "").trim().toUpperCase();
    const stripped = asaRaw.replace(/^ASA\s*/i, "").trim();          // "I" / "IE" / "I E"
    const hasEmergencySuffix = /E$/i.test(stripped) && stripped.length > 1;
    const asaGrade = stripped.replace(/\s*E$/i, "").trim();          // R7em-2
    if (!["I", "II", "III", "IV", "V", "VI"].includes(asaGrade)) return null;

    // Idempotency: one row per source note
    const existing = await ASARegister.findOne({ sourceRef: note._id }).lean();
    if (existing) return existing;

    const actorMeta = _actor(actor);
    const admId = await _resolveCanonicalAdmissionId(patient.UHID, admission?._id);
    const isRecovery = note.noteType === "ProcedureNote" || note.type === "procedure" || !!note.endTime;
    const data = note.data || note;

    const row = await ASARegister.create({
      patientId: patient._id,
      UHID: patient.UHID,
      patientName: patient.fullName || patient.name || "",
      age: patient.age || null,
      sex: patient.gender || patient.sex || "",
      admissionId: admId,
      admissionNumber: admission?.admissionNumber || "",
      asaGrade,
      emergencyModifier: !!data.emergencyModifier || hasEmergencySuffix, // R7em-2

      anaesthesiaType: data.anaesthesiaType || "General",
      technique: data.technique || "",
      airwayPlan: data.airwayPlan || "",
      anaesthetistName: data.anaesthetistName || actorMeta.byName || "",
      anaesthetistId: _asObjectId(data.anaesthetistId),
      assistantName: data.assistantName || "",
      fastingHours: data.fastingHours != null ? Number(data.fastingHours) : null,
      allergies: Array.isArray(data.allergies) ? data.allergies : [],
      comorbidities: Array.isArray(data.comorbidities) ? data.comorbidities : [],
      preOpVitals: {
        // R7em-2 — also accept flat preOpBp/preOpPulse/preOpTemp/preOpSpo2 from the form
        bp:    data.preOpVitals?.bp    || data.preOpBp    || data.bp    || "",
        pulse: data.preOpVitals?.pulse ?? (data.preOpPulse !== "" && data.preOpPulse != null ? Number(data.preOpPulse) : null) ?? data.pulse ?? null,
        temp:  data.preOpVitals?.temp  ?? (data.preOpTemp  !== "" && data.preOpTemp  != null ? Number(data.preOpTemp)  : null) ?? data.temp  ?? null,
        spo2:  data.preOpVitals?.spo2  ?? (data.preOpSpo2  !== "" && data.preOpSpo2  != null ? Number(data.preOpSpo2)  : null) ?? data.spo2  ?? null,
      },
      consentSigned: !!data.consentSigned,
      consentFormId: data.consentFormId || null,
      drugs: Array.isArray(data.drugs) ? data.drugs : [],
      inductionAt: data.inductionAt ? new Date(data.inductionAt) : null,
      reversalAt: data.reversalAt ? new Date(data.reversalAt) : null,
      recoveryTimeMinutes: data.recoveryTimeMinutes != null ? Number(data.recoveryTimeMinutes) : null,
      aldreteScore: data.aldreteScore != null ? Number(data.aldreteScore) : null,
      postOpVitals: {
        bp:    data.postOpVitals?.bp    || "",
        pulse: data.postOpVitals?.pulse || null,
        temp:  data.postOpVitals?.temp  || null,
        spo2:  data.postOpVitals?.spo2  || null,
      },
      complications: data.complications || "",
      intraOpAdverseEvents: Array.isArray(data.intraOpAdverseEvents) ? data.intraOpAdverseEvents : [],
      otRegisterId: otRegister?._id || null,
      preOpNoteId: !isRecovery ? note._id : (data.preOpNoteId || null),
      procedureNoteId: isRecovery ? note._id : null,
      sourceRef: note._id,
      sourceType: isRecovery ? "ProcedureNote" : "PreOpNote",
      status: isRecovery ? "Recovered" : "PreOp",
      occurredAt: note.recordedAt || note.createdAt || new Date(),
      locked: isRecovery,
      lockedAt: isRecovery ? new Date() : null,
      auditTrail: [{
        action: isRecovery ? "RECOVERED" : "PRE_OP_CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `ASA=${asaGrade} type=${data.anaesthesiaType || "?"}`,
      }],
      createdBy: _asObjectId(actorMeta.byUserId),
      createdByName: actorMeta.byName,
      createdByRole: actorMeta.byRole,
    });
    return row;
  } catch (e) {
    console.error("[nabhRegisterEmitter] emitASA FAILED:", e.message, "— noteId:", args?.note?._id);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Readmission Register — NABH COP.16
// ─────────────────────────────────────────────────────────────────────────

const _READMISSION_WINDOW_DAYS = Number(process.env.NABH_READMISSION_WINDOW_DAYS || 30);

/**
 * Emit a readmission row if the new admission falls within the 30-day
 * window of the previous discharge for the same UHID. Called from the
 * admission-create controller AFTER the new admission is persisted.
 *
 * @param {object} args
 * @param {object} args.admission  — newly created Admission doc (the readmission)
 * @param {object} args.patient    — { _id, UHID, fullName/name, age, sex }
 * @param {object} [args.actor]
 */
async function emitReadmission(args = {}) {
  try {
    const { admission, patient = {}, actor = {} } = args;
    if (!admission?._id || !patient.UHID) return null;

    const currentAdmissionDate = admission.admissionDate || admission.createdAt || new Date();

    // Find the most-recent prior admission for this UHID that has a discharge date
    const previous = await Admission.findOne({
      UHID: patient.UHID,
      _id: { $ne: admission._id },
      dischargeDate: { $ne: null, $exists: true },
    })
      .sort({ dischargeDate: -1 })
      .select("_id admissionNumber admissionDate dischargeDate primaryDiagnosis department dischargeType")
      .lean();

    if (!previous?.dischargeDate) return null;
    const days = Math.floor((new Date(currentAdmissionDate) - new Date(previous.dischargeDate)) / 86400000);
    if (days < 0 || days > _READMISSION_WINDOW_DAYS) return null;

    // Idempotency: one row per (current, previous) pair (also enforced by unique index)
    const existing = await ReadmissionRegister.findOne({
      currentAdmissionId: admission._id,
      previousAdmissionId: previous._id,
    }).lean();
    if (existing) return existing;

    const actorMeta = _actor(actor);
    const sameDiagnosis = !!(admission.primaryDiagnosis && previous.primaryDiagnosis
      && String(admission.primaryDiagnosis).trim().toLowerCase()
        === String(previous.primaryDiagnosis).trim().toLowerCase());

    const row = await ReadmissionRegister.create({
      patientId: patient._id || null,
      UHID: patient.UHID,
      patientName: patient.fullName || patient.name || "",
      age: patient.age || null,
      sex: patient.gender || patient.sex || "",
      currentAdmissionId: admission._id,
      currentAdmissionNumber: admission.admissionNumber || "",
      currentAdmissionDate,
      currentDiagnosis: admission.primaryDiagnosis || "",
      currentDepartment: admission.department || "",
      currentAttendingDoctor: admission.attendingDoctor || admission.consultantIncharge || "",
      previousAdmissionId: previous._id,
      previousAdmissionNumber: previous.admissionNumber || "",
      previousDischargeDate: previous.dischargeDate,
      previousDiagnosis: previous.primaryDiagnosis || "",
      previousDepartment: previous.department || "",
      previousDischargeType: previous.dischargeType || "",
      daysSinceDischarge: days,
      withinWindowDays: _READMISSION_WINDOW_DAYS,
      readmissionType: admission.isElective ? "Elective"
                     : admission.isPlannedReadmission ? "Planned"
                     : "Unplanned",
      sameDiagnosis,
      status: "Open",
      sourceRef: admission._id,
      sourceType: "Admission",
      occurredAt: currentAdmissionDate,
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `days=${days} sameDx=${sameDiagnosis}`,
      }],
      createdBy: _asObjectId(actorMeta.byUserId),
      createdByName: actorMeta.byName,
      createdByRole: actorMeta.byRole,
    });
    return row;
  } catch (e) {
    // Unique-index collision (E11000) is expected on retries — treat as no-op
    if (e?.code === 11000) return null;
    console.error("[nabhRegisterEmitter] emitReadmission FAILED:", e.message, "— admissionId:", args?.admission?._id);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Mortality Register — NABH COP.18
// ─────────────────────────────────────────────────────────────────────────

async function _generateMortalityNumber() {
  const year = _safeYear();
  const seq = await nextSequence(`MORT-REG:${year}`);
  return `MORT-${year}-${String(seq).padStart(6, "0")}`;
}

/**
 * Emit a mortality register row when a death is recorded.
 * Called from:
 *   (a) DischargeSummary finalize when conditionOnDischarge="Expired"
 *       or dischargeType="Death";
 *   (b) stand-alone Death Note save (where supported).
 *
 * @param {object} args
 * @param {object} args.dischargeSummary — optional DischargeSummary doc
 * @param {object} [args.deathNote]      — optional Death Note doc
 * @param {object} args.patient
 * @param {object} [args.admission]
 * @param {object} [args.actor]
 */
async function emitMortality(args = {}) {
  try {
    const { dischargeSummary = null, deathNote = null, patient = {}, admission = null, actor = {} } = args;
    if (!patient._id || !patient.UHID) return null;
    const source = dischargeSummary || deathNote;
    if (!source?._id) return null;

    const admId = admission?._id || dischargeSummary?.admissionId || deathNote?.admissionId || null;

    // Idempotency: one mortality row per admission (also enforced by unique index)
    if (admId) {
      const existing = await MortalityRegister.findOne({ admissionId: admId }).lean();
      if (existing) return existing;
    } else {
      const existing = await MortalityRegister.findOne({ sourceRef: source._id }).lean();
      if (existing) return existing;
    }

    // R7em-7 — Death-note save path posts `dateTime` (a single
    // datetime-local input) while DischargeSummary uses separate
    // deathDate / deathTime. Read both legacy and new field names so
    // either caller emits cleanly without forcing the frontend to
    // migrate.
    const dateOfDeath = dischargeSummary?.deathDate
      || deathNote?.dateOfDeath
      || deathNote?.dateTime
      || dischargeSummary?.dischargeDate
      || new Date();

    const admittedAt = admission?.admissionDate ? new Date(admission.admissionDate) : null;
    const admissionToDeathHours = admittedAt
      ? Math.max(0, Math.round((new Date(dateOfDeath) - admittedAt) / 3600000))
      : null;
    const bruceCategory = admissionToDeathHours == null ? ""
      : admissionToDeathHours < 24 ? "Less24h" : "More24h";

    const mortalityNumber = await _generateMortalityNumber();
    const actorMeta = _actor(actor);

    const row = await MortalityRegister.create({
      patientId: patient._id,
      UHID: patient.UHID,
      patientName: patient.fullName || patient.name || "",
      age: patient.age || null,
      sex: patient.gender || patient.sex || "",
      admissionId: admId,
      admissionNumber: admission?.admissionNumber || dischargeSummary?.admissionNumber || "",
      mortalityNumber,
      dateOfDeath,
      // R7em-7 — derive HH:MM from deathNote.dateTime when timeOfDeath
      // isn't sent explicitly (frontend posts a single datetime-local
      // value, not a separate time field).
      timeOfDeath: dischargeSummary?.deathTime || deathNote?.timeOfDeath
        || (deathNote?.dateTime
          ? new Date(deathNote.dateTime).toLocaleTimeString("en-IN", { hour12: false })
          : "")
        || "",
      placeOfDeath: deathNote?.placeOfDeath || dischargeSummary?.placeOfDeath || "Ward",
      primaryCause: dischargeSummary?.causeOfDeath
        || deathNote?.primaryCause
        || deathNote?.causeDeath1 // R7em-7 — "I (a) Immediate Cause" doubles as the primary registry cause
        || dischargeSummary?.primaryDiagnosis
        || "Not Specified",
      // R7em-7 — frontend posts causeDeath1/2/3 + `contributing`; alias to
      // the registry field names without losing existing callers.
      immediateCauseOfDeath: dischargeSummary?.immediateCauseOfDeath
        || deathNote?.immediateCauseOfDeath
        || deathNote?.causeDeath1
        || "",
      antecedentCauseOfDeath: dischargeSummary?.antecedentCauseOfDeath
        || deathNote?.antecedentCauseOfDeath
        || deathNote?.causeDeath2
        || "",
      underlyingCause: deathNote?.underlyingCause || deathNote?.causeDeath3 || "",
      contributoryCauses: Array.isArray(deathNote?.contributoryCauses)
        ? deathNote.contributoryCauses
        : (deathNote?.contributing
          ? String(deathNote.contributing).split(",").map(s => s.trim()).filter(Boolean)
          : []),
      // R7em-7 — frontend's `modeOfDeath` is a clinical descriptor
      // ("Cardiac Arrest", etc.) and is NOT the legal/forensic manner.
      // Only alias when the value happens to match the manner enum
      // (Natural/Accident/Suicide/Homicide/Undetermined/Pending), else
      // default to "Natural" — the same default the legacy callers use.
      manner: deathNote?.manner
        || (["Natural","Accident","Suicide","Homicide","Undetermined","Pending"].includes(deathNote?.modeOfDeath)
          ? deathNote.modeOfDeath
          : "Natural"),
      admissionToDeathHours,
      bruceCategory,
      isMLC: !!(dischargeSummary?.isMLC || deathNote?.isMLC || admission?.isMLC),
      mlcNumber: dischargeSummary?.mlrNumberSnapshot || deathNote?.mlcNumber || admission?.mlcNumber || "",
      policeIntimated: !!(deathNote?.policeIntimated),
      policeStation: deathNote?.policeStation || "",
      postMortemDone: !!(deathNote?.postMortemDone),
      postMortemRequiredFlag: !!(deathNote?.postMortemRequired || dischargeSummary?.isMLC),
      postMortemFindings: deathNote?.postMortemFindings || "",
      postMortemHospital: deathNote?.postMortemHospital || "",
      deathCertificateNumber: deathNote?.deathCertificateNumber || "",
      deathCertificateIssuedAt: deathNote?.deathCertificateIssuedAt || null,
      deathCertificateIssuedBy: deathNote?.deathCertificateIssuedBy || "",
      attendingDoctor: admission?.attendingDoctor || dischargeSummary?.attendingDoctor || "",
      attendingDoctorId: _asObjectId(admission?.attendingDoctorId),
      certifyingDoctor: actorMeta.byName || dischargeSummary?.finalizedByName || "",
      certifyingDoctorId: _asObjectId(actorMeta.byUserId),
      dischargeSummaryId: dischargeSummary?._id || null,
      deathNoteId: deathNote?._id || null,
      sourceRef: source._id,
      sourceType: dischargeSummary ? "DischargeSummary" : "DeathNote",
      occurredAt: dateOfDeath,
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `source=${dischargeSummary ? "DischargeSummary" : "DeathNote"} mlc=${!!(dischargeSummary?.isMLC || deathNote?.isMLC)}`,
      }],
      createdBy: _asObjectId(actorMeta.byUserId),
      createdByName: actorMeta.byName,
      createdByRole: actorMeta.byRole,
    });
    return row;
  } catch (e) {
    if (e?.code === 11000) return null;
    console.error("[nabhRegisterEmitter] emitMortality FAILED:", e.message, "— sourceId:", args?.dischargeSummary?._id || args?.deathNote?._id);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Restraint Register — NABH COP.17
// ─────────────────────────────────────────────────────────────────────────

/**
 * Emit a restraint episode row. Called from any caller that records a
 * restraint event — typically a doctor order with restraintType set, or a
 * nurse note flagged as a restraint application.
 *
 * No restraint UI exists today, so this helper is callable from future
 * modules. Idempotency keyed on (sourceRef, occurredAt) so the same order
 * doesn't double-emit on save retries.
 *
 * @param {object} args
 * @param {object} args.restraint  — { type, reason, startTime, endTime,
 *                                      device[], chemicalAgent, monitoringFreq,
 *                                      orderingDoctor, sourceRef, sourceType }
 * @param {object} args.patient
 * @param {object} [args.admission]
 * @param {object} [args.actor]
 */
async function emitRestraint(args = {}) {
  try {
    const { restraint = {}, patient = {}, admission = null, actor = {} } = args;
    if (!patient._id || !patient.UHID) return null;
    if (!restraint.type || !restraint.reason || !restraint.startTime) return null;

    const startTime = new Date(restraint.startTime);
    if (!Number.isFinite(startTime.getTime())) return null;

    // Idempotency: don't double-emit for same source + start time
    if (restraint.sourceRef) {
      const existing = await RestraintRegister.findOne({
        sourceRef: restraint.sourceRef,
        startTime,
      }).lean();
      if (existing) return existing;
    }

    const actorMeta = _actor(actor);
    const admId = await _resolveCanonicalAdmissionId(patient.UHID, admission?._id);
    const endTime = restraint.endTime ? new Date(restraint.endTime) : null;
    const durationMinutes = endTime ? _diffMinutes(endTime, startTime) : null;

    const row = await RestraintRegister.create({
      patientId: patient._id,
      UHID: patient.UHID,
      patientName: patient.fullName || patient.name || "",
      age: patient.age || null,
      sex: patient.gender || patient.sex || "",
      admissionId: admId,
      admissionNumber: admission?.admissionNumber || "",
      restraintType: restraint.type,                       // physical / chemical / both
      restraintDevice: Array.isArray(restraint.device) ? restraint.device : (restraint.device ? [restraint.device] : []),
      chemicalAgent: restraint.chemicalAgent || "",
      reason: restraint.reason,
      reasonCategory: restraint.reasonCategory || "Safety",
      startTime,
      endTime,
      durationMinutes,
      monitoringFrequency: restraint.monitoringFrequency
        || (restraint.type === "chemical" ? "q15min" : "q30min"),
      monitoringLog: Array.isArray(restraint.monitoringLog) ? restraint.monitoringLog : [],
      reassessmentDue: restraint.reassessmentDue ? new Date(restraint.reassessmentDue) : null,
      orderingDoctor: restraint.orderingDoctor || actorMeta.byName || "",
      orderingDoctorId: _asObjectId(restraint.orderingDoctorId) || _asObjectId(actorMeta.byUserId),
      orderingDoctorRole: restraint.orderingDoctorRole || actorMeta.byRole,
      doctorOrderId: _asObjectId(restraint.doctorOrderId),
      appliedBy: restraint.appliedBy || actorMeta.byName || "",
      appliedByUserId: _asObjectId(restraint.appliedByUserId) || _asObjectId(actorMeta.byUserId),
      removedAt: restraint.removedAt ? new Date(restraint.removedAt) : null,
      removedBy: restraint.removedBy || "",
      removedByUserId: _asObjectId(restraint.removedByUserId),
      removalReason: restraint.removalReason || "",
      consentObtained: !!restraint.consentObtained,
      consentFrom: restraint.consentFrom || "",
      consentFormId: restraint.consentFormId || null,
      adverseEvent: !!restraint.adverseEvent,
      adverseEventNotes: restraint.adverseEventNotes || "",
      status: endTime ? "Removed" : "Active",
      sourceRef: restraint.sourceRef || null,
      sourceType: restraint.sourceType || "DoctorOrder",
      occurredAt: startTime,
      auditTrail: [{
        action: "ORDERED",
        at: new Date(),
        ...actorMeta,
        notes: `type=${restraint.type} reason=${String(restraint.reason).slice(0, 60)}`,
      }, ...(endTime ? [{ action: "REMOVED", at: endTime, ...actorMeta }] : [])],
      createdBy: _asObjectId(actorMeta.byUserId),
      createdByName: actorMeta.byName,
      createdByRole: actorMeta.byRole,
    });
    return row;
  } catch (e) {
    console.error("[nabhRegisterEmitter] emitRestraint FAILED:", e.message, "— sourceRef:", args?.restraint?.sourceRef);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Antimicrobial Use Register — NABH MOM.7 (AMS)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Curated antibiotic list — used by isAntibiotic() to decide whether a
 * Medication order should emit an AMU row. Names lowercased, accent-folded
 * stems so "amoxicillin", "amoxycillin", "Amox" all match. Kept short on
 * purpose (extend as the formulary grows).
 */
const ANTIBIOTIC_STEMS = [
  // Beta-lactams (penicillins + cephalosporins)
  "amoxicillin", "amoxycillin", "ampicillin", "penicillin", "piperacillin",
  "ticarcillin", "cloxacillin", "flucloxacillin", "dicloxacillin",
  "cefazolin", "cefalexin", "cephalexin", "cefuroxime", "cefixime",
  "cefoperazone", "cefotaxime", "ceftriaxone", "ceftazidime", "cefepime",
  // Carbapenems
  "meropenem", "imipenem", "ertapenem", "doripenem",
  // Glycopeptides / lipopeptides
  "vancomycin", "teicoplanin", "daptomycin",
  // Aminoglycosides
  "gentamicin", "amikacin", "tobramycin", "netilmicin", "streptomycin",
  // Fluoroquinolones
  "ciprofloxacin", "levofloxacin", "moxifloxacin", "norfloxacin", "ofloxacin",
  // Macrolides
  "azithromycin", "clarithromycin", "erythromycin", "roxithromycin",
  // Tetracyclines
  "doxycycline", "tetracycline", "minocycline", "tigecycline",
  // Lincosamides / oxazolidinones / others
  "clindamycin", "linezolid", "metronidazole", "tinidazole",
  "trimethoprim", "sulfamethoxazole", "cotrimoxazole",
  "nitrofurantoin", "fosfomycin", "rifampicin", "rifaximin",
  "colistin", "polymyxin", "fidaxomicin",
  // Antifungals (also AMS-tracked)
  "fluconazole", "voriconazole", "itraconazole", "amphotericin", "caspofungin",
  "anidulafungin", "micafungin",
  // Antivirals (selectively tracked)
  "oseltamivir", "acyclovir", "valacyclovir", "ganciclovir",
];

const _AWARE_MAP = {
  // WHO AWaRe 2023 classification (selective — Reserve agents flagged)
  Access:  ["amoxicillin", "amoxycillin", "ampicillin", "cefazolin", "cefalexin", "cephalexin", "cloxacillin", "doxycycline", "gentamicin", "metronidazole", "nitrofurantoin", "trimethoprim", "sulfamethoxazole", "cotrimoxazole"],
  Watch:   ["ceftriaxone", "ceftazidime", "cefepime", "cefoperazone", "cefotaxime", "cefuroxime", "cefixime", "azithromycin", "clarithromycin", "ciprofloxacin", "levofloxacin", "moxifloxacin", "piperacillin", "vancomycin", "teicoplanin", "clindamycin", "imipenem", "meropenem", "amikacin"],
  Reserve: ["colistin", "polymyxin", "daptomycin", "linezolid", "tigecycline", "fosfomycin", "ertapenem"],
};

function _classifyAware(name) {
  const n = String(name || "").toLowerCase();
  for (const tier of ["Reserve", "Watch", "Access"]) {
    if (_AWARE_MAP[tier].some((stem) => n.includes(stem))) return tier;
  }
  return "";
}

function isAntibiotic(name) {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return ANTIBIOTIC_STEMS.some((stem) => n.includes(stem));
}

/**
 * Emit an antimicrobial-use register row when a Medication order matches
 * the antibiotic list. Called from doctorOrderRoutes after the order is
 * created. Returns null (no-op) if the medicineName isn't an antibiotic.
 *
 * @param {object} args
 * @param {object} args.order    — DoctorOrder doc
 * @param {object} args.patient
 * @param {object} [args.admission]
 * @param {object} [args.actor]
 */
async function emitAntimicrobial(args = {}) {
  try {
    const { order, patient = {}, admission = null, actor = {} } = args;
    if (!order?._id || !patient._id || !patient.UHID) return null;
    if (order.orderType !== "Medication") return null;

    const details = order.orderDetails || {};
    const medName = details.medicineName || details.displayName || "";
    if (!isAntibiotic(medName)) return null;

    // Idempotency: one row per DoctorOrder (also enforced by unique sparse index)
    const existing = await AntimicrobialUseRegister.findOne({ doctorOrderId: order._id }).lean();
    if (existing) return existing;

    const actorMeta = _actor(actor);
    const admId = await _resolveCanonicalAdmissionId(patient.UHID, admission?._id);
    const aware = _classifyAware(medName);

    const indicationType = details.prophylactic
      ? "Prophylactic"
      : (details.cultureBased ? "Targeted" : "Empirical");

    // R7el-6: NABH MOM.7 mandates an indication for every antibiotic order.
    // If the prescriber didn't type one, fall back to a stewardship-aware
    // default keyed by indication type so the register row never has a
    // blank indication column — the IC officer can still see WHY this
    // antibiotic was started and trigger a culture-review prompt at 48-72h.
    const indicationDefault = indicationType === "Prophylactic"
      ? (details.prophylaxisType ? `${details.prophylaxisType} prophylaxis` : "Surgical / medical prophylaxis")
      : indicationType === "Targeted"
        ? "Targeted (culture-directed)"
        : "Empirical — review with culture/sensitivity at 48-72h";
    const indicationFinal = (details.indication || order.indication || order.notes || details.diagnosis || "").trim()
      || indicationDefault;

    const row = await AntimicrobialUseRegister.create({
      patientId: patient._id,
      UHID: patient.UHID,
      patientName: patient.fullName || patient.name || "",
      age: patient.age || null,
      sex: patient.gender || patient.sex || "",
      admissionId: admId,
      admissionNumber: admission?.admissionNumber || "",
      ward: admission?.ward || admission?.wardName || "",
      antibiotic: medName,
      antibioticClass: details.drugClass || "",
      watchAccessReserve: aware,
      dose: details.dose || "",
      route: details.route || "",
      frequency: details.frequency || "",
      duration: details.duration || "",
      startedAt: order.startedAt ? new Date(order.startedAt) : (order.orderedAt || order.createdAt || new Date()),
      indication: indicationFinal,
      indicationType,
      suspectedSite: details.suspectedSite || "",
      prophylactic: !!details.prophylactic,
      prophylaxisType: details.prophylaxisType || "",
      prophylaxisDurationHours: details.prophylaxisDurationHours || null,
      cultureSent: !!details.cultureSent,
      cultureSentAt: details.cultureSentAt ? new Date(details.cultureSentAt) : null,
      cultureResultPending: details.cultureSent ? true : false,
      orderingDoctor: order.orderedByName || (typeof order.orderedBy === "string" ? order.orderedBy : "") || actorMeta.byName || "",
      orderingDoctorId: _asObjectId(order.orderedBy) || _asObjectId(actorMeta.byUserId),
      doctorOrderId: order._id,
      status: "Active",
      sourceRef: order._id,
      sourceType: "DoctorOrder",
      occurredAt: order.orderedAt || order.createdAt || new Date(),
      auditTrail: [{
        action: "ORDERED",
        at: new Date(),
        ...actorMeta,
        notes: `drug=${medName} aware=${aware || "?"} indication=${indicationType}`,
      }],
      createdBy: _asObjectId(actorMeta.byUserId),
      createdByName: actorMeta.byName,
      createdByRole: actorMeta.byRole,
    });
    return row;
  } catch (e) {
    if (e?.code === 11000) return null;
    console.error("[nabhRegisterEmitter] emitAntimicrobial FAILED:", e.message, "— orderId:", args?.order?._id);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// R7gw-B9-T01 — emitSentinelEvent (NABH AAC.7 + MOM.4)
// ═════════════════════════════════════════════════════════════════════════
// Sentinel-event registry. Auto-triggered from emitPressureUlcer (HAPU
// stage III+) and any emitFallRisk caller that records a major-injury fall.
// Also callable manually by the route layer for incidents not surfaced by
// existing emit hooks.
//
// Idempotency: keyed on sourceRef (server-generated UUID via crypto.randomUUID
// or caller-supplied "{originatingModel}:{originatingId}:{eventType}" string).
// ═════════════════════════════════════════════════════════════════════════
const SentinelEventRegister = require("../../models/Compliance/SentinelEventRegisterModel");
const _crypto = require("crypto");

async function emitSentinelEvent(payload = {}) {
  try {
    if (!payload.UHID) return null;
    if (!payload.eventType) return null;

    const sourceRef = payload.sourceRef || _crypto.randomUUID();

    // Idempotency by sourceRef
    try {
      const existing = await SentinelEventRegister.findOne({ sourceRef }).lean();
      if (existing) return existing;
    } catch (lookupErr) {
      // non-fatal — fall through and attempt the create
    }

    const actorMeta = _actor(payload.actor || {});
    const discoveredAt = payload.discoveredAt ? new Date(payload.discoveredAt) : new Date();

    const row = await SentinelEventRegister.create({
      patientId: payload.patientId || null,
      UHID: String(payload.UHID).toUpperCase().trim(),
      patientName: payload.patientName || "",
      admissionId: payload.admissionId || null,
      eventType: payload.eventType,
      discoveredAt,
      discoveredByEmpId: payload.discoveredByEmpId || actorMeta.byName || "",
      severity: payload.severity || "Critical",
      immediateAction: payload.immediateAction || "",
      rcaInitiated: !!payload.rcaInitiated,
      rcaId: payload.rcaId || null,
      status: payload.status || "Open",
      sourceRef,
      hospitalId: payload.hospitalId || null,
      emittedAt: new Date(),
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        byUserId: actorMeta.byUserId,
        byName: actorMeta.byName,
        byRole: actorMeta.byRole,
        notes: `eventType=${payload.eventType} severity=${payload.severity || "Critical"}${payload.autoTriggeredFrom ? ` autoFrom=${payload.autoTriggeredFrom}` : ""}`,
      }, ...(payload.rcaInitiated ? [{
        action: "RCA_INITIATED",
        at: new Date(),
        byUserId: actorMeta.byUserId,
        byName: actorMeta.byName,
        byRole: actorMeta.byRole,
      }] : [])],
    });
    return row;
  } catch (e) {
    if (e?.code === 11000) return null;
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitSentinelEvent FAILED:", e.message, "— UHID:", payload?.UHID, "eventType:", payload?.eventType);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// R7gw-B9-B9-T06 — emitHandHygiene (NABH HIC.3 — Hand Hygiene Compliance)
// ═════════════════════════════════════════════════════════════════════════
// IC officer fills via mobile-friendly observation form. No auto-trigger from
// upstream clinical writes — every row is a manual POST. UHID is OPTIONAL
// because most HH observations are anonymous (HCW × moment × ward). When the
// observer chose to attribute the row to a specific patient (e.g. isolation-
// case audit) we link by UHID + admissionId for filter-by-patient queries.
const HandHygieneRegister = require("../../models/Compliance/HandHygieneRegisterModel");
const _crypto_HH_R7gwT06 = require("crypto");

async function emitHandHygiene(args = {}) {
  try {
    const { observation = {}, actor = {} } = args;
    if (!observation.role || !observation.moment) return null;
    if (typeof observation.complied !== "boolean") return null;

    // Idempotency: server-generated UUID if caller didn't supply one; lets
    // mobile-form retries coalesce into a single row.
    const sourceRef = observation.sourceRef || _crypto_HH_R7gwT06.randomUUID();
    try {
      const existing = await HandHygieneRegister.findOne({ sourceRef }).lean();
      if (existing) return existing;
    } catch (_) { /* non-fatal */ }

    const actorMeta = _actor(actor);
    const observedAtVal = observation.observedAt ? new Date(observation.observedAt) : new Date();

    // UHID is optional; only resolve canonical admission when present.
    let canonicalAdmissionId = null;
    if (observation.UHID) {
      canonicalAdmissionId = await _resolveCanonicalAdmissionId(
        observation.UHID,
        observation.admissionId || null,
      );
    }

    const row = await HandHygieneRegister.create({
      patientId: observation.patientId || null,
      UHID: observation.UHID || "",
      patientName: observation.patientName || "",
      admissionId: canonicalAdmissionId,
      observedAt: observedAtVal,
      observedByEmpId: observation.observedByEmpId || actor.empId || "",
      observedByName: observation.observedByName || actorMeta.byName || "",
      observedByUserId: actorMeta.byUserId,
      ward: observation.ward || "",
      role: observation.role,
      moment: observation.moment,
      complied: !!observation.complied,
      technique: observation.technique || (observation.complied ? "Rub" : "NotDone"),
      notes: observation.notes || "",
      status: observation.status || "Closed",
      sourceRef,
      sourceType: observation.sourceType || "Manual",
      emittedAt: new Date(),
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `role=${observation.role} moment=${observation.moment} complied=${observation.complied}`,
      }],
      hospitalId: observation.hospitalId || null,
    });
    return row;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitHandHygiene FAILED:", e.message);
    return null;
  }
}

// R7gw-B9-T02 — emitNearMissEvent — NABH QPS.5 near-miss register
// Manual-entry only — no auto-trigger from existing emit* chain. The route
// layer calls this directly when the compliance page submits a new row.
// Bails silently on missing eventType/observedAt/severityIfMissed/observedByEmpId
// because the schema requires them and an incomplete payload would throw a
// ValidationError that masks the real caller bug. UHID is optional (some
// near-misses pre-date positive ID).
async function emitNearMissEvent(payload = {}) {
  try {
    const NearMissEventRegister = require("../../models/Compliance/NearMissEventRegisterModel");
    if (!payload.eventType) return null;
    if (!payload.observedAt) return null;
    if (!payload.severityIfMissed) return null;
    if (!payload.observedByEmpId) return null;

    // Idempotency — find-or-create by sourceRef. Pre-existing rows are
    // returned unchanged so a duplicate POST never doubles a near-miss.
    if (payload.sourceRef) {
      try {
        const existing = await NearMissEventRegister.findOne({ sourceRef: payload.sourceRef }).lean();
        if (existing) return existing;
      } catch (_) { /* non-fatal — fall through to create */ }
    }

    const actorMeta = _actor(payload.actor || {});
    const canonicalAdmissionId = payload.UHID
      ? await _resolveCanonicalAdmissionId(payload.UHID, payload.admissionId || null)
      : (payload.admissionId || null);

    const row = await NearMissEventRegister.create({
      patientId: payload.patientId || null,
      UHID: payload.UHID || "",
      patientName: payload.patientName || "",
      admissionId: canonicalAdmissionId,
      eventType: payload.eventType,
      observedAt: new Date(payload.observedAt),
      observedByEmpId: String(payload.observedByEmpId).trim(),
      observedByName: payload.observedByName || actorMeta.byName || "",
      observedByRole: payload.observedByRole || actorMeta.byRole || "",
      observedByUserId: _asObjectId(payload.observedByUserId) || _asObjectId(actorMeta.byUserId),
      severityIfMissed: payload.severityIfMissed,
      interventionTaken: String(payload.interventionTaken || "").trim(),
      recommendation: String(payload.recommendation || "").trim(),
      linkedSentinelId: _asObjectId(payload.linkedSentinelId),
      status: payload.status || "Open",
      sourceRef: payload.sourceRef || undefined, // let schema default → crypto.randomUUID()
      sourceType: payload.sourceType || "Manual",
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        reason: `eventType=${payload.eventType} severity=${payload.severityIfMissed}`,
      }, ...(payload.linkedSentinelId ? [{
        action: "LINKED_TO_SENTINEL",
        at: new Date(),
        ...actorMeta,
        reason: `linked sentinelId=${payload.linkedSentinelId}`,
      }] : [])],
      hospitalId: payload.hospitalId || null,
    });
    return row;
  } catch (e) {
    if (e?.code === 11000) return null; // unique sourceRef collision — idempotent no-op
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitNearMissEvent FAILED:", e.message);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// R7gw-B9-T04 — emitMedicationError (NABH MOM.4)
// ═════════════════════════════════════════════════════════════════════════
// Auto-triggered from MAR controller when administrationRecord.nurseError is
// true on a dose. Severity NCC E-I additionally chains to emitSentinelEvent
// with eventType="Medication-Error-NCC-E-plus".
//
// Idempotency: sourceRef (server-generated UUID via crypto.randomUUID when
// the caller did not supply one). _crypto is already required by the
// SentinelEvent block above — reuse it.
// ═════════════════════════════════════════════════════════════════════════
const MedicationErrorRegister = require("../../models/Compliance/MedicationErrorRegisterModel");

async function emitMedicationError(args = {}) {
  try {
    const { patient = {}, admission = null, error = {}, actor = {} } = args;
    if (!patient.UHID) return null;
    if (!error.errorPhase || !error.severityNCC) return null;

    const actorMeta = _actor(actor);
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(
      patient.UHID,
      admission?._id || error.admissionId || null,
    );

    // Idempotency by sourceRef (server-generated UUID when absent)
    const sourceRef = error.sourceRef || _crypto.randomUUID();
    try {
      const existing = await MedicationErrorRegister.findOne({ sourceRef }).lean();
      if (existing) return existing;
    } catch (_) { /* non-fatal */ }

    const severity = String(error.severityNCC).toUpperCase();
    const sentinelEligible = ["E", "F", "G", "H", "I"].includes(severity);

    // Auto-derive harm class when not passed explicitly
    const patientHarm = error.patientHarm
      || (severity === "I" ? "Death"
        : ["G", "H"].includes(severity) ? "Major"
        : ["E", "F"].includes(severity) ? "Minor"
        : "None");

    const row = await MedicationErrorRegister.create({
      patientId: patient._id || null,
      UHID: String(patient.UHID).toUpperCase().trim(),
      patientName: patient.fullName || patient.name || "",
      admissionId: canonicalAdmissionId,
      admissionNumber: admission?.admissionNumber || error.admissionNumber || "",
      errorPhase: error.errorPhase,
      medicationName: error.medicationName || "",
      expectedDose: error.expectedDose || "",
      actualDose: error.actualDose || "",
      expectedRoute: error.expectedRoute || "",
      actualRoute: error.actualRoute || "",
      severityNCC: severity,
      actionTakenImmediate: error.actionTakenImmediate || "",
      patientHarm,
      reportedByEmpId: error.reportedByEmpId || actor.empId || "",
      reportedByName: error.reportedByName || actorMeta.byName || "",
      reportedByUserId: _asObjectId(actorMeta.byUserId),
      reportedByRole: actorMeta.byRole,
      reportedAt: error.reportedAt ? new Date(error.reportedAt) : new Date(),
      sentinelFlag: sentinelEligible,
      sourceRef,
      sourceType: error.sourceType || "Manual",
      status: "Open",
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `phase=${error.errorPhase} severity=${severity} harm=${patientHarm}`,
      }, ...(sentinelEligible ? [{
        action: "ESCALATED",
        at: new Date(),
        ...actorMeta,
        notes: `auto-escalate severity ${severity} → Sentinel`,
      }] : [])],
    });

    // Sentinel-event chain — severity E-I = NABH sentinel per MOM.4. Non-blocking;
    // the medication-error write must succeed even if the sentinel emit fails.
    if (sentinelEligible) {
      try {
        const sentinelRow = await emitSentinelEvent({
          UHID: patient.UHID,
          patientId: patient._id || null,
          patientName: patient.fullName || patient.name || "",
          admissionId: canonicalAdmissionId,
          eventType: "Medication-Error-NCC-E-plus",
          discoveredAt: error.reportedAt ? new Date(error.reportedAt) : new Date(),
          discoveredByEmpId: error.reportedByEmpId || actor.empId || actorMeta.byName || "",
          severity: ["G", "H", "I"].includes(severity) ? "Critical" : "Major",
          immediateAction: error.actionTakenImmediate
            || `NCC severity ${severity} medication error · drug=${error.medicationName || "?"} expected=${error.expectedDose || "?"} actual=${error.actualDose || "?"}`,
          rcaInitiated: false,
          sourceRef: `MedicationError:${row._id}:${severity}`,
          autoTriggeredFrom: "MedicationError",
          actor,
        });
        if (sentinelRow?._id) {
          row.sentinelEventRef = sentinelRow._id;
          await row.save();
        }
      } catch (sentinelErr) {
        // eslint-disable-next-line no-console
        console.error("[nabhRegisterEmitter] emitMedicationError → emitSentinelEvent chain failed:", sentinelErr.message);
      }
    }

    return row;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitMedicationError FAILED:", e.message, "— UHID:", args?.patient?.UHID);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// R7gw-B9-B9-T07 — emitLAMA (NABH AAC.4 / Leave Against Medical Advice)
// ═════════════════════════════════════════════════════════════════════════
//
// Auto-populated when a discharge is finalised with disposition === "LAMA"
// (or dischargeType ∈ {"LAMA","DAMA"} or conditionOnDischarge === "LAMA").
// The discharge controller force-routes the LAMA capture form before
// finalize so the payload below is populated by the time we emit.
//
// Idempotency: keyed on sourceRef (find-or-create). If the caller doesn't
// supply one, the schema default mints a UUID — so the row is still unique
// even on retry storms.
//
// Non-blocking: try/catch → returns null on failure. Never rolls back the
// underlying discharge write. Pairs with emitMortality on the "finalize
// discharge" rail (death goes to mortality, LAMA goes here).

const LAMARegister = require("../../models/Compliance/LAMARegisterModel");

async function emitLAMA(args = {}) {
  try {
    const {
      patient = {},
      admission = null,
      dischargeSummary = null,
      lama = {},
      actor = {},
    } = args;

    if (!patient.UHID) return null;

    const actorMeta = _actor(actor);
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(
      patient.UHID,
      admission?._id || dischargeSummary?.admissionId || lama?.admissionId || null,
    );

    // Source-ref preference: explicit lama.sourceRef > deterministic
    // "discharge:<id>" so a discharge re-finalize finds the same row.
    // Fall back to the schema's UUID default when neither is available.
    const sourceRef = lama.sourceRef
      || (dischargeSummary?._id ? `discharge:${String(dischargeSummary._id)}` : null);

    if (sourceRef) {
      try {
        const existing = await LAMARegister.findOne({ sourceRef }).lean();
        if (existing) return existing;
      } catch (_) { /* lookup failure → fall through to create */ }
    }

    const lamaAtVal = lama.lamaAt
      ? new Date(lama.lamaAt)
      : (dischargeSummary?.dischargeDate ? new Date(dischargeSummary.dischargeDate) : new Date());

    const row = await LAMARegister.create({
      patientId: patient._id || null,
      UHID: patient.UHID,
      patientName: patient.fullName || patient.name || dischargeSummary?.patientName || "",
      age: patient.age || dischargeSummary?.age || null,
      sex: patient.gender || patient.sex || dischargeSummary?.gender || "",
      admissionId: canonicalAdmissionId,
      admissionNumber: admission?.admissionNumber || dischargeSummary?.admissionNumber || "",

      lamaAt: lamaAtVal,
      lamaReason: lama.lamaReason || dischargeSummary?.lamaReason || "",

      patientSignature:  lama.patientSignature  || "",
      witnessName:       lama.witnessName       || "",
      witnessSignature:  lama.witnessSignature  || "",

      doctorCounsellingNotes: lama.doctorCounsellingNotes
        || dischargeSummary?.doctorCounsellingNotes || "",
      risksExplained:    !!(lama.risksExplained ?? dischargeSummary?.risksExplained),
      familyInformed:    !!(lama.familyInformed ?? dischargeSummary?.familyInformed),

      policeNotified:    !!(lama.policeNotified ?? dischargeSummary?.policeNotified),
      policeStation:     lama.policeStation || dischargeSummary?.policeStation || "",
      policeFIRNo:       lama.policeFIRNo   || dischargeSummary?.policeFIRNo   || "",

      transferRequested: !!(lama.transferRequested ?? dischargeSummary?.transferRequested),
      transferTo:        lama.transferTo || dischargeSummary?.transferTo || "",

      attendingDoctor:   admission?.attendingDoctor || dischargeSummary?.attendingDoctor || "",
      attendingDoctorId: _asObjectId(admission?.attendingDoctorId || dischargeSummary?.attendingDoctorId),
      counsellingDoctor: lama.counsellingDoctor || actorMeta.byName || "",
      counsellingDoctorId: _asObjectId(lama.counsellingDoctorId) || _asObjectId(actorMeta.byUserId),
      ward:              admission?.ward || admission?.wardName || "",

      // sourceRef — undefined here means "let schema default mint a UUID".
      sourceRef:         sourceRef || undefined,
      sourceType:        lama.sourceType || (dischargeSummary ? "DischargeSummary" : "Manual"),
      dischargeSummaryId: dischargeSummary?._id || null,

      status:            "Open",
      emittedAt:         new Date(),

      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        reason: lama.lamaReason || "LAMA at discharge",
        notes: `source=${dischargeSummary ? "DischargeSummary" : "Manual"} risks=${!!lama.risksExplained} family=${!!lama.familyInformed} police=${!!lama.policeNotified}`,
      }],

      hospitalId:        lama.hospitalId || null,
      createdBy:         _asObjectId(actorMeta.byUserId),
      createdByName:     actorMeta.byName,
      createdByRole:     actorMeta.byRole,
    });
    return row;
  } catch (e) {
    // Duplicate sourceRef (E11000) → treat as no-op + return the existing.
    if (e?.code === 11000) {
      try {
        const sref = args?.lama?.sourceRef
          || (args?.dischargeSummary?._id ? `discharge:${String(args.dischargeSummary._id)}` : null);
        if (sref) return await LAMARegister.findOne({ sourceRef: sref }).lean();
      } catch (_) { /* ignore */ }
      return null;
    }
    console.error("[nabhRegisterEmitter] emitLAMA FAILED:", e.message, "— UHID:", args?.patient?.UHID);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// R7gw-B9-B9-T03 — emitRCA (NABH QPS.1 Root-Cause Analysis register)
// ═════════════════════════════════════════════════════════════════════════
// emitRCA creates an RCA workflow row keyed by a server-supplied sourceRef
// (UUID) for idempotency. Called either:
//   (a) Automatically from emitSentinelEvent immediately after a sentinel
//       row lands — pre-creates the RCA in "Initiated" status with the
//       linkedSentinelId set so the Quality officer sees the task on their
//       worklist without manually opening it.
//   (b) Manually from POST /api/rca-register when the QPS chair logs an
//       RCA triggered by a serious near-miss or recurrent deviation that
//       didn't trip a sentinel.
//
// UHID is optional — many RCAs are systemic (no single patient).
// ═════════════════════════════════════════════════════════════════════════
const RCARegister = require("../../models/Compliance/RCARegisterModel");
const _crypto_RCA_R7gwB9T03 = require("crypto");

async function emitRCA(payload = {}) {
  try {
    const {
      patient = {},
      admission = null,
      linkedSentinelId = null,
      linkedNearMissId = null,
      initiatedAt = new Date(),
      initiatedByEmpId = "",
      initiatedByName = "",
      teamMembers = [],
      timeline = [],
      contributingFactors = [],
      rootCauses = [],
      correctiveActions = [],
      preventiveActions = [],
      status = "Open",
      sourceRef = "",
      sourceType = "Manual",
      actor = {},
    } = payload;

    // Idempotency: dedupe by caller-supplied sourceRef when present
    const finalSourceRef = sourceRef || _crypto_RCA_R7gwB9T03.randomUUID();
    try {
      const existing = await RCARegister.findOne({ sourceRef: finalSourceRef }).lean();
      if (existing) return existing;
    } catch (_) { /* lookup failure non-fatal */ }

    const actorMeta = _actor(actor);

    // R7bw — resolve canonical admission when UHID is given so the RCA
    // links to the live admission post-dedupe. RCA may legitimately have
    // no UHID (systemic root-cause review) so this is conditional.
    let admissionIdRCA = null;
    if (patient.UHID) {
      try {
        admissionIdRCA = await _resolveCanonicalAdmissionId(
          patient.UHID,
          admission?._id || null,
        );
      } catch (_) { admissionIdRCA = admission?._id || null; }
    }

    const row = await RCARegister.create({
      patientId: patient._id || null,
      UHID: patient.UHID || "",
      patientName: patient.fullName || patient.name || "",
      admissionId: admissionIdRCA,
      linkedSentinelId: linkedSentinelId || null,
      linkedNearMissId: linkedNearMissId || null,
      initiatedAt: new Date(initiatedAt),
      initiatedByEmpId: initiatedByEmpId || actor.empId || "",
      initiatedByName: initiatedByName || actorMeta.byName || "",
      teamMembers: Array.isArray(teamMembers) ? teamMembers : [],
      timeline: Array.isArray(timeline) ? timeline : [],
      contributingFactors: Array.isArray(contributingFactors) ? contributingFactors : [],
      rootCauses: Array.isArray(rootCauses) ? rootCauses : [],
      correctiveActions: Array.isArray(correctiveActions) ? correctiveActions : [],
      preventiveActions: Array.isArray(preventiveActions) ? preventiveActions : [],
      status,
      sourceRef: finalSourceRef,
      sourceType,
      hospitalId: payload.hospitalId || null,
      emittedAt: new Date(),
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `source=${sourceType} sentinel=${linkedSentinelId || "-"}`,
      }],
    });
    return row;
  } catch (e) {
    if (e?.code === 11000) return null; // dupe race
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitRCA FAILED:", e.message);
    return null;
  }
}

// R7gw-B9-B9-T03 — auto-trigger wrapper. Wraps emitSentinelEvent so every
// sentinel row pre-creates the linked RCA workflow in Initiated status.
// Route layer / external callers may use this wrapper instead of calling
// emitSentinelEvent directly when they want the post-sentinel RCA bootstrap.
//
// The RCA pre-creation is fire-and-forget; failure never blocks the
// sentinel row from being returned to the caller.
async function emitSentinelEventWithRCA(payload = {}) {
  const sentinelRow = await emitSentinelEvent(payload);
  if (!sentinelRow?._id) return sentinelRow;
  // fire-and-forget — RCA pre-creates in the background.
  emitRCA({
    patient: {
      _id: sentinelRow.patientId || null,
      UHID: sentinelRow.UHID || "",
      fullName: sentinelRow.patientName || "",
    },
    admission: sentinelRow.admissionId ? { _id: sentinelRow.admissionId } : null,
    linkedSentinelId: sentinelRow._id,
    initiatedAt: sentinelRow.discoveredAt || sentinelRow.createdAt || new Date(),
    initiatedByEmpId: sentinelRow.discoveredByEmpId || "",
    status: "Initiated",
    sourceRef: `sentinel:${sentinelRow._id.toString()}`,
    sourceType: "SentinelEvent",
    actor: payload.actor || {},
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitSentinelEventWithRCA → RCA chain failed:", e.message);
  });
  return sentinelRow;
}

// ═════════════════════════════════════════════════════════════════════════
// R7gw-B9-T05 — emitHAISurveillance (NABH HIC.4 — HAI Surveillance)
// ═════════════════════════════════════════════════════════════════════════
// Healthcare-Associated Infection surveillance row. Auto-triggered from
// the ICU-bundle save path when CAUTI compliance <100 AND Foley dwellDays>3
// AND a positive UTI culture is present; also callable manually for SSI/
// CDI/MRSA-bacteremia events surfaced from culture-result feeds.
//
// Idempotency: keyed on sourceRef. Caller may supply a deterministic
// "{HAIType}:{ICUBundleId|UHID}:{onsetDate}" string for auto-triggers;
// default is crypto.randomUUID() for manual entries.
// ═════════════════════════════════════════════════════════════════════════
const HAISurveillanceRegister = require("../../models/Compliance/HAISurveillanceRegisterModel");
// _crypto already required above by Sentinel/MedError emitter; re-use if
// defined, otherwise pull it fresh. Wrapped in a typeof guard so this
// module loads cleanly even when sibling sections haven't been merged yet.
const _haiCrypto = (typeof _crypto !== "undefined" && _crypto && _crypto.randomUUID)
  ? _crypto
  : require("crypto");

async function emitHAISurveillance(payload = {}) {
  try {
    if (!payload.UHID) return null;
    if (!payload.HAIType) return null;

    const sourceRef = payload.sourceRef || _haiCrypto.randomUUID();

    // Idempotency by sourceRef — bail to existing row on retry
    try {
      const existing = await HAISurveillanceRegister.findOne({ sourceRef }).lean();
      if (existing) return existing;
    } catch (_lookupErr) {
      // non-fatal — fall through and attempt the create
    }

    const actorMeta = _actor(payload.actor || {});
    const onsetDate = payload.onsetDate ? new Date(payload.onsetDate) : new Date();
    const UHID = String(payload.UHID).toUpperCase().trim();

    // Canonical active admission resolution so the row links to the
    // keeper admission even when the caller carries a stale id (post-dedupe).
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(
      UHID,
      payload.admissionId || null,
    );

    const row = await HAISurveillanceRegister.create({
      patientId: payload.patientId || null,
      UHID,
      patientName: payload.patientName || "",
      admissionId: canonicalAdmissionId,
      HAIType: payload.HAIType,
      onsetDate,
      identifiedByEmpId: payload.identifiedByEmpId || actorMeta.byName || "",
      deviceDays: payload.deviceDays != null ? Number(payload.deviceDays) : null,
      cultureSent: !!payload.cultureSent,
      organismIsolated: payload.organismIsolated || "",
      antibioticPrescribed: payload.antibioticPrescribed || "",
      outcome: payload.outcome || "",
      linkedICUBundleId: payload.linkedICUBundleId || null,
      status: payload.status || "Open",
      sourceRef,
      hospitalId: payload.hospitalId || null,
      emittedAt: new Date(),
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        byUserId: actorMeta.byUserId,
        byName: actorMeta.byName,
        byRole: actorMeta.byRole,
        notes: `HAIType=${payload.HAIType}${payload.linkedICUBundleId ? ` linkedICUBundle=${payload.linkedICUBundleId}` : ""}${payload.autoTriggeredFrom ? ` autoFrom=${payload.autoTriggeredFrom}` : ""}`,
      }],
    });
    return row;
  } catch (e) {
    if (e?.code === 11000) return null;
    // eslint-disable-next-line no-console
    console.error(
      "[nabhRegisterEmitter] emitHAISurveillance FAILED:",
      e.message,
      "— UHID:", payload?.UHID,
      "HAIType:", payload?.HAIType,
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// R7gw-B10-T02 — emitMSOLog — Medical Social Officer session log (NABH PRE.1)
// ─────────────────────────────────────────────────────────────────────────
//
// Find-or-create-by-sourceRef. Manual-entry register: the social worker
// types in a session (counseling / financial aid / discharge planning /
// bereavement / grievance / vulnerable patient care), the route calls this
// emitter, and the row lands in mso_log_registers. Idempotent on sourceRef
// so a network retry doesn't double-write the same session.
async function emitMSOLog(args = {}) {
  try {
    const MSOLogRegister = require("../../models/Compliance/MSOLogRegisterModel");
    const { session = {}, actor = {} } = args;
    if (!session.UHID) return null;
    if (!session.sessionType) return null;
    if (!session.outcome) return null;

    const actorMeta = _actor(actor);
    const sessionDate = session.sessionDate ? new Date(session.sessionDate) : new Date();

    // R7bw — resolve canonical active admission so the row links to the
    // KEEPER admission even if the caller is still holding a stale id.
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(
      session.UHID,
      session.admissionId || null,
    );

    // Idempotent find-or-create on sourceRef (caller may pass an explicit
    // UUID to coalesce retries; otherwise the schema default generates one).
    const incomingSourceRef = session.sourceRef || "";
    if (incomingSourceRef) {
      const existing = await MSOLogRegister.findOne({ sourceRef: incomingSourceRef }).lean();
      if (existing) return existing;
    }

    const row = await MSOLogRegister.create({
      patientId:        session.patientId || null,
      UHID:             String(session.UHID).toUpperCase(),
      patientName:      session.patientName || "",
      admissionId:      canonicalAdmissionId,
      admissionNumber:  session.admissionNumber || "",

      sessionDate,
      sessionType:      session.sessionType,
      duration:         Number(session.duration) || 0,
      concernAddressed: session.concernAddressed || "",

      outcome:          session.outcome,
      followUpNeeded:   !!session.followUpNeeded,
      followUpDate:     session.followUpDate ? new Date(session.followUpDate) : null,
      referredTo:       session.referredTo || "",

      socialWorkerEmpId:  session.socialWorkerEmpId || "",
      socialWorkerName:   session.socialWorkerName || actorMeta.byName || "",
      socialWorkerUserId: actorMeta.byUserId || null,

      notes:            session.notes || "",
      status:           session.status || "Closed",

      ...(incomingSourceRef ? { sourceRef: incomingSourceRef } : {}),
      sourceType:       session.sourceType || "Manual",

      hospitalId:       session.hospitalId || null,

      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `sessionType=${session.sessionType} outcome=${session.outcome}`,
      }],
    });
    return row;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitMSOLog FAILED:", e.message,
      "— UHID:", args?.session?.UHID, "sessionType:", args?.session?.sessionType);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// R7gw-B10-T07 — emitStatutoryCompliance (NABH AAC.16 — Statutory Licence register)
// ═════════════════════════════════════════════════════════════════════════
// Compliance officer / Admin maintains the living register of every statutory
// licence in force — Hospital, Pharmacy, Blood-Bank, Fire-NOC, PCB-Consent,
// BMW-Authorisation, Atomic-Energy, PNDT, CTL, PRA, Drug-Licence, Lift-Inspection.
// No upstream auto-trigger — every row is a manual POST from the compliance
// page. Idempotent on sourceRef so repeated mobile submits coalesce.
const StatutoryComplianceRegister = require("../../models/Compliance/StatutoryComplianceRegisterModel");
const _crypto_SC_R7gwB10T07 = require("crypto");

async function emitStatutoryCompliance(args = {}) {
  try {
    const { entry = {}, actor = {} } = args;
    // Bail silently on missing required fields — schema would throw otherwise
    // and mask the real caller bug.
    if (!entry.licenseType) return null;
    if (!entry.licenseNo) return null;

    // Idempotency: server-generated UUID if caller did not supply one.
    const sourceRef = entry.sourceRef || _crypto_SC_R7gwB10T07.randomUUID();
    try {
      const existing = await StatutoryComplianceRegister.findOne({ sourceRef }).lean();
      if (existing) return existing;
    } catch (_) { /* non-fatal */ }

    const actorMeta = _actor(actor);

    const row = await StatutoryComplianceRegister.create({
      licenseType: entry.licenseType,
      licenseNo: String(entry.licenseNo).trim(),
      issuedBy: entry.issuedBy || "",
      issuedDate: entry.issuedDate ? new Date(entry.issuedDate) : null,
      expiryDate: entry.expiryDate ? new Date(entry.expiryDate) : null,
      renewalAppliedDate: entry.renewalAppliedDate ? new Date(entry.renewalAppliedDate) : null,
      renewalStatus: entry.renewalStatus || "NotStarted",
      documentPath: entry.documentPath || "",
      notes: entry.notes || "",
      status: entry.status || "Active",
      sourceRef,
      sourceType: entry.sourceType || "Manual",
      emittedAt: new Date(),
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `licenseType=${entry.licenseType} licenseNo=${entry.licenseNo}`,
      }],
      hospitalId: entry.hospitalId || null,
    });
    return row;
  } catch (e) {
    if (e?.code === 11000) return null;
    // eslint-disable-next-line no-console
    console.error(
      "[nabhRegisterEmitter] emitStatutoryCompliance FAILED:",
      e.message,
      "— licenseType:", args?.entry?.licenseType,
      "licenseNo:", args?.entry?.licenseNo,
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// R7gw-B10-T01 — emitAntibiogram (NABH HIC.6 — Antibiogram register)
// ─────────────────────────────────────────────────────────────────────────
//
// One row per organism × period × ward × sampleType cohort. Find-or-create
// by sourceRef so periodic regenerations of the same cohort coalesce
// (e.g. monthly batch re-run, network retry from manual POST). Caller
// supplies organism + sensitivityProfile (Map of antibiotic→S/I/R) plus
// optional first/second-line recommendations. Idempotent on sourceRef.
const AntibiogramRegister = require("../../models/Compliance/AntibiogramRegisterModel");
const _crypto_AB_R7gwB10T01 = require("crypto");

async function emitAntibiogram(payload = {}) {
  try {
    if (!payload || !payload.organism) return null;

    const sourceRef = payload.sourceRef || _crypto_AB_R7gwB10T01.randomUUID();
    const actorMeta = _actor(payload.actor || {});

    // find-or-create-by-sourceRef → repeated emits of the same cohort do
    // not duplicate. Manual entries always carry a fresh UUID.
    const existing = await AntibiogramRegister.findOne({ sourceRef }).lean();
    if (existing) return existing;

    // Normalise sensitivityProfile: accept plain object {amox:"S"}, an
    // array of [antibiotic, value] pairs, or an existing Map. Coerce
    // anything else to an empty Map so Mongoose doesn't choke.
    let profile = payload.sensitivityProfile;
    if (profile && !(profile instanceof Map)) {
      if (Array.isArray(profile)) profile = new Map(profile);
      else if (typeof profile === "object") profile = new Map(Object.entries(profile));
      else profile = new Map();
    }

    const row = await AntibiogramRegister.create({
      organism: String(payload.organism).trim(),
      isolatedAt: payload.isolatedAt ? new Date(payload.isolatedAt) : null,
      ward: payload.ward || "",
      sampleType: payload.sampleType || "Other",
      sensitivityProfile: profile || new Map(),
      recommendedFirstLine:  Array.isArray(payload.recommendedFirstLine)  ? payload.recommendedFirstLine  : [],
      recommendedSecondLine: Array.isArray(payload.recommendedSecondLine) ? payload.recommendedSecondLine : [],
      period: payload.period || "",
      totalIsolates: Number(payload.totalIsolates) || 0,
      notes: payload.notes || "",
      status: payload.status || "Closed",
      sourceRef,
      sourceType: payload.sourceType || "Manual",
      hospitalId: payload.hospitalId || null,
      createdBy: actorMeta.byUserId,
      createdByName: actorMeta.byName,
      createdByRole: actorMeta.byRole,
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `source=${payload.sourceType || "Manual"} organism=${payload.organism} period=${payload.period || "?"}`,
      }],
    });
    return row;
  } catch (e) {
    // Non-blocking — register writes must never abort upstream lab work.
    // eslint-disable-next-line no-console
    console.error(
      "[nabhRegisterEmitter] emitAntibiogram FAILED:",
      e.message,
      "organism:", payload?.organism,
      "period:", payload?.period,
    );
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// R7gw-B10-T03 — emitESGCompliance (NABH 6th-ed Environment chapter)
// ═════════════════════════════════════════════════════════════════════════
// Monthly Environmental, Social & Governance report — energy / water /
// diesel / waste / carbon + green-initiatives + ESG-audit findings.
// Manual-entry only; one row per facility-month period (YYYY-MM).
const ESGComplianceRegister = require("../../models/Compliance/ESGComplianceRegisterModel");
const _crypto_ESG_R7gwB10T03 = require("crypto");

async function emitESGCompliance(args = {}) {
  try {
    const { report = {}, actor = {} } = args;
    if (!report.period || !/^\d{4}-\d{2}$/.test(String(report.period))) return null;
    if (!report.reportedByEmpId) return null;

    // Idempotency: server-generated UUID if caller didn't supply one.
    const sourceRef = report.sourceRef || _crypto_ESG_R7gwB10T03.randomUUID();
    try {
      const existing = await ESGComplianceRegister.findOne({ sourceRef }).lean();
      if (existing) return existing;
    } catch (_) { /* non-fatal */ }

    const actorMeta = _actor(actor);

    const initiatives = Array.isArray(report.greenInitiatives)
      ? report.greenInitiatives.map((s) => String(s).trim()).filter(Boolean)
      : [];

    const row = await ESGComplianceRegister.create({
      period: String(report.period),
      energyKwh:         Number(report.energyKwh)         || 0,
      waterKl:           Number(report.waterKl)           || 0,
      dieselLitres:      Number(report.dieselLitres)      || 0,
      medicalWasteKg:    Number(report.medicalWasteKg)    || 0,
      biomedicalWasteKg: Number(report.biomedicalWasteKg) || 0,
      recycledPct:       Number(report.recycledPct)       || 0,
      co2eqKg:           Number(report.co2eqKg)           || 0,
      greenInitiatives:  initiatives,
      auditFindings:     report.auditFindings || "",
      reportedByEmpId:   report.reportedByEmpId,
      reportedByName:    report.reportedByName || actorMeta.byName || "",
      reportedByUserId:  actorMeta.byUserId,
      status:            report.status || "Closed",
      sourceRef,
      sourceType:        report.sourceType || "Manual",
      emittedAt:         new Date(),
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `period=${report.period} energy=${report.energyKwh || 0}kWh water=${report.waterKl || 0}kL CO2e=${report.co2eqKg || 0}kg`,
      }],
      hospitalId: report.hospitalId || null,
    });
    return row;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      "[nabhRegisterEmitter] emitESGCompliance FAILED:",
      e.message,
      "— period:", args?.report?.period,
    );
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// R7gw-B10-T04 — emitWellnessProgram (NABH HRM.6 — Staff Wellness Programmes)
// ═════════════════════════════════════════════════════════════════════════
// HR / Wellness committee files each session row from the page UI. No auto-
// trigger from clinical writes. Bails silently on missing programName / type /
// sessionDate / topic / facilitator because the schema requires them and an
// incomplete payload would throw a ValidationError that masks the real caller
// bug. Idempotency by sourceRef (server-generated UUID at emit time).
const WellnessProgramRegister_R7gwB10T04 = require("../../models/Compliance/WellnessProgramRegisterModel");
const _crypto_WP_R7gwB10T04 = require("crypto");

async function emitWellnessProgram(args = {}) {
  try {
    const { session = {}, actor = {} } = args;
    if (!session.programName) return null;
    if (!session.type) return null;
    if (!session.sessionDate) return null;
    if (!session.topic) return null;
    if (!session.facilitator) return null;

    // Idempotency: find-or-create by sourceRef. Pre-existing rows are
    // returned unchanged so a duplicate POST never doubles a session log.
    const sourceRef = session.sourceRef || _crypto_WP_R7gwB10T04.randomUUID();
    try {
      const existing = await WellnessProgramRegister_R7gwB10T04.findOne({ sourceRef }).lean();
      if (existing) return existing;
    } catch (_) { /* non-fatal */ }

    const actorMeta = _actor(actor);
    const sessionDateVal = new Date(session.sessionDate);

    const participantList = Array.isArray(session.participantEmpIds)
      ? session.participantEmpIds.filter(Boolean).map((s) => String(s).trim()).filter(Boolean)
      : [];

    let feedbackScoreVal = Number(session.feedbackScore || 0);
    if (!Number.isFinite(feedbackScoreVal) || feedbackScoreVal < 0) feedbackScoreVal = 0;
    if (feedbackScoreVal > 5) feedbackScoreVal = 5;

    const row = await WellnessProgramRegister_R7gwB10T04.create({
      programName: String(session.programName).trim(),
      type: session.type,
      sessionDate: sessionDateVal,
      participantEmpIds: participantList,
      topic: String(session.topic).trim(),
      facilitator: String(session.facilitator).trim(),
      feedbackScore: feedbackScoreVal,
      notes: session.notes || "",
      status: session.status || "Completed",
      sourceRef,
      sourceType: session.sourceType || "Manual",
      emittedAt: new Date(),
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `type=${session.type} topic=${session.topic} participants=${participantList.length}`,
      }],
      hospitalId: session.hospitalId || null,
    });
    return row;
  } catch (e) {
    if (e?.code === 11000) return null;
    // eslint-disable-next-line no-console
    console.error("[nabhRegisterEmitter] emitWellnessProgram FAILED:", e.message,
      "— programName:", args?.session?.programName,
      "type:", args?.session?.type);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// R7gw-B10-T06 — emitFacilitiesMaintenanceLog (NABH FMS.5)
// ═════════════════════════════════════════════════════════════════════════
//
// Facilities / Biomedical / Engineering maintenance log. Manual-entry only —
// engineering staff (or AMC-vendor liaison) logs a scheduled-PPM job, an
// active corrective ticket, or an AMC visit. No upstream auto-trigger; the
// surveyor reads aggregate compliance % via the page filter.
//
// Find-or-create-by-sourceRef so a network retry of the same job ticket
// coalesces into the same row.
async function emitFacilitiesMaintenanceLog(args = {}) {
  try {
    const FacilitiesMaintenanceLogRegister = require("../../models/Compliance/FacilitiesMaintenanceLogRegisterModel");
    const { entry = {}, actor = {} } = args;
    if (!entry.equipmentType || !entry.equipmentId) return null;
    if (!entry.scheduledAt) return null;

    const actorMeta = _actor(actor);
    const scheduledAtVal = new Date(entry.scheduledAt);
    const performedAtVal = entry.performedAt ? new Date(entry.performedAt) : null;
    const nextDueDateVal = entry.nextDueDate ? new Date(entry.nextDueDate) : null;

    // Idempotent find-or-create on sourceRef. If caller supplies a UUID we
    // re-use it; the model defaults to crypto.randomUUID() when absent.
    const incomingSourceRef = entry.sourceRef || "";
    if (incomingSourceRef) {
      const existing = await FacilitiesMaintenanceLogRegister.findOne({ sourceRef: incomingSourceRef }).lean();
      if (existing) return existing;
    }

    const createDoc = {
      equipmentType:    entry.equipmentType,
      equipmentId:      String(entry.equipmentId).trim(),
      equipmentName:    entry.equipmentName || "",
      location:         entry.location || "",

      scheduledAt:      scheduledAtVal,
      performedAt:      performedAtVal,

      performedByEmpId: entry.performedByEmpId || actor.empId || "",
      performedByName:  entry.performedByName || actorMeta.byName || "",
      performedByUserId:actorMeta.byUserId,
      vendor:           entry.vendor || "",
      amcContractRef:   entry.amcContractRef || "",

      jobType:          entry.jobType || "PPM",
      findings:         entry.findings || "",
      correctiveAction: entry.correctiveAction || "",
      partsReplaced:    entry.partsReplaced || "",
      downtimeMinutes:  Number(entry.downtimeMinutes) || 0,

      nextDueDate:      nextDueDateVal,

      status:           entry.status || (performedAtVal ? "Done" : "Scheduled"),

      sourceType:       entry.sourceType || "Manual",
      emittedAt:        new Date(),
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `eq=${entry.equipmentType}/${entry.equipmentId} job=${entry.jobType || "PPM"}`,
      }],
      hospitalId:       entry.hospitalId || null,
    };
    if (incomingSourceRef) createDoc.sourceRef = incomingSourceRef;

    const row = await FacilitiesMaintenanceLogRegister.create(createDoc);
    return row;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      "[nabhRegisterEmitter] emitFacilitiesMaintenanceLog FAILED:", e.message,
      "— equipmentType:", args?.entry?.equipmentType,
      "equipmentId:", args?.entry?.equipmentId,
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// R7gw-B10-T05 — emitPROMPREMReg
// PROM / PREM Register (NABH PRE.4 6th-ed). Find-or-create by sourceRef so
// repeated POSTs of the same survey administration coalesce into one row.
// ─────────────────────────────────────────────────────────────────────────
let _PROMPREMRegRegister_R7gwB10T05;
try {
  // eslint-disable-next-line global-require
  _PROMPREMRegRegister_R7gwB10T05 = require("../../models/Compliance/PROMPREMRegRegisterModel");
} catch (_) { /* model not present in some deployments */ }
const _crypto_PROMPREM_R7gwB10T05 = require("crypto");

async function emitPROMPREMReg(payload = {}) {
  try {
    if (!_PROMPREMRegRegister_R7gwB10T05) return null;
    const data = payload || {};
    if (!data.UHID) return null;
    if (!data.instrument) return null;
    if (!data.administeredAt) return null;

    const sourceRef = data.sourceRef || _crypto_PROMPREM_R7gwB10T05.randomUUID();

    // Find-or-create by sourceRef for idempotency.
    try {
      const existing = await _PROMPREMRegRegister_R7gwB10T05.findOne({ sourceRef }).lean();
      if (existing) return existing;
    } catch (_) { /* non-fatal */ }

    const actorMeta = _actor(data.actor || {});
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(
      data.UHID,
      data.admissionId || null,
    );

    // Scores can come in as a plain object or a Map — Mongoose handles both
    // when assigned to a Map field; ensure we don't pass undefined.
    const scoresIn = data.scores && typeof data.scores === "object" ? data.scores : {};

    const row = await _PROMPREMRegRegister_R7gwB10T05.create({
      patientId: data.patientId || null,
      UHID: String(data.UHID).toUpperCase(),
      patientName: data.patientName || "",
      admissionId: canonicalAdmissionId,
      admissionNumber: data.admissionNumber || "",
      instrument: data.instrument,
      administeredAt: new Date(data.administeredAt),
      administeredByEmpId: data.administeredByEmpId || "",
      administeredByName: data.administeredByName || actorMeta.byName || "",
      administeredByUserId: actorMeta.byUserId,
      scores: scoresIn,
      comments: data.comments || "",
      recommendation: data.recommendation || "",
      dischargeContext: data.dischargeContext != null ? !!data.dischargeContext : true,
      status: data.status || "Closed",
      sourceRef,
      sourceType: data.sourceType || "Manual",
      hospitalId: data.hospitalId || null,
      auditTrail: [{
        action: "CREATED",
        at: new Date(),
        ...actorMeta,
        notes: `instrument=${data.instrument} dischargeContext=${data.dischargeContext != null ? !!data.dischargeContext : true}`,
      }],
    });
    return row;
  } catch (e) {
    if (e?.code === 11000) return null; // duplicate sourceRef — idempotent no-op
    // eslint-disable-next-line no-console
    console.error(
      "[nabhRegisterEmitter] emitPROMPREMReg FAILED:",
      e.message,
      "— UHID:", payload?.UHID,
      "instrument:", payload?.instrument,
    );
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// Exports
// ═════════════════════════════════════════════════════════════════════════

module.exports = {
  emitBloodSugar,
  emitBloodSugarFromVitalSheet,
  emitEmergency,
  emitEmergencyTriage,
  emitEmergencyDisposition,
  emitBloodTransfusion,
  emitPain,
  emitFallRisk,
  emitPressureUlcer,
  emitDVT,
  emitFromNursingAssessment,
  // R7bu — six new NABH registers
  emitOT,
  emitASA,
  emitReadmission,
  emitMortality,
  emitRestraint,
  emitAntimicrobial,
  // R7en — ECG register
  emitECG,
  // R7gw-B9-T01 — Sentinel-event register
  emitSentinelEvent,
  // R7gw-B9-B9-T06 — Hand Hygiene register (NABH HIC.3)
  emitHandHygiene,
  // R7gw-B9-T02 — Near-Miss Event register (NABH QPS.5)
  emitNearMissEvent,
  // R7gw-B9-T04 — Medication Error register (NABH MOM.4)
  emitMedicationError,
  // R7gw-B9-B9-T07 — LAMA / DAMA register (NABH AAC.4)
  emitLAMA,
  // R7gw-B9-B9-T03 — RCA register (NABH QPS.1) + sentinel→RCA wrapper
  emitRCA,
  emitSentinelEventWithRCA,
  // R7gw-B9-T05 — HAI Surveillance register (NABH HIC.4)
  emitHAISurveillance,
  // R7gw-B10-T02 — MSO session log register (NABH PRE.1)
  emitMSOLog,
  // R7gw-B10-T07 — Statutory Compliance register (NABH AAC.16)
  emitStatutoryCompliance,
  // R7gw-B10-T01 — Antibiogram register (NABH HIC.6)
  emitAntibiogram,
  // R7gw-B10-T03 — ESG Compliance register (NABH 6th-ed Environment)
  emitESGCompliance,
  // R7gw-B10-T04 — Wellness Program register (NABH HRM.6)
  emitWellnessProgram,
  // R7gw-B10-T06 — Facilities Maintenance Log register (NABH FMS.5)
  emitFacilitiesMaintenanceLog,
  // R7gw-B10-T05 — PROM / PREM register (NABH PRE.4 6th-ed)
  emitPROMPREMReg,
  // Helpers exposed for testing / re-use
  isAntibiotic,
  _deriveEcgFlags,
};
