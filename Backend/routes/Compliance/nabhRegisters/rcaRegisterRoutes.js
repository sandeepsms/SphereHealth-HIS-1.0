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
const mongoose = require("mongoose");
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const RCARegister = require("../../../models/Compliance/RCARegisterModel");
const SentinelEventRegister = require("../../../models/Compliance/SentinelEventRegisterModel");
const emitter = require("../../../services/Compliance/nabhRegisterEmitter");

// R7hr-NABH-PSQ — close the loop: when an RCA is linked to a sentinel event,
// stamp the sentinel's rcaInitiated + rcaId so the two registers cross-
// reference. Best-effort; a failed back-link never aborts the RCA write.
async function _backlinkSentinel(sentinelId, rcaId, actorMeta) {
  try {
    if (!sentinelId || !mongoose.isValidObjectId(sentinelId)) return;
    const s = await SentinelEventRegister.findById(sentinelId);
    if (!s) return;
    if (s.rcaInitiated && String(s.rcaId || "") === String(rcaId)) return; // already linked
    s.rcaInitiated = true;
    s.rcaId = rcaId;
    s.auditTrail.push({ action: "RCA_INITIATED", ...actorMeta, notes: `RCA ${rcaId} linked` });
    await s.save();
  } catch (_) { /* non-fatal */ }
}

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
      // Cross-reference the sentinel event this RCA belongs to.
      if (row.linkedSentinelId) {
        await _backlinkSentinel(row.linkedSentinelId, row._id, {
          byUserId: req.user?._id || req.user?.id || null,
          byName:   req.user?.fullName || req.user?.name || "",
          byRole:   req.user?.role || "",
        });
      }
      res.status(201).json({ success: true, data: row });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────
// PATCH /:id — fill in the RCA (team, timeline, root causes, CAPA) + progress
// / close it. R7hr-NABH-PSQ: pre-fix rcaRegisterRoutes had GET+POST only, so
// the auto-created "Initiated" RCA row (empty CAPA) could never be filled or
// closed — a Quality officer had to POST a duplicate. Arrays are replaced when
// supplied (edit-form semantics); closing stamps closedAt/closedBy. Every
// change appends an auditTrail entry (TEAM_ASSIGNED / CAPA_FILED / CLOSED /
// STATUS_CHANGED). Closed is terminal unless reopen:true.
// ─────────────────────────────────────────────────────────────────────────
router.patch(
  "/:id",
  validateObjectIdParam("id"),
  requireAction("compliance.nabh.write"),
  async (req, res) => {
    try {
      const row = await RCARegister.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: "RCA not found" });

      const body = req.body || {};
      const actorMeta = {
        byUserId: req.user?._id || req.user?.id || null,
        byName:   req.user?.fullName || req.user?.name || "",
        byRole:   req.user?.role || "",
      };
      const audit = [];
      const arr = (v) => (Array.isArray(v) ? v : null);

      if (arr(body.teamMembers)) { row.teamMembers = body.teamMembers; audit.push({ action: "TEAM_ASSIGNED", ...actorMeta, notes: `${body.teamMembers.length} member(s)` }); }
      if (arr(body.timeline)) row.timeline = body.timeline;
      if (arr(body.contributingFactors)) row.contributingFactors = body.contributingFactors;

      let capaTouched = false;
      if (arr(body.rootCauses))        { row.rootCauses = body.rootCauses; capaTouched = true; }
      if (arr(body.correctiveActions)) { row.correctiveActions = body.correctiveActions; capaTouched = true; }
      if (arr(body.preventiveActions)) { row.preventiveActions = body.preventiveActions; capaTouched = true; }
      if (capaTouched) audit.push({ action: "CAPA_FILED", ...actorMeta, notes: `root=${row.rootCauses.length} corrective=${row.correctiveActions.length} preventive=${row.preventiveActions.length}` });

      // Status transition
      if (body.status && body.status !== row.status) {
        const ALLOWED = ["Open", "Initiated", "InProgress", "Closed"];
        if (!ALLOWED.includes(body.status)) return res.status(400).json({ success: false, message: `Invalid status "${body.status}"` });
        if (row.status === "Closed" && body.status !== "Closed" && body.reopen !== true) {
          return res.status(409).json({ success: false, code: "RCA_CLOSED", message: "This RCA is Closed. Pass reopen:true to re-open it." });
        }
        if (body.status === "Closed" && (!row.rootCauses.length || (!row.correctiveActions.length && !row.preventiveActions.length))) {
          return res.status(422).json({ success: false, code: "RCA_INCOMPLETE", message: "Cannot close an RCA without at least one root cause and one corrective/preventive action (CAPA)." });
        }
        const prev = row.status;
        row.status = body.status;
        if (body.status === "Closed") {
          row.closedAt = new Date();
          row.closedByName = actorMeta.byName;
          row.closedByEmpId = req.user?.empId || req.user?.employeeId || "";
          audit.push({ action: "CLOSED", ...actorMeta, notes: `${prev} → Closed${body.notes ? " · " + String(body.notes).trim() : ""}` });
        } else {
          audit.push({ action: "STATUS_CHANGED", ...actorMeta, notes: `${prev} → ${body.status}${body.reopen ? " (re-opened)" : ""}` });
        }
      }

      // (Re)link a sentinel event
      if (body.linkedSentinelId && mongoose.isValidObjectId(body.linkedSentinelId) && String(body.linkedSentinelId) !== String(row.linkedSentinelId || "")) {
        row.linkedSentinelId = body.linkedSentinelId;
      }

      if (!audit.length && !arr(body.timeline) && !arr(body.contributingFactors) && !body.linkedSentinelId) {
        return res.status(400).json({ success: false, message: "Nothing to update" });
      }
      row.auditTrail.push(...audit);
      await row.save();
      if (row.linkedSentinelId) await _backlinkSentinel(row.linkedSentinelId, row._id, actorMeta);
      res.json({ success: true, data: row });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  },
);

module.exports = router;
