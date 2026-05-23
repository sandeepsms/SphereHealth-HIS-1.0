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

    const row = await PainAssessmentRegister.create({
      patientId: assessment.patientId || null,
      UHID: assessment.UHID,
      patientName: assessment.patientName || "",
      admissionId: assessment.admissionId || null,
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

    const row = await FallRiskRegister.create({
      patientId: assessment.patientId || null,
      UHID: assessment.UHID,
      patientName: assessment.patientName || "",
      admissionId: assessment.admissionId || null,
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

    const row = await PressureUlcerRegister.create({
      patientId: assessment.patientId || null,
      UHID: assessment.UHID,
      patientName: assessment.patientName || "",
      admissionId: assessment.admissionId || null,
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

    const row = await DVTRegister.create({
      patientId: assessment.patientId || null,
      UHID: assessment.UHID,
      patientName: assessment.patientName || "",
      admissionId: assessment.admissionId || null,
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
};
