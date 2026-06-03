/**
 * rcaRegisterRoutes.js — R7gw-B9-B9-T03 / NABH QPS.1 + AAC.7
 *
 * Read + manual-write endpoints for the Root-Cause Analysis register.
 * Mount under /api/rca-register in routes/index.js. Read tier matches the
 * other auto-populated NABH registers (compliance.read = Admin/Doctor/
 * Nurse/MRD); manual entry tier is compliance.read + the requireAction
 * intentionally re-using compliance.read because the QPS chair + Quality /
 * Patient-Safety committee are who file an RCA — these users typically
 * sit in Admin / MRD / Doctor roles.
 *
 * Endpoints:
 *   GET  /         — list with q text, status, dateRange, sentinelId
 *   GET  /:id      — single row
 *   POST /         — manual entry (QPS chair logs a new RCA)
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const RCARegister = require("../../../models/Compliance/RCARegisterModel");
const emitter = require("../../../services/Compliance/nabhRegisterEmitter");

function _dateRange(query, field = "initiatedAt") {
  const out = {};
  if (query.startDate) out.$gte = new Date(query.startDate);
  if (query.endDate) {
    const e = new Date(query.endDate);
    e.setHours(23, 59, 59, 999);
    out.$lte = e;
  }
  return Object.keys(out).length ? { [field]: out } : {};
}

function _pageLimit(query) {
  const page  = Math.max(1, parseInt(query.page  || "1", 10));
  const limit = Math.min(500, Math.max(1, parseInt(query.limit || "50", 10)));
  return { page, limit, skip: (page - 1) * limit };
}

// ─────────────────────────────────────────────────────────────────────────
// GET / — list with filter (q text, status, dateRange, sentinelId)
// ─────────────────────────────────────────────────────────────────────────
router.get(
  "/",
  requireAction("compliance.nabh.read"),
  async (req, res) => {
    try {
      const q = {};
      if (req.query.status) q.status = req.query.status;
      if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
      if (req.query.sentinelId) q.linkedSentinelId = req.query.sentinelId;
      if (req.query.nearMissId) q.linkedNearMissId = req.query.nearMissId;

      const dr = _dateRange(req.query, "initiatedAt");
      Object.assign(q, dr);

      // q (text search) — match patientName, initiatedByName, rootCauses
      if (req.query.q) {
        const re = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        q.$or = [
          { patientName: re },
          { initiatedByName: re },
          { initiatedByEmpId: re },
          { rootCauses: re },
          { contributingFactors: re },
        ];
      }

      const { page, limit, skip } = _pageLimit(req.query);
      const [rows, total] = await Promise.all([
        RCARegister.find(q).sort({ initiatedAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
        RCARegister.countDocuments(q),
      ]);
      res.json({ success: true, data: rows, pagination: { page, limit, total } });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────
// GET /:id — single row
// ─────────────────────────────────────────────────────────────────────────
router.get(
  "/:id",
  validateObjectIdParam("id"),
  requireAction("compliance.nabh.read"),
  async (req, res) => {
    try {
      const row = await RCARegister.findById(req.params.id).lean();
      if (!row) return res.status(404).json({ success: false, message: "RCA not found" });
      res.json({ success: true, data: row });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────
// POST / — manual RCA entry (QPS chair / Quality committee use case)
// Validates the required fields client-side, then emits through the
// shared helper so idempotency + audit trail come out of the same path
// as auto-emit. Uses compliance.nabh.write so only Admin / Doctor /
// Nurse / MRD can file new RCAs (matches the parallel sibling registers
// added in this batch).
// ─────────────────────────────────────────────────────────────────────────
router.post(
  "/",
  requireAction("compliance.nabh.write"),
  async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.initiatedAt) {
        return res.status(400).json({ success: false, message: "initiatedAt is required" });
      }
      const row = await emitter.emitRCA({
        patient: body.patient || {
          _id: body.patientId || null,
          UHID: body.UHID || "",
          fullName: body.patientName || "",
        },
        admission: body.admission || (body.admissionId ? { _id: body.admissionId } : null),
        linkedSentinelId: body.linkedSentinelId || null,
        linkedNearMissId: body.linkedNearMissId || null,
        initiatedAt: body.initiatedAt,
        initiatedByEmpId: body.initiatedByEmpId || (req.user?.empId || ""),
        initiatedByName: body.initiatedByName || (req.user?.fullName || req.user?.name || ""),
        teamMembers: Array.isArray(body.teamMembers) ? body.teamMembers : [],
        timeline: Array.isArray(body.timeline) ? body.timeline : [],
        contributingFactors: Array.isArray(body.contributingFactors) ? body.contributingFactors : [],
        rootCauses: Array.isArray(body.rootCauses) ? body.rootCauses : [],
        correctiveActions: Array.isArray(body.correctiveActions) ? body.correctiveActions : [],
        preventiveActions: Array.isArray(body.preventiveActions) ? body.preventiveActions : [],
        status: body.status || "Open",
        sourceRef: body.sourceRef || "",
        sourceType: body.sourceType || "Manual",
        hospitalId: req.user?.hospitalId || null,
        actor: req.user || {},
      });
      if (!row) {
        return res.status(400).json({ success: false, message: "Could not create RCA row" });
      }
      res.status(201).json({ success: true, data: row });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  },
);

module.exports = router;
