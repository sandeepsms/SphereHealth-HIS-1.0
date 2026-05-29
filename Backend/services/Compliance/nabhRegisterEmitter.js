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
  // Helpers exposed for testing / re-use
  isAntibiotic,
  _deriveEcgFlags,
};
