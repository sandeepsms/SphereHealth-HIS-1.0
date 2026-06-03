/**
 * sentineleventRegisterRoutes.js — R7gw-B9-T01 / NABH AAC.7 + MOM.4
 *
 * Sentinel-Event Register surface. Auto-populated from emitPressureUlcer
 * (HAPU stage III+) and emitFallRisk (fall-with-major-injury); also exposes
 * a manual POST path so Quality / Compliance officers can log events not
 * surfaced by existing emit hooks (wrong-patient surgery, suicide attempt,
 * retained foreign object, severe maternal morbidity, etc.).
 *
 * Endpoints (mounted at /api/nabh-registers/sentinel-events):
 *   GET    /        — List with filters (?q, ?status, ?startDate, ?endDate)
 *   GET    /:id     — Single row by _id
 *   POST   /        — Manual entry (Admin / Doctor / Nurse / MRD)
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const SentinelEventRegister = require("../../../models/Compliance/SentinelEventRegisterModel");
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
    if (req.query.severity) q.severity = req.query.severity;

    // Free-text search across patient name + immediateAction + eventType
    if (req.query.q) {
      const term = String(req.query.q).trim();
      if (term) {
        const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        q.$or = [
          { patientName: new RegExp(safe, "i") },
          { immediateAction: new RegExp(safe, "i") },
          { eventType: new RegExp(safe, "i") },
          { UHID: new RegExp(safe, "i") },
        ];
      }
    }

    const dr = _dateRange(req.query);
    if (dr) q.discoveredAt = dr;

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      SentinelEventRegister.find(q).sort({ discoveredAt: -1 }).skip(skip).limit(limit).lean(),
      SentinelEventRegister.countDocuments(q),
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
    const row = await SentinelEventRegister.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Sentinel-event row not found" });
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
    const UHID = String(body.UHID || "").trim().toUpperCase();
    if (!UHID) return res.status(400).json({ success: false, message: "UHID is required" });
    if (!body.eventType) return res.status(400).json({ success: false, message: "eventType is required" });

    const row = await emitter.emitSentinelEvent({
      UHID,
      patientId: body.patientId || null,
      patientName: body.patientName || "",
      admissionId: mongoose.isValidObjectId(body.admissionId) ? body.admissionId : null,
      eventType: body.eventType,
      discoveredAt: body.discoveredAt || new Date(),
      discoveredByEmpId: body.discoveredByEmpId || "",
      severity: body.severity || "Critical",
      immediateAction: body.immediateAction || "",
      rcaInitiated: !!body.rcaInitiated,
      rcaId: mongoose.isValidObjectId(body.rcaId) ? body.rcaId : null,
      status: body.status || "Open",
      // Manual entries get an explicit sourceRef so retries on the same
      // payload are idempotent. Caller can supply one; default to a UUID.
      sourceRef: body.sourceRef || undefined,
      actor: req.user || {},
    });

    if (!row) {
      return res.status(400).json({ success: false, message: "Could not write sentinel-event row (check server logs)" });
    }
    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
