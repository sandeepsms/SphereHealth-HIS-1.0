/**
 * ecgRegisterController.js — R7en / NABH AAC.4 + IPSG.2 + COP.7
 *
 * Manual-entry + reporting surface for the ECG Register.
 *
 * Endpoints (mounted at /api/ecg-register):
 *   POST   /                 — Manual entry. Looks up patient + active
 *                              admission by UHID and calls emitECG().
 *   GET    /                 — Date-range list with optional ?critical=true,
 *                              ?abnormal=true, ?status=, ?UHID=.
 *   GET    /:id              — Single row by _id.
 *   PATCH  /:id/report       — File the report (rhythm + intervals +
 *                              interpretation + reportedByName). Auto-derives
 *                              abnormal/critical flags + computes
 *                              tatPerformedToReportedMin. Refused if isLocked.
 *   PATCH  /:id/review       — Cardiologist sign-off (reviewedBy + notes).
 *
 * Permission: writes gated on `vitals.write` (Admin + Nurse + Doctor — same
 * tier that captures the underlying vitals + clinical reading). Reads on
 * `compliance.read`. Cardiologist review on `doctor-orders.write` since it's
 * a doctor-only action (Nurse cannot sign off a report).
 */
"use strict";

const mongoose = require("mongoose");
const ECGRegister = require("../../models/Compliance/ECGRegisterModel");
const Patient = require("../../models/Patient/patientModel");
const Admission = require("../../models/Patient/admissionModel");
const emitter = require("../../services/Compliance/nabhRegisterEmitter");

const _actor = (req) => ({
  _id: req.user?._id || req.user?.id || null,
  fullName: req.user?.fullName || req.user?.name || "",
  role: req.user?.role || "",
});

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
  const page = Math.max(1, parseInt(query.page || "1", 10));
  const limit = Math.min(500, Math.max(1, parseInt(query.limit || "50", 10)));
  return { page, limit, skip: (page - 1) * limit };
}

