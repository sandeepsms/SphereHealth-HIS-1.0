/**
 * nearmisseventRegisterRoutes.js — R7gw-B9-T02 / NABH QPS.5
 *
 * Near-Miss Event Register surface. Manual-entry only (no auto-trigger
 * from existing emit hooks). Quality / Compliance officers and bedside
 * nurses log near-misses (intercepted wrong-med, prevented fall, caught
 * equipment failure) so the QPS Committee can chart safety-culture trends.
 *
 * Endpoints (mounted at /api/nabh-registers/near-miss-events):
 *   GET    /        — List with filters (?q, ?status, ?startDate, ?endDate,
 *                                        ?eventType, ?severityIfMissed, ?UHID)
 *   GET    /:id     — Single row by _id
 *   POST   /        — Manual entry (Admin / Doctor / Nurse / MRD)
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const NearMissEventRegister = require("../../../models/Compliance/NearMissEventRegisterModel");
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
    if (req.query.eventType) q.eventType = req.query.eventType;
    if (req.query.severityIfMissed) q.severityIfMissed = req.query.severityIfMissed;
    if (req.query.observedByEmpId) q.observedByEmpId = String(req.query.observedByEmpId).trim();

    // Free-text search across patient name, eventType, intervention, recommendation
    if (req.query.q) {
      const term = String(req.query.q).trim();
      if (term) {
        const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        q.$or = [
          { patientName:        new RegExp(safe, "i") },
          { eventType:          new RegExp(safe, "i") },
          { interventionTaken:  new RegExp(safe, "i") },
          { recommendation:     new RegExp(safe, "i") },
          { UHID:               new RegExp(safe, "i") },
          { observedByEmpId:    new RegExp(safe, "i") },
        ];
      }
    }

    const dr = _dateRange(req.query);
    if (dr) q.observedAt = dr;

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      NearMissEventRegister.find(q).sort({ observedAt: -1 }).skip(skip).limit(limit).lean(),
      NearMissEventRegister.countDocuments(q),
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
    const row = await NearMissEventRegister.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Near-miss row not found" });
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST / — manual entry
// ─────────────────────────────────────────────────────────────────────────
router.post("/", requireAction("compliance.nabh.write"), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.eventType) return res.status(400).json({ success: false, message: "eventType is required" });
    if (!body.observedAt) return res.status(400).json({ success: false, message: "observedAt is required" });
    if (!body.observedByEmpId) return res.status(400).json({ success: false, message: "observedByEmpId is required" });
    if (!body.severityIfMissed) return res.status(400).json({ success: false, message: "severityIfMissed is required" });

    const row = await emitter.emitNearMissEvent({
      UHID: body.UHID ? String(body.UHID).trim().toUpperCase() : "",
      patientId: mongoose.isValidObjectId(body.patientId) ? body.patientId : null,
      patientName: body.patientName || "",
      admissionId: mongoose.isValidObjectId(body.admissionId) ? body.admissionId : null,
      eventType: body.eventType,
      observedAt: body.observedAt,
      observedByEmpId: body.observedByEmpId,
      observedByName: body.observedByName || "",
      observedByRole: body.observedByRole || "",
      severityIfMissed: body.severityIfMissed,
      interventionTaken: body.interventionTaken || "",
      recommendation: body.recommendation || "",
      linkedSentinelId: mongoose.isValidObjectId(body.linkedSentinelId) ? body.linkedSentinelId : null,
      status: body.status || "Open",
      // Manual entries get an explicit sourceRef so retries on the same
      // payload are idempotent. Caller can supply one; default to a UUID.
      sourceRef: body.sourceRef || undefined,
      actor: req.user || {},
    });

    if (!row) {
      return res.status(400).json({ success: false, message: "Could not write near-miss row (check server logs)" });
    }
    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
