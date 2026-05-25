/**
 * nabhRegisterController.js — R7bo
 *
 * Read-mostly controllers for the NABH compliance registers added in R7bo:
 *   - Blood Sugar (RBS)
 *   - Emergency
 *   - Blood Transfusion
 *
 * List endpoints support date-range, UHID, and register-specific filters
 * (critical, triage category, reaction). A `dashboard-summary` endpoint
 * powers the NABH Inspection Dashboard front-end (today count + 7-day
 * count + last entry per register).
 */
"use strict";

const BloodSugarRegister = require("../../models/Compliance/BloodSugarRegisterModel");
const EmergencyRegister = require("../../models/Compliance/EmergencyRegisterModel");
const BloodTransfusionRegister = require("../../models/Compliance/BloodTransfusionRegisterModel");
const PainAssessmentRegister = require("../../models/Compliance/PainAssessmentRegisterModel");
const FallRiskRegister = require("../../models/Compliance/FallRiskRegisterModel");
const PressureUlcerRegister = require("../../models/Compliance/PressureUlcerRegisterModel");
const DVTRegister = require("../../models/Compliance/DVTRegisterModel");
// R7bx — six new NABH registers (COP.10/13/16/17/18 + MOM.7)
const OTRegister = require("../../models/Compliance/OTRegisterModel");
const ASARegister = require("../../models/Compliance/ASARegisterModel");
const ReadmissionRegister = require("../../models/Compliance/ReadmissionRegisterModel");
const MortalityRegister = require("../../models/Compliance/MortalityRegisterModel");
const RestraintRegister = require("../../models/Compliance/RestraintRegisterModel");
const AntimicrobialUseRegister = require("../../models/Compliance/AntimicrobialUseRegisterModel");
const emitter = require("../../services/Compliance/nabhRegisterEmitter");

function _dateRange(query) {
  const out = {};
  if (query.startDate) out.$gte = new Date(query.startDate);
  if (query.endDate) {
    const e = new Date(query.endDate);
    e.setHours(23, 59, 59, 999);
    out.$lte = e;
  }
  return Object.keys(out).length ? out : null;
}

function _pageLimit(query) {
  const page  = Math.max(1, parseInt(query.page  || "1", 10));
  const limit = Math.min(500, Math.max(1, parseInt(query.limit || "50", 10)));
  return { page, limit, skip: (page - 1) * limit };
}

// ─────────────────────────────────────────────────────────────────────────
// Blood Sugar Register
// ─────────────────────────────────────────────────────────────────────────