// ─────────────────────────────────────────────────────────────────────────
// POST / — manual entry
// ─────────────────────────────────────────────────────────────────────────
exports.createECG = async (req, res) => {
  try {
    const body = req.body || {};
    const UHID = String(body.UHID || body.patient?.UHID || "").trim().toUpperCase();
    if (!UHID) return res.status(400).json({ success: false, message: "UHID is required" });

    // Lookup patient
    const patient = await Patient.findOne({ UHID })
      .select("_id UHID fullName firstName lastName name gender age")
      .lean();
    if (!patient) return res.status(404).json({ success: false, message: `No patient found for UHID ${UHID}` });

    // Lookup active admission (optional — OPD entries leave admissionId null)
    const admission = await Admission.findOne({ UHID, status: "Active" })
      .select("_id admissionNumber ward wardName")
      .sort({ admissionDate: -1 })
      .lean();

    // Build the ecg payload from the body. Accept either flat fields or a
    // nested `ecg` block (mirrors emitter signature exactly so manual entry
    // and auto-emit share the same shape).
    const ecgPayload = body.ecg && typeof body.ecg === "object" ? body.ecg : body;

    const row = await emitter.emitECG({
      patient,
      admission,
      ecg: {
        ...ecgPayload,
        sourceType: "Manual",
      },
      actor: req.user || {},
    });

    if (!row) {
      return res.status(400).json({ success: false, message: "Could not write ECG register row (check server logs)" });
    }
    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// GET / — list with filters
// ─────────────────────────────────────────────────────────────────────────
exports.listECG = async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.admissionId) q.admissionId = req.query.admissionId;
    if (req.query.critical === "true") q.criticalFlag = true;
    if (req.query.abnormal === "true") q.abnormalFlag = true;
    if (req.query.status) q.status = req.query.status;
    if (req.query.location) q.location = req.query.location;
    if (req.query.indicationCategory) q.indicationCategory = req.query.indicationCategory;
    const dr = _dateRange(req.query);
    if (dr) q.performedAt = dr;

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      ECGRegister.find(q).sort({ performedAt: -1 }).skip(skip).limit(limit).lean(),
      ECGRegister.countDocuments(q),
    ]);
    return res.json({ success: true, data: rows, total, pagination: { page, limit, total } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /:id — single row
// ─────────────────────────────────────────────────────────────────────────
exports.getECGById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const row = await ECGRegister.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "ECG row not found" });
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// PATCH /:id/report — file the report
// ─────────────────────────────────────────────────────────────────────────
exports.reportECG = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const row = await ECGRegister.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "ECG row not found" });
    if (row.isLocked) {
      return res.status(409).json({ success: false, message: "Row is locked — cannot be edited" });
    }

    const body = req.body || {};
    const actor = _actor(req);

    // Findings updates
    const num = (v) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

    if (body.rhythm !== undefined) row.rhythm = body.rhythm || "";
    if (body.heartRate !== undefined) row.heartRate = num(body.heartRate);
    if (body.prInterval !== undefined) row.prInterval = num(body.prInterval);
    if (body.qrsDuration !== undefined) row.qrsDuration = num(body.qrsDuration);
    if (body.qtInterval !== undefined) row.qtInterval = num(body.qtInterval);
    if (body.qtcInterval !== undefined) row.qtcInterval = num(body.qtcInterval);
    if (body.axis !== undefined) row.axis = body.axis || "";
    if (body.stChanges !== undefined) row.stChanges = body.stChanges || "";
    if (Array.isArray(body.leadsAffected)) row.leadsAffected = body.leadsAffected;
    if (body.interpretation !== undefined) row.interpretation = body.interpretation || "";

    // Personnel
    if (body.reportedByName) row.reportedByName = body.reportedByName;
    if (body.reportedBy) {
      row.reportedBy = mongoose.isValidObjectId(body.reportedBy) ? body.reportedBy : actor._id;
    } else if (!row.reportedBy) {
      row.reportedBy = actor._id;
      if (!row.reportedByName) row.reportedByName = actor.fullName || "";
    }

    // Optional re-stamp of performedBy if not already set
    if (!row.performedBy && body.performedBy) {
      row.performedBy = mongoose.isValidObjectId(body.performedBy) ? body.performedBy : null;
    }
    if (!row.performedByName && body.performedByName) {
      row.performedByName = body.performedByName;
    }

    // Stamp reportedAt + compute TAT
    const now = body.reportedAt ? new Date(body.reportedAt) : new Date();
    row.reportedAt = now;
    if (row.performedAt) {
      const ms = now.getTime() - new Date(row.performedAt).getTime();
      row.tatPerformedToReportedMin = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : null;
    }

    // Re-derive flags from the current row state
    const wasAlreadyCritical = !!row.criticalFlag;
    const { abnormalFlag, criticalFlag, criticalReason } = emitter._deriveEcgFlags({
      rhythm: row.rhythm,
      heartRate: row.heartRate,
      stChanges: row.stChanges,
      qtcInterval: row.qtcInterval,
    });
    row.abnormalFlag = abnormalFlag;
    row.criticalFlag = criticalFlag;

    row.status = "Reported";

    row.auditTrail.push({
      action: "REPORTED",
      at: new Date(),
      byUserId: actor._id,
      byName: actor.fullName,
      byRole: actor.role,
      reason: `rhythm=${row.rhythm || "?"} HR=${row.heartRate ?? "?"}`,
    });
    if (criticalFlag && !wasAlreadyCritical) {
      row.auditTrail.push({
        action: "CRITICAL_FLAGGED",
        at: new Date(),
        byUserId: actor._id,
        byName: actor.fullName,
        byRole: actor.role,
        reason: criticalReason || "critical ECG finding",
      });
    }

    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// PATCH /:id/review — cardiologist sign-off
// ─────────────────────────────────────────────────────────────────────────
exports.reviewECG = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const row = await ECGRegister.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "ECG row not found" });
    if (row.isLocked) {
      return res.status(409).json({ success: false, message: "Row is locked — cannot be edited" });
    }

    const body = req.body || {};
    const actor = _actor(req);

    row.reviewedBy = body.reviewedBy && mongoose.isValidObjectId(body.reviewedBy)
      ? body.reviewedBy
      : actor._id;
    row.reviewedByName = body.reviewedByName || actor.fullName || "";
    row.reviewedAt = new Date();
    if (body.reviewNotes !== undefined) row.reviewNotes = String(body.reviewNotes || "").slice(0, 1000);
    row.status = "Reviewed";

    row.auditTrail.push({
      action: "REVIEWED",
      at: new Date(),
      byUserId: actor._id,
      byName: actor.fullName,
      byRole: actor.role,
      reason: body.reviewNotes ? String(body.reviewNotes).slice(0, 200) : "cardiologist sign-off",
    });

    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
