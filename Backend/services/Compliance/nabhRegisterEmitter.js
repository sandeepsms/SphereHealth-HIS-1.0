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
      preTransfusion: {
        consentSigned: !!order?.preTransfusion?.consentSigned,
        consentFormId: order?.preTransfusion?.consentFormId || null,
        bp:    order?.preTransfusion?.bp    || "",
        pulse: order?.preTransfusion?.pulse || null,
        temp:  order?.preTransfusion?.temp  || null,
        spo2:  order?.preTransfusion?.spo2  || null,
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

async function emitPain(args = {}) {
  try {
    const { assessment, actor = {} } = args;
    if (!assessment?._id || !assessment?.UHID) return null;
    const data = assessment.data || {};
    const score = Number(data.painScale);
    if (!Number.isFinite(score)) return null;

    const severity = _painSeverity(score);
    const escalated = score >= 7;
    const actorMeta = _actor(actor);
    // R7bw — resolve canonical active admission so stale form-state can't
    // strand the row on a dedupe-cancelled admission (NABH IPSG cohort).
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(assessment.UHID, assessment.admissionId || null);

    const row = await PainAssessmentRegister.create({
      patientId: assessment.patientId || null,
      UHID: assessment.UHID,
      patientName: assessment.patientName || "",
      admissionId: canonicalAdmissionId,
      painScale: score,
      severity,
      scaleUsed: data.scaleUsed || "NRS",
      site: data.site || "",
      character: data.character || "",
      durationMinutes: data.durationMinutes || null,
      intervention: data.intervention || "",
      reassessmentDue: data.reassessmentDue ? new Date(data.reassessmentDue) : null,
      assessedAt: assessment.recordedAt || new Date(),
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

async function emitFallRisk(args = {}) {
  try {
    const { assessment, actor = {} } = args;
    if (!assessment?._id || !assessment?.UHID) return null;
    const data = assessment.data || {};
    const score = Number(data.morseScore);
    if (!Number.isFinite(score)) return null;

    const riskTier = _morseRiskTier(score);
    const highRisk = riskTier === "High";
    const actorMeta = _actor(actor);
    // R7bw — resolve canonical active admission so stale form-state can't
    // strand the row on a dedupe-cancelled admission.
    const canonicalAdmissionId = await _resolveCanonicalAdmissionId(assessment.UHID, assessment.admissionId || null);

    const row = await FallRiskRegister.create({
      patientId: assessment.patientId || null,
      UHID: assessment.UHID,
      patientName: assessment.patientName || "",
      admissionId: canonicalAdmissionId,
      morseScore: score,
      riskTier,
      historyOfFalling: !!data.historyOfFalling,
      secondaryDx: !!data.secondaryDx,
      ambulatoryAid: data.ambulatoryAid || "",
      ivTherapy: !!data.ivTherapy,
      gait: data.gait || "",
      mentalStatus: data.mentalStatus || "",
      interventionBundle: data.interventionBundle || "",
      assessedAt: assessment.recordedAt || new Date(),
      assessedBy: assessment.recordedBy || actorMeta.byName || "",
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

async function emitPressureUlcer(args = {}) {
  try {
    const { assessment, actor = {} } = args;
    if (!assessment?._id || !assessment?.UHID) return null;
    const data = assessment.data || {};
    const score = Number(data.bradenScore);
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
      repositioningFreq: data.repositioningFreq || "",
      pressureMattress: !!data.pressureMattress,
      nutritionConsult: !!data.nutritionConsult,
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
        await emitBloodSugar({
          patient,
          admission: sheet.admissionId ? { _id: sheet.admissionId, admissionNumber: sheet.admissionNumber || "" } : null,
          reading: {
            value,
            unit: v?.unit || "mg/dL",
            type: String(k).toUpperCase().includes("FBS") ? "FBS"
                : String(k).toUpperCase().includes("PPBS") ? "PPBS"
                : "RBS",
            sampleType: "capillary",
            takenAt,
            location: "Ward",
            sourceRef: sheet._id,
            sourceType: "VitalSheet",
            notes: entry.notes || "",
          },
          actor,
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
      surgeonId: details.surgeonId || source.surgeonId || null,
      assistantNames: Array.isArray(details.assistantNames) ? details.assistantNames : [],
      anaesthetistName: details.anaesthetistName || procedureNote?.anaesthetistName || "",
      anaesthetistId: details.anaesthetistId || procedureNote?.anaesthetistId || null,
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
      createdBy: actorMeta.byUserId,
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
    const asaGrade = String(note.asaGrade || note.data?.asaGrade || "").toUpperCase();
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
      emergencyModifier: !!data.emergencyModifier,
      anaesthesiaType: data.anaesthesiaType || "General",
      technique: data.technique || "",
      airwayPlan: data.airwayPlan || "",
      anaesthetistName: data.anaesthetistName || actorMeta.byName || "",
      anaesthetistId: data.anaesthetistId || null,
      assistantName: data.assistantName || "",
      fastingHours: data.fastingHours != null ? Number(data.fastingHours) : null,
      allergies: Array.isArray(data.allergies) ? data.allergies : [],
      comorbidities: Array.isArray(data.comorbidities) ? data.comorbidities : [],
      preOpVitals: {
        bp:    data.preOpVitals?.bp    || data.bp    || "",
        pulse: data.preOpVitals?.pulse || data.pulse || null,
        temp:  data.preOpVitals?.temp  || data.temp  || null,
        spo2:  data.preOpVitals?.spo2  || data.spo2  || null,
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
      createdBy: actorMeta.byUserId,
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
      createdBy: actorMeta.byUserId,
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

    const dateOfDeath = dischargeSummary?.deathDate
      || deathNote?.dateOfDeath
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
      timeOfDeath: dischargeSummary?.deathTime || deathNote?.timeOfDeath || "",
      placeOfDeath: deathNote?.placeOfDeath || dischargeSummary?.placeOfDeath || "Ward",
      primaryCause: dischargeSummary?.causeOfDeath
        || deathNote?.primaryCause
        || dischargeSummary?.primaryDiagnosis
        || "Not Specified",
      immediateCauseOfDeath: dischargeSummary?.immediateCauseOfDeath || deathNote?.immediateCauseOfDeath || "",
      antecedentCauseOfDeath: dischargeSummary?.antecedentCauseOfDeath || deathNote?.antecedentCauseOfDeath || "",
      underlyingCause: deathNote?.underlyingCause || "",
      contributoryCauses: Array.isArray(deathNote?.contributoryCauses) ? deathNote.contributoryCauses : [],
      manner: deathNote?.manner || "Natural",
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
      attendingDoctorId: admission?.attendingDoctorId || null,
      certifyingDoctor: actorMeta.byName || dischargeSummary?.finalizedByName || "",
      certifyingDoctorId: actorMeta.byUserId,
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
      createdBy: actorMeta.byUserId,
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
      orderingDoctorId: restraint.orderingDoctorId || actorMeta.byUserId,
      orderingDoctorRole: restraint.orderingDoctorRole || actorMeta.byRole,
      doctorOrderId: restraint.doctorOrderId || null,
      appliedBy: restraint.appliedBy || actorMeta.byName || "",
      appliedByUserId: restraint.appliedByUserId || actorMeta.byUserId,
      removedAt: restraint.removedAt ? new Date(restraint.removedAt) : null,
      removedBy: restraint.removedBy || "",
      removedByUserId: restraint.removedByUserId || null,
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
      createdBy: actorMeta.byUserId,
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
      indication: details.indication || order.indication || order.notes || details.diagnosis || "",
      indicationType,
      suspectedSite: details.suspectedSite || "",
      prophylactic: !!details.prophylactic,
      prophylaxisType: details.prophylaxisType || "",
      prophylaxisDurationHours: details.prophylaxisDurationHours || null,
      cultureSent: !!details.cultureSent,
      cultureSentAt: details.cultureSentAt ? new Date(details.cultureSentAt) : null,
      cultureResultPending: details.cultureSent ? true : false,
      orderingDoctor: order.orderedByName || actorMeta.byName || "",
      orderingDoctorId: order.orderedBy || actorMeta.byUserId,
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
      createdBy: actorMeta.byUserId,
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
  // Helpers exposed for testing / re-use
  isAntibiotic,
};
