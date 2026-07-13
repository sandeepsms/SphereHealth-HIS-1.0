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
// GET /trend — monthly near-miss volume (a positive safety-culture indicator).
// Groups by YYYY-MM of observedAt with a total + per-eventType breakdown.
// Optional ?months=N window (default 12) and ?startDate/?endDate.
// NOTE: declared BEFORE GET /:id so "trend" isn't captured as an :id param.
// ─────────────────────────────────────────────────────────────────────────
router.get("/trend", requireAction("compliance.nabh.read"), async (req, res) => {
  try {
    const match = {};
    const dr = _dateRange(req.query);
    if (dr) match.observedAt = dr;
    else {
      const months = Math.min(60, Math.max(1, parseInt(req.query.months || "12", 10)));
      const from = new Date(); from.setMonth(from.getMonth() - months); from.setHours(0, 0, 0, 0);
      match.observedAt = { $gte: from };
    }
    const rows = await NearMissEventRegister.aggregate([
      { $match: match },
      { $group: {
          _id: { y: { $year: "$observedAt" }, m: { $month: "$observedAt" }, type: "$eventType" },
          count: { $sum: 1 },
      } },
      { $sort: { "_id.y": 1, "_id.m": 1 } },
    ]);
    const byMonth = {};
    for (const r of rows) {
      const key = `${r._id.y}-${String(r._id.m).padStart(2, "0")}`;
      byMonth[key] = byMonth[key] || { month: key, total: 0, byType: {} };
      byMonth[key].total += r.count;
      byMonth[key].byType[r._id.type || "Unspecified"] = r.count;
    }
    return res.json({ success: true, data: Object.values(byMonth) });
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
      // NABH FMS/PSQ — optionally pin the implicated device (e.g. the
      // malfunctioning pump the near-miss caught) for RCA + recall join.
      equipmentRef: body.equipmentRef || undefined,
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

// ─────────────────────────────────────────────────────────────────────────
// PATCH /:id — progress status / link to a sentinel event post-hoc.
// R7hr-NABH-PSQ: pre-fix the register was GET+POST only, so the Open→
// InProgress→Closed lifecycle + the LINKED_TO_SENTINEL / CLOSED audit actions
// were unreachable. Closed is terminal unless reopen:true.
// ─────────────────────────────────────────────────────────────────────────
router.patch("/:id", validateObjectIdParam("id"), requireAction("compliance.nabh.write"), async (req, res) => {
  try {
    const row = await NearMissEventRegister.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Near-miss row not found" });

    const body = req.body || {};
    const actorMeta = {
      byUserId: req.user?._id || req.user?.id || null,
      byName:   req.user?.fullName || req.user?.name || "",
      byRole:   req.user?.role || "",
    };
    const audit = [];

    if (body.status && body.status !== row.status) {
      const ALLOWED = ["Open", "InProgress", "Closed"];
      if (!ALLOWED.includes(body.status)) return res.status(400).json({ success: false, message: `Invalid status "${body.status}"` });
      if (row.status === "Closed" && body.status !== "Closed" && body.reopen !== true) {
        return res.status(409).json({ success: false, code: "NEARMISS_CLOSED", message: "This near-miss is Closed. Pass reopen:true to re-open it." });
      }
      const prev = row.status;
      row.status = body.status;
      audit.push({ action: body.status === "Closed" ? "CLOSED" : "STATUS_CHANGED", ...actorMeta, notes: `${prev} → ${body.status}${body.reopen ? " (re-opened)" : ""}${body.notes ? " · " + String(body.notes).trim() : ""}` });
    }

    if (body.linkedSentinelId && mongoose.isValidObjectId(body.linkedSentinelId) && String(body.linkedSentinelId) !== String(row.linkedSentinelId || "")) {
      row.linkedSentinelId = body.linkedSentinelId;
      audit.push({ action: "LINKED_TO_SENTINEL", ...actorMeta, notes: `Sentinel ${body.linkedSentinelId}` });
    }

    if (typeof body.interventionTaken === "string") row.interventionTaken = body.interventionTaken;
    if (typeof body.recommendation === "string") row.recommendation = body.recommendation;

    if (!audit.length && typeof body.interventionTaken !== "string" && typeof body.recommendation !== "string") {
      return res.status(400).json({ success: false, message: "Nothing to update — provide status, linkedSentinelId, interventionTaken, or recommendation" });
    }
    // Record a generic UPDATED entry when only free-text fields changed.
    if (!audit.length) audit.push({ action: "UPDATED", ...actorMeta, notes: "intervention/recommendation updated" });
    row.auditTrail.push(...audit);
    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