exports.listBloodSugar = async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.admissionId) q.admissionId = req.query.admissionId;
    if (req.query.readingType) q.readingType = req.query.readingType;
    if (req.query.critical === "true") q.criticalFlag = true;
    const dr = _dateRange(req.query);
    if (dr) q.takenAt = dr;

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      BloodSugarRegister.find(q).sort({ takenAt: -1 }).skip(skip).limit(limit).lean(),
      BloodSugarRegister.countDocuments(q),
    ]);
    res.json({ success: true, data: rows, pagination: { page, limit, total } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.createBloodSugar = async (req, res) => {
  try {
    const { patient, admission, reading, insulin } = req.body || {};
    if (!patient?._id || !patient?.UHID) {
      return res.status(400).json({ success: false, message: "patient {_id, UHID} required" });
    }
    if (!reading?.value) {
      return res.status(400).json({ success: false, message: "reading.value required" });
    }
    const row = await emitter.emitBloodSugar({
      patient,
      admission,
      reading: { ...reading, sourceType: "Manual" },
      insulin,
      actor: req.user,
    });
    if (!row) return res.status(400).json({ success: false, message: "Could not write register row" });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Emergency Register
// ─────────────────────────────────────────────────────────────────────────

exports.listEmergency = async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.triageCategory) q.triageCategory = req.query.triageCategory;
    if (req.query.disposition) q.disposition = req.query.disposition;
    if (req.query.mlc === "true") q.isMLC = true;
    const dr = _dateRange(req.query);
    if (dr) q.arrivalAt = dr;

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      EmergencyRegister.find(q).sort({ arrivalAt: -1 }).skip(skip).limit(limit).lean(),
      EmergencyRegister.countDocuments(q),
    ]);
    res.json({ success: true, data: rows, pagination: { page, limit, total } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Blood Transfusion Register
// ─────────────────────────────────────────────────────────────────────────

exports.createBloodTransfusion = async (req, res) => {
  try {
    const { patient, admission, order } = req.body || {};
    if (!patient?._id || !patient?.UHID) {
      return res.status(400).json({ success: false, message: "patient {_id, UHID} required" });
    }
    if (!order?.bloodGroup) {
      return res.status(400).json({ success: false, message: "order.bloodGroup required" });
    }
    // Synthesise a doctor-order-shaped object so the emitter writes the
    // canonical draft row. Idempotency hinges on doctorOrderId — for
    // manual writes we generate a fresh ObjectId so each manual entry is
    // its own row.
    const mongoose = require("mongoose");
    const fakeOrder = {
      _id: order._id || new mongoose.Types.ObjectId(),
      bloodGroup: order.bloodGroup,
      rhFactor: order.rhFactor,
      units: order.units || 1,
      indication: order.indication || "",
      orderedAt: order.orderedAt || new Date(),
    };
    const row = await emitter.emitBloodTransfusion({
      order: fakeOrder,
      patient,
      admission,
      actor: req.user,
    });
    if (!row) return res.status(400).json({ success: false, message: "Could not write register row" });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.listBloodTransfusion = async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.status) q.status = req.query.status;
    if (req.query.reaction === "true") q["reaction.occurred"] = true;
    if (req.query.bagNumber) q["bagsIssued.bagNumber"] = String(req.query.bagNumber).toUpperCase();
    const dr = _dateRange(req.query);
    if (dr) q.startedAt = dr;

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      BloodTransfusionRegister.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      BloodTransfusionRegister.countDocuments(q),
    ]);
    res.json({ success: true, data: rows, pagination: { page, limit, total } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Pain / Fall-Risk / Pressure-Ulcer Registers (R7bp — auto-popped)
// ─────────────────────────────────────────────────────────────────────────

function _listRegister(Model, dateField) {
  return async (req, res) => {
    try {
      const q = {};
      if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
      if (req.query.admissionId) q.admissionId = req.query.admissionId;
      if (req.query.severity) q.severity = req.query.severity;
      if (req.query.riskTier) q.riskTier = req.query.riskTier;
      if (req.query.escalated === "true") q.escalatedFlag = true;
      if (req.query.highRisk === "true") q.highRiskFlag = true;
      if (req.query.sentinel === "true") q.sentinelFlag = true;
      const dr = _dateRange(req.query);
      if (dr) q[dateField] = dr;

      const { page, limit, skip } = _pageLimit(req.query);
      const [rows, total] = await Promise.all([
        Model.find(q).sort({ [dateField]: -1 }).skip(skip).limit(limit).lean(),
        Model.countDocuments(q),
      ]);
      res.json({ success: true, data: rows, pagination: { page, limit, total } });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  };
}

exports.listPain          = _listRegister(PainAssessmentRegister, "assessedAt");
exports.listFallRisk      = _listRegister(FallRiskRegister, "assessedAt");
exports.listPressureUlcer = _listRegister(PressureUlcerRegister, "assessedAt");

// DVT register accepts extra filters: capriniTier, bleed, escalated
exports.listDVT = async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.admissionId) q.admissionId = req.query.admissionId;
    if (req.query.capriniTier) q.capriniTier = req.query.capriniTier;
    if (req.query.escalated === "true") q.escalatedFlag = true;
    if (req.query.bleedingRisk === "true") q.bleedingRiskFlag = true;
    if (req.query.escalationStatus) q.escalationStatus = req.query.escalationStatus;
    const dr = _dateRange(req.query);
    if (dr) q.assessedAt = dr;

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      DVTRegister.find(q).sort({ assessedAt: -1 }).skip(skip).limit(limit).lean(),
      DVTRegister.countDocuments(q),
    ]);
    res.json({ success: true, data: rows, pagination: { page, limit, total } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// R7bx — Six new NABH registers (COP.10/13/16/17/18 + MOM.7)
// ─────────────────────────────────────────────────────────────────────────
// Each list endpoint takes the same shape: from/to date range on the
// canonical date field for the register, plus a free-text `search` that
// matches UHID / patient name / a register-specific identifier.

function _searchOr(search, fields) {
  if (!search) return null;
  const safe = String(search).trim();
  if (!safe) return null;
  const rx = new RegExp(safe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return { $or: fields.map((f) => ({ [f]: rx })) };
}

// OT Register — NABH COP.10
exports.listOT = async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.status) q.status = req.query.status;
    if (req.query.emergencyOnly === "true") q.emergencyCase = true;
    const dr = _dateRange({ startDate: req.query.from || req.query.startDate, endDate: req.query.to || req.query.endDate });
    if (dr) q.occurredAt = dr;
    const or = _searchOr(req.query.search, ["UHID", "patientName", "otNumber", "surgeryName", "surgeonName"]);
    if (or) Object.assign(q, or);

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      OTRegister.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      OTRegister.countDocuments(q),
    ]);
    res.json({ success: true, data: rows, total, pagination: { page, limit, total } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ASA Register — NABH COP.13
exports.listASA = async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.asaGrade) q.asaGrade = req.query.asaGrade;
    if (req.query.status) q.status = req.query.status;
    const dr = _dateRange({ startDate: req.query.from || req.query.startDate, endDate: req.query.to || req.query.endDate });
    if (dr) q.occurredAt = dr;
    const or = _searchOr(req.query.search, ["UHID", "patientName", "anaesthetistName"]);
    if (or) Object.assign(q, or);

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      ASARegister.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ASARegister.countDocuments(q),
    ]);
    res.json({ success: true, data: rows, total, pagination: { page, limit, total } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Readmission Register — NABH COP.16
exports.listReadmission = async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.readmissionType) q.readmissionType = req.query.readmissionType;
    if (req.query.sameDiagnosis === "true") q.sameDiagnosis = true;
    const dr = _dateRange({ startDate: req.query.from || req.query.startDate, endDate: req.query.to || req.query.endDate });
    if (dr) q.occurredAt = dr;
    const or = _searchOr(req.query.search, ["UHID", "patientName", "currentAdmissionNumber", "previousAdmissionNumber", "currentDiagnosis"]);
    if (or) Object.assign(q, or);

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      ReadmissionRegister.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ReadmissionRegister.countDocuments(q),
    ]);
    res.json({ success: true, data: rows, total, pagination: { page, limit, total } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Mortality Register — NABH COP.18
exports.listMortality = async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.manner) q.manner = req.query.manner;
    if (req.query.mlc === "true") q.isMLC = true;
    if (req.query.bruceCategory) q.bruceCategory = req.query.bruceCategory;
    const dr = _dateRange({ startDate: req.query.from || req.query.startDate, endDate: req.query.to || req.query.endDate });
    if (dr) q.dateOfDeath = dr;
    const or = _searchOr(req.query.search, ["UHID", "patientName", "mortalityNumber", "primaryCause", "underlyingCause"]);
    if (or) Object.assign(q, or);

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      MortalityRegister.find(q).sort({ dateOfDeath: -1 }).skip(skip).limit(limit).lean(),
      MortalityRegister.countDocuments(q),
    ]);
    res.json({ success: true, data: rows, total, pagination: { page, limit, total } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Restraint Register — NABH COP.17
exports.listRestraint = async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.status) q.status = req.query.status;
    if (req.query.restraintType) q.restraintType = req.query.restraintType;
    const dr = _dateRange({ startDate: req.query.from || req.query.startDate, endDate: req.query.to || req.query.endDate });
    if (dr) q.occurredAt = dr;
    const or = _searchOr(req.query.search, ["UHID", "patientName", "orderingDoctor", "reason"]);
    if (or) Object.assign(q, or);

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      RestraintRegister.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      RestraintRegister.countDocuments(q),
    ]);
    res.json({ success: true, data: rows, total, pagination: { page, limit, total } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Antimicrobial-Use Register — NABH MOM.7 (AMS)
exports.listAntimicrobial = async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.aware) q.watchAccessReserve = req.query.aware;
    if (req.query.indicationType) q.indicationType = req.query.indicationType;
    if (req.query.prophylactic === "true") q.prophylactic = true;
    if (req.query.status) q.status = req.query.status;
    const dr = _dateRange({ startDate: req.query.from || req.query.startDate, endDate: req.query.to || req.query.endDate });
    if (dr) q.startedAt = dr;
    const or = _searchOr(req.query.search, ["UHID", "patientName", "antibiotic", "indication", "orderingDoctor"]);
    if (or) Object.assign(q, or);

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      AntimicrobialUseRegister.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AntimicrobialUseRegister.countDocuments(q),
    ]);
    res.json({ success: true, data: rows, total, pagination: { page, limit, total } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Dashboard summary
// ─────────────────────────────────────────────────────────────────────────

exports.dashboardSummary = async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    async function summary(Model, dateField) {
      const [todayCount, sevenDayCount, last] = await Promise.all([
        Model.countDocuments({ [dateField]: { $gte: startOfToday } }),
        Model.countDocuments({ [dateField]: { $gte: sevenDaysAgo } }),
        Model.findOne().sort({ [dateField]: -1 }).select(`${dateField} createdAt`).lean(),
      ]);
      return { todayCount, sevenDayCount, lastEntryAt: last ? (last[dateField] || last.createdAt) : null };
    }

    const [bs, er, bt, pn, fr, pu, dv, ot, asa, rea, mort, res2, amu] = await Promise.all([
      summary(BloodSugarRegister, "takenAt"),
      summary(EmergencyRegister, "arrivalAt"),
      summary(BloodTransfusionRegister, "createdAt"),
      summary(PainAssessmentRegister, "assessedAt"),
      summary(FallRiskRegister, "assessedAt"),
      summary(PressureUlcerRegister, "assessedAt"),
      summary(DVTRegister, "assessedAt"),
      // R7bx — six new registers
      summary(OTRegister, "createdAt"),
      summary(ASARegister, "createdAt"),
      summary(ReadmissionRegister, "createdAt"),
      summary(MortalityRegister, "dateOfDeath"),
      summary(RestraintRegister, "createdAt"),
      summary(AntimicrobialUseRegister, "createdAt"),
    ]);

    res.json({
      success: true,
      data: [
        { id: "blood-sugar", name: "Blood Sugar (RBS) Register", route: "/compliance/nabh/blood-sugar", nabhRef: "AAC.4 + COP.1.b", ...bs },
        { id: "emergency", name: "Emergency Register", route: "/compliance/nabh/emergency", nabhRef: "AAC.1 + AAC.4", ...er },
        { id: "blood-transfusion", name: "Blood Transfusion Register", route: "/compliance/nabh/blood-transfusion", nabhRef: "MOM.4 + COP.16", ...bt },
        { id: "pain", name: "Pain Assessment Register", route: "/compliance/nabh/pain", nabhRef: "IPSG.5 + COP.7", ...pn },
        { id: "fall-risk", name: "Fall Risk Register", route: "/compliance/nabh/fall-risk", nabhRef: "PSQ + IPSG.6", ...fr },
        { id: "pressure-ulcer", name: "Pressure Ulcer Register", route: "/compliance/nabh/pressure-ulcer", nabhRef: "HIC.4 + COP.8", ...pu },
        { id: "dvt", name: "DVT / VTE Caprini Register", route: "/compliance/nabh/dvt", nabhRef: "MOM.7 + AAC.4 + COP.12", ...dv },
        // R7bx — six new registers
        { id: "ot", name: "OT Register", route: "/compliance/nabh/ot-register", nabhRef: "COP.10", ...ot },
        { id: "asa", name: "Anaesthesia (ASA) Register", route: "/compliance/nabh/asa-register", nabhRef: "COP.13", ...asa },
        { id: "readmission", name: "Readmission Register", route: "/compliance/nabh/readmission-register", nabhRef: "COP.16", ...rea },
        { id: "mortality", name: "Mortality Register", route: "/compliance/nabh/mortality-register", nabhRef: "COP.18", ...mort },
        { id: "restraint", name: "Restraint Register", route: "/compliance/nabh/restraint-register", nabhRef: "COP.17", ...res2 },
        { id: "antimicrobial", name: "Antimicrobial Use Register", route: "/compliance/nabh/antimicrobial-register", nabhRef: "MOM.7 (AMS)", ...amu },
      ],
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
