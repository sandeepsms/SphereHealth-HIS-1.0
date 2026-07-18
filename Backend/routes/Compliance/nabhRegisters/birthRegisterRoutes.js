/**
 * birthRegisterRoutes — NABH IMS / RBD Act birth register.
 * Mounted at /api/nabh-registers/birth.
 *   GET  /            list (?motherUHID / ?from / ?to / ?notified)
 *   GET  /:id         single
 *   POST /            record a birth (BR-YY-N minted on save)
 *   PATCH /:id        update / mark statutory notification
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAction } = require("../../../middleware/auth");
const BirthRegister = require("../../../models/Compliance/BirthRegisterModel");

function _actorAudit(req, action, notes) {
  const u = req.user || {};
  return { action, at: new Date(), byName: u.fullName || u.name || "", byRole: u.role || "", byUserId: u._id || null, notes: notes || "" };
}

router.get("/", requireAction("compliance.nabh.read"), async (req, res) => {
  try {
    const q = {};
    if (req.query.motherUHID) q.motherUHID = String(req.query.motherUHID).toUpperCase();
    if (req.query.notified === "true") q.notifiedToRegistrar = true;
    if (req.query.notified === "false") q.notifiedToRegistrar = false;
    if (req.query.from || req.query.to) {
      q.deliveryDateTime = {};
      if (req.query.from) q.deliveryDateTime.$gte = new Date(req.query.from);
      if (req.query.to) { const e = new Date(req.query.to); e.setHours(23, 59, 59, 999); q.deliveryDateTime.$lte = e; }
    }
    const cap = Math.max(1, Math.min(Number(req.query.limit) || 200, 1000));
    const rows = await BirthRegister.find(q).sort({ deliveryDateTime: -1 }).limit(cap).lean();
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.get("/:id", requireAction("compliance.nabh.read"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await BirthRegister.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.post("/", requireAction("compliance.nabh.write"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.motherName) return res.status(400).json({ success: false, message: "motherName is required" });
    if (!b.deliveryDateTime) return res.status(400).json({ success: false, message: "deliveryDateTime is required" });
    if (!b.babySex) return res.status(400).json({ success: false, message: "babySex is required" });
    const u = req.user || {};
    const row = await BirthRegister.create({
      motherUHID: b.motherUHID || "",
      motherName: b.motherName,
      motherAge: b.motherAge ?? null,
      admissionId: mongoose.isValidObjectId(b.admissionId) ? b.admissionId : null,
      admissionNumber: b.admissionNumber || "",
      deliveryDateTime: new Date(b.deliveryDateTime),
      deliveryType: b.deliveryType || "Normal",
      placeOfBirth: b.placeOfBirth || "",
      attendingDoctor: b.attendingDoctor || "",
      attendingMidwife: b.attendingMidwife || "",
      babySex: b.babySex,
      birthWeightGrams: b.birthWeightGrams ?? null,
      gestationalAgeWeeks: b.gestationalAgeWeeks ?? null,
      liveOrStill: b.liveOrStill || "Live",
      apgar1Min: b.apgar1Min ?? null,
      apgar5Min: b.apgar5Min ?? null,
      birthOrder: b.birthOrder || "Single",
      congenitalAnomaly: b.congenitalAnomaly || "",
      babyUHID: b.babyUHID || "",
      remarks: b.remarks || "",
      createdByName: u.fullName || u.name || "",
      auditTrail: [_actorAudit(req, "CREATED")],
    });
    return res.status(201).json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.patch("/:id", requireAction("compliance.nabh.write"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await BirthRegister.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    const b = req.body || {};
    const editable = ["birthWeightGrams", "apgar1Min", "apgar5Min", "congenitalAnomaly", "babyUHID", "attendingDoctor", "attendingMidwife", "remarks", "gestationalAgeWeeks"];
    for (const f of editable) if (b[f] !== undefined) row[f] = b[f];
    if (b.notifiedToRegistrar === true && !row.notifiedToRegistrar) {
      row.notifiedToRegistrar = true;
      row.notifiedAt = new Date();
      row.notificationReference = b.notificationReference || "";
      row.auditTrail.push(_actorAudit(req, "NOTIFIED", `ref=${row.notificationReference}`));
    } else {
      row.auditTrail.push(_actorAudit(req, "UPDATED"));
    }
    if (b.status === "Cancelled") { row.status = "Cancelled"; row.auditTrail.push(_actorAudit(req, "CANCELLED", b.reason || "")); }
    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
