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
      // NABH FMS/PSQ — optionally pin the implicated device so RCA + recall
      // can join events to the equipment register.
      equipmentRef: body.equipmentRef || undefined,
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

// ─────────────────────────────────────────────────────────────────────────
// PATCH /:id — progress the event: status, RCA linkage, immediate action.
// R7hr-NABH-PSQ: pre-fix the register only exposed GET+POST, so every row was
// frozen at "Open" — the Open→InProgress→Closed lifecycle + the RCA-assigned
// state were unreachable in-app. Closed is terminal unless an explicit
// reopen:true is passed (recorded in the audit trail). Every change appends an
// auditTrail entry (STATUS_CHANGED / RCA_INITIATED / CLOSED).
// ─────────────────────────────────────────────────────────────────────────
router.patch("/:id", validateObjectIdParam("id"), requireAction("compliance.nabh.write"), async (req, res) => {
  try {
    const row = await SentinelEventRegister.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Sentinel-event row not found" });

    const body = req.body || {};
    const actor = req.user || {};
    const actorMeta = {
      byUserId: actor._id || actor.id || null,
      byName:   actor.fullName || actor.name || "",
      byRole:   actor.role || "",
    };
    const auditEntries = [];

    // Status transition (Open → InProgress → Closed; Closed terminal unless reopen)
    if (body.status && body.status !== row.status) {
      const ALLOWED = ["Open", "InProgress", "Closed"];
      if (!ALLOWED.includes(body.status)) {
        return res.status(400).json({ success: false, message: `Invalid status "${body.status}" — expected one of ${ALLOWED.join(", ")}` });
      }
      if (row.status === "Closed" && body.status !== "Closed" && body.reopen !== true) {
        return res.status(409).json({ success: false, code: "SENTINEL_CLOSED", message: "This sentinel event is Closed. Pass reopen:true to re-open it (recorded in the audit trail)." });
      }
      const prev = row.status;
      row.status = body.status;
      auditEntries.push({ action: body.status === "Closed" ? "CLOSED" : "STATUS_CHANGED", ...actorMeta, notes: `${prev} → ${body.status}${body.reopen ? " (re-opened)" : ""}${body.notes ? " · " + String(body.notes).trim() : ""}` });
    }

    // RCA linkage
    if (body.rcaInitiated === true && !row.rcaInitiated) {
      row.rcaInitiated = true;
      if (body.rcaId && mongoose.isValidObjectId(body.rcaId)) row.rcaId = body.rcaId;
      auditEntries.push({ action: "RCA_INITIATED", ...actorMeta, notes: row.rcaId ? `RCA ${row.rcaId}` : "RCA initiated" });
    } else if (body.rcaId && mongoose.isValidObjectId(body.rcaId) && String(body.rcaId) !== String(row.rcaId || "")) {
      row.rcaId = body.rcaId;
      row.rcaInitiated = true;
      auditEntries.push({ action: "RCA_INITIATED", ...actorMeta, notes: `RCA linked ${body.rcaId}` });
    }

    if (typeof body.immediateAction === "string") row.immediateAction = body.immediateAction;

    if (!auditEntries.length && typeof body.immediateAction !== "string") {
      return res.status(400).json({ success: false, message: "Nothing to update — provide status, rcaInitiated/rcaId, or immediateAction" });
    }
    row.auditTrail.push(...auditEntries);
    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
