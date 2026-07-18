/**
 * notifiableDiseaseRegisterRoutes — NABH HIC/IMS + IDSP statutory reporting.
 * Mounted at /api/nabh-registers/notifiable-disease.
 *   GET  /            list (?status / ?disease / ?notified / ?overdue)
 *   GET  /:id         single
 *   POST /            manual case entry (ND-YY-N minted on save)
 *   PATCH /:id/notify record the statutory notification to the authority
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAction } = require("../../../middleware/auth");
const NotifiableDiseaseRegister = require("../../../models/Compliance/NotifiableDiseaseRegisterModel");
const { matchNotifiable } = require("../../../services/Compliance/notifiableDiseases");

function _audit(req, action, notes) {
  const u = req.user || {};
  return { action, at: new Date(), byName: u.fullName || u.name || "", byRole: u.role || "", byUserId: u._id || null, notes: notes || "" };
}

router.get("/", requireAction("compliance.nabh.read"), async (req, res) => {
  try {
    const q = {};
    if (req.query.status) q.status = req.query.status;
    if (req.query.disease) q.disease = new RegExp(String(req.query.disease).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (req.query.notified === "true") q.notifiedToAuthority = true;
    if (req.query.notified === "false") q.notifiedToAuthority = false;
    if (req.query.overdue === "true") { q.notifiedToAuthority = false; q.notificationDueBy = { $lt: new Date() }; }
    const cap = Math.max(1, Math.min(Number(req.query.limit) || 200, 1000));
    const rows = await NotifiableDiseaseRegister.find(q).sort({ diagnosisDate: -1 }).limit(cap).lean();
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.get("/:id", requireAction("compliance.nabh.read"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await NotifiableDiseaseRegister.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.post("/", requireAction("compliance.nabh.write"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.disease) return res.status(400).json({ success: false, message: "disease is required" });
    // If an ICD code was supplied, use its reporting window when not given.
    const hit = b.icdCode ? matchNotifiable(b.icdCode) : null;
    const u = req.user || {};
    const row = await NotifiableDiseaseRegister.create({
      UHID: b.UHID ? String(b.UHID).toUpperCase() : "",
      patientId: mongoose.isValidObjectId(b.patientId) ? b.patientId : null,
      patientName: b.patientName || "",
      age: b.age ?? null,
      sex: b.sex || "",
      address: b.address || "",
      admissionId: mongoose.isValidObjectId(b.admissionId) ? b.admissionId : null,
      disease: b.disease,
      icdCode: b.icdCode || "",
      diagnosisDate: b.diagnosisDate ? new Date(b.diagnosisDate) : new Date(),
      labConfirmed: !!b.labConfirmed,
      reportingWindowHours: b.reportingWindowHours ?? hit?.hours ?? 24,
      remarks: b.remarks || "",
      sourceType: "Manual",
      createdByName: u.fullName || u.name || "",
      auditTrail: [_audit(req, "CREATED")],
    });
    return res.status(201).json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.patch("/:id/notify", requireAction("compliance.nabh.write"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await NotifiableDiseaseRegister.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    const b = req.body || {};
    row.notifiedToAuthority = true;
    row.notifiedAt = b.notifiedAt ? new Date(b.notifiedAt) : new Date();
    row.authorityName = b.authorityName || row.authorityName;
    row.notificationReference = b.notificationReference || row.notificationReference;
    row.reportingOfficerName = b.reportingOfficerName || (req.user?.fullName || "");
    if (b.labConfirmed !== undefined) row.labConfirmed = !!b.labConfirmed;
    row.status = "Notified";
    row.auditTrail.push(_audit(req, "NOTIFIED", `ref=${row.notificationReference} authority=${row.authorityName}`));
    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
