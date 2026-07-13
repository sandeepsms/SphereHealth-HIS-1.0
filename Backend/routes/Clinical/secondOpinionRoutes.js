/**
 * secondOpinionRoutes — NABH PRE.1 patient right to a second opinion.
 * Mounted at /api/second-opinions.
 *   GET  /            list (?UHID / ?status / ?admissionId)
 *   GET  /:id         single
 *   POST /            log a second-opinion request
 *   PATCH /:id        advance status / record the opinion
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAction } = require("../../middleware/auth");
const SecondOpinion = require("../../models/Clinical/SecondOpinionModel");

router.get("/", requireAction("patient.consent.read"), async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.status) q.status = req.query.status;
    if (req.query.admissionId && mongoose.isValidObjectId(req.query.admissionId)) q.admissionId = req.query.admissionId;
    const cap = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const rows = await SecondOpinion.find(q).sort({ requestedAt: -1 }).limit(cap).lean();
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.get("/:id", requireAction("patient.consent.read"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await SecondOpinion.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.post("/", requireAction("patient.consent.write"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.UHID) return res.status(400).json({ success: false, message: "UHID is required" });
    const u = req.user || {};
    const row = await SecondOpinion.create({
      UHID: String(b.UHID).toUpperCase(),
      patientId: mongoose.isValidObjectId(b.patientId) ? b.patientId : null,
      admissionId: mongoose.isValidObjectId(b.admissionId) ? b.admissionId : null,
      patientName: b.patientName || "",
      requestedByName: b.requestedByName || "",
      relationship: b.relationship || "Self",
      requestedAt: b.requestedAt ? new Date(b.requestedAt) : new Date(),
      primaryDoctorName: b.primaryDoctorName || "",
      provisionalDiagnosis: b.provisionalDiagnosis || "",
      reason: b.reason || "",
      referredToName: b.referredToName || "",
      referredToFacility: b.referredToFacility || "",
      external: !!b.external,
      status: "Requested",
      capturedByName: u.fullName || u.name || "",
      capturedById: u._id || null,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.patch("/:id", requireAction("patient.consent.write"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await SecondOpinion.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    const b = req.body || {};
    for (const f of ["referredToName", "referredToFacility", "reason", "notes", "opinionSummary"]) {
      if (b[f] !== undefined) row[f] = b[f];
    }
    if (b.external !== undefined) row.external = !!b.external;
    if (b.status && ["Requested", "Arranged", "Completed", "Declined", "Cancelled"].includes(b.status)) {
      row.status = b.status;
      if (b.status === "Completed" && !row.opinionAt) row.opinionAt = new Date();
    }
    if (b.opinionSummary && !row.opinionAt) row.opinionAt = new Date();
    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
