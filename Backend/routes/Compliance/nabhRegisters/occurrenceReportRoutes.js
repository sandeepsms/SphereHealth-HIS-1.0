/**
 * occurrenceReportRoutes — NABH PSQ unified occurrence reporting.
 * Mounted at /api/occurrence-reports.
 *   GET  /            list (?category / ?status / ?UHID / ?from / ?to)
 *   GET  /:id         single
 *   POST /            report an occurrence (OCC-YY-N minted on save)
 *   PATCH /:id        classify / route / review / close
 *
 * The report is the umbrella intake; when triage maps it to a formal register
 * the quality team records `routedRegister` (+ routedRefId of the row they
 * opened there). Any authenticated staff can report; classification/closure is
 * gated on compliance.nabh.write.
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAction } = require("../../../middleware/auth");
const OccurrenceReport = require("../../../models/Compliance/OccurrenceReportModel");

function _audit(req, action, notes) {
  const u = req.user || {};
  return { action, at: new Date(), byName: u.fullName || u.name || "", byRole: u.role || "", byUserId: u._id || null, notes: notes || "" };
}

router.get("/", requireAction("compliance.nabh.read"), async (req, res) => {
  try {
    const q = {};
    if (req.query.category) q.category = req.query.category;
    if (req.query.status) q.status = req.query.status;
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.from || req.query.to) {
      q.occurredAt = {};
      if (req.query.from) q.occurredAt.$gte = new Date(req.query.from);
      if (req.query.to) { const e = new Date(req.query.to); e.setHours(23, 59, 59, 999); q.occurredAt.$lte = e; }
    }
    const cap = Math.max(1, Math.min(Number(req.query.limit) || 200, 1000));
    const rows = await OccurrenceReport.find(q).sort({ occurredAt: -1 }).limit(cap).lean();
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.get("/:id", requireAction("compliance.nabh.read"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await OccurrenceReport.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// Any authenticated staff may report an occurrence (a low bar encourages
// reporting). Gate kept at compliance.read so front-line roles can file.
router.post("/", requireAction("compliance.read"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.category) return res.status(400).json({ success: false, message: "category is required" });
    if (!b.description) return res.status(400).json({ success: false, message: "description is required" });
    const u = req.user || {};
    const anon = !!b.anonymous;
    const row = await OccurrenceReport.create({
      category: b.category,
      occurredAt: b.occurredAt ? new Date(b.occurredAt) : new Date(),
      location: b.location || "",
      description: b.description,
      immediateActionTaken: b.immediateActionTaken || "",
      severity: b.severity || "",
      harmReached: !!b.harmReached,
      UHID: b.UHID ? String(b.UHID).toUpperCase() : "",
      patientId: mongoose.isValidObjectId(b.patientId) ? b.patientId : null,
      admissionId: mongoose.isValidObjectId(b.admissionId) ? b.admissionId : null,
      reportedByName: anon ? "" : (b.reportedByName || u.fullName || u.name || ""),
      reportedByRole: anon ? "" : (u.role || ""),
      reportedById: anon ? null : (u._id || null),
      anonymous: anon,
      auditTrail: [_audit(req, "REPORTED")],
    });
    return res.status(201).json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.patch("/:id", requireAction("compliance.nabh.write"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await OccurrenceReport.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    const b = req.body || {};

    if (b.severity !== undefined) row.severity = b.severity;
    if (b.reviewNotes !== undefined) row.reviewNotes = b.reviewNotes;

    if (b.routedRegister) {
      const valid = ["SentinelEvent", "NearMiss", "MedicationError", "IncidentReport", "None"];
      if (!valid.includes(b.routedRegister)) return res.status(400).json({ success: false, message: `routedRegister must be one of ${valid.join(", ")}` });
      row.routedRegister = b.routedRegister;
      if (mongoose.isValidObjectId(b.routedRefId)) row.routedRefId = b.routedRefId;
      row.status = b.routedRegister === "None" ? "Under-Review" : "Routed";
      row.auditTrail.push(_audit(req, "ROUTED", `→ ${b.routedRegister}`));
    } else if (b.status === "Under-Review") {
      row.status = "Under-Review";
      row.auditTrail.push(_audit(req, "CLASSIFIED"));
    }

    if (b.status === "Closed") {
      row.status = "Closed";
      row.closedAt = new Date();
      row.auditTrail.push(_audit(req, "CLOSED", b.closeReason || ""));
    }
    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
