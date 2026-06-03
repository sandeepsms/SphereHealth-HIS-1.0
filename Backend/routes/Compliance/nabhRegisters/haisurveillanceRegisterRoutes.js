/**
 * haisurveillanceRegisterRoutes.js — R7gw-B9-T05 / NABH HIC.4
 *
 * HAI Surveillance Register surface. Auto-populated from the ICU-bundle
 * finalize path when CAUTI compliance <100 AND Foley dwellDays>3 AND a
 * positive UTI culture is present; also exposes a manual POST so IC
 * officers can log SSI / CDI / MRSA-bacteremia events surfaced from the
 * lab feed (culture results) or from ward-based observation.
 *
 * Endpoints (mounted at /api/nabh-registers/hai-surveillance):
 *   GET    /        — List with filters (?q, ?status, ?HAIType,
 *                     ?outcome, ?startDate, ?endDate)
 *   GET    /:id     — Single row by _id
 *   POST   /        — Manual entry (Admin / Doctor / Nurse / MRD)
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const HAISurveillanceRegister = require("../../../models/Compliance/HAISurveillanceRegisterModel");
const emitter = require("../../../services/Compliance/nabhRegisterEmitter");

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
// GET / — list with filters
// ─────────────────────────────────────────────────────────────────────────
router.get("/", requireAction("compliance.nabh.read"), async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.status) q.status = req.query.status;
    if (req.query.HAIType) q.HAIType = req.query.HAIType;
    if (req.query.outcome) q.outcome = req.query.outcome;

    // Free-text search across patient name + organism + antibiotic + UHID
    if (req.query.q) {
      const term = String(req.query.q).trim();
      if (term) {
        const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        q.$or = [
          { patientName: new RegExp(safe, "i") },
          { organismIsolated: new RegExp(safe, "i") },
          { antibioticPrescribed: new RegExp(safe, "i") },
          { identifiedByEmpId: new RegExp(safe, "i") },
          { UHID: new RegExp(safe, "i") },
          { HAIType: new RegExp(safe, "i") },
        ];
      }
    }

    const dr = _dateRange(req.query);
    if (dr) q.onsetDate = dr;

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      HAISurveillanceRegister.find(q).sort({ onsetDate: -1 }).skip(skip).limit(limit).lean(),
      HAISurveillanceRegister.countDocuments(q),
    ]);
    return res.json({ success: true, data: rows, total, pagination: { page, limit, total } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /:id — single row
// ─────────────────────────────────────────────────────────────────────────
router.get("/:id", validateObjectIdParam("id"), requireAction("compliance.nabh.read"), async (req, res) => {
  try {
    const row = await HAISurveillanceRegister.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "HAI surveillance row not found" });
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST / — manual entry (IC officer logs SSI / CDI / MRSA-bacteremia,
// or any HAI event surfaced outside the ICU bundle path)
// ─────────────────────────────────────────────────────────────────────────
router.post("/", requireAction("compliance.nabh.write"), async (req, res) => {
  try {
    const body = req.body || {};
    const UHID = String(body.UHID || "").trim().toUpperCase();
    if (!UHID) return res.status(400).json({ success: false, message: "UHID is required" });
    if (!body.HAIType) return res.status(400).json({ success: false, message: "HAIType is required" });

    const ALLOWED = ["CAUTI", "CLABSI", "VAP", "SSI", "CDI", "MRSA-Bacteremia"];
    if (!ALLOWED.includes(body.HAIType)) {
      return res.status(400).json({ success: false, message: `HAIType must be one of ${ALLOWED.join(", ")}` });
    }

    const row = await emitter.emitHAISurveillance({
      UHID,
      patientId: body.patientId || null,
      patientName: body.patientName || "",
      admissionId: mongoose.isValidObjectId(body.admissionId) ? body.admissionId : null,
      HAIType: body.HAIType,
      onsetDate: body.onsetDate || new Date(),
      identifiedByEmpId: body.identifiedByEmpId || "",
      deviceDays: body.deviceDays != null ? Number(body.deviceDays) : null,
      cultureSent: !!body.cultureSent,
      organismIsolated: body.organismIsolated || "",
      antibioticPrescribed: body.antibioticPrescribed || "",
      outcome: body.outcome || "",
      linkedICUBundleId: mongoose.isValidObjectId(body.linkedICUBundleId) ? body.linkedICUBundleId : null,
      status: body.status || "Open",
      // Manual entries get an explicit sourceRef so retries of the same
      // payload are idempotent. Caller can supply one; default to a UUID
      // inside the emitter.
      sourceRef: body.sourceRef || undefined,
      actor: req.user || {},
    });

    if (!row) {
      return res.status(400).json({ success: false, message: "Could not write HAI surveillance row (check server logs)" });
    }
    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
