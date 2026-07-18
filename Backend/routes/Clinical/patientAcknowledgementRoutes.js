/**
 * patientAcknowledgementRoutes — NABH PRE.1/PRE.4 + DPDP Act 2023.
 * Mounted at /api/patient-acknowledgements.
 *   GET  /            list (?UHID / ?type / ?admissionId)
 *   GET  /:id         single
 *   POST /            record an acknowledgement / consent
 *   POST /:id/withdraw  withdraw a consent (DPDP right to withdraw)
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAction } = require("../../middleware/auth");
const PatientAcknowledgement = require("../../models/Clinical/PatientAcknowledgementModel");

const TYPES = ["RIGHTS_HANDOUT", "DPDP_CONSENT", "BIOMETRIC_CONSENT", "RESPONSIBILITIES"];

router.get("/", requireAction("patient.consent.read"), async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.type) q.type = req.query.type;
    if (req.query.admissionId && mongoose.isValidObjectId(req.query.admissionId)) q.admissionId = req.query.admissionId;
    const cap = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const rows = await PatientAcknowledgement.find(q).sort({ acknowledgedAt: -1 }).limit(cap).lean();
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.get("/:id", requireAction("patient.consent.read"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await PatientAcknowledgement.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.post("/", requireAction("patient.consent.write"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.UHID) return res.status(400).json({ success: false, message: "UHID is required" });
    if (!TYPES.includes(b.type)) return res.status(400).json({ success: false, message: `type must be one of ${TYPES.join(", ")}` });
    const u = req.user || {};
    // Consent types default granted=false unless explicitly granted; the rights
    // handout is an acknowledgement (granted defaults true).
    const isConsent = b.type === "DPDP_CONSENT" || b.type === "BIOMETRIC_CONSENT";
    const row = await PatientAcknowledgement.create({
      UHID: String(b.UHID).toUpperCase(),
      patientId: mongoose.isValidObjectId(b.patientId) ? b.patientId : null,
      admissionId: mongoose.isValidObjectId(b.admissionId) ? b.admissionId : null,
      type: b.type,
      documentVersion: b.documentVersion || "v1",
      consentGranted: b.consentGranted !== undefined ? !!b.consentGranted : !isConsent ? true : false,
      purpose: b.purpose || "",
      dataCategories: Array.isArray(b.dataCategories) ? b.dataCategories : [],
      acknowledgedByName: b.acknowledgedByName || "",
      relationship: b.relationship || "Self",
      method: b.method || "Signed",
      language: b.language || "",
      acknowledgedAt: b.acknowledgedAt ? new Date(b.acknowledgedAt) : new Date(),
      witnessedByName: b.witnessedByName || "",
      capturedByName: u.fullName || u.name || "",
      capturedById: u._id || null,
      attachmentRef: b.attachmentRef || "",
      notes: b.notes || "",
    });
    return res.status(201).json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.post("/:id/withdraw", requireAction("patient.consent.write"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await PatientAcknowledgement.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    row.consentGranted = false;
    row.withdrawnAt = new Date();
    row.withdrawnReason = req.body?.reason || "";
    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
