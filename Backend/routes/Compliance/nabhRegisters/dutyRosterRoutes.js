/**
 * dutyRosterRoutes — NABH HRM.1 dated staff duty roster.
 * Mounted at /api/duty-roster.
 *   GET  /            list (?date / ?from / ?to / ?department / ?shift / ?status)
 *   GET  /:id         single
 *   POST /            upsert a roster for (date, department, shift)
 *   PATCH /:id        edit entries / publish
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAction } = require("../../../middleware/auth");
const DutyRoster = require("../../../models/Compliance/DutyRosterModel");

const _dayRange = (d) => {
  const s = new Date(d); s.setHours(0, 0, 0, 0);
  const e = new Date(d); e.setHours(23, 59, 59, 999);
  return { $gte: s, $lte: e };
};

router.get("/", requireAction("hr.roster.read"), async (req, res) => {
  try {
    const q = {};
    if (req.query.department) q.department = req.query.department;
    if (req.query.shift) q.shift = req.query.shift;
    if (req.query.status) q.status = req.query.status;
    if (req.query.date) q.rosterDate = _dayRange(req.query.date);
    else if (req.query.from || req.query.to) {
      q.rosterDate = {};
      if (req.query.from) { const s = new Date(req.query.from); s.setHours(0, 0, 0, 0); q.rosterDate.$gte = s; }
      if (req.query.to) { const e = new Date(req.query.to); e.setHours(23, 59, 59, 999); q.rosterDate.$lte = e; }
    }
    const cap = Math.max(1, Math.min(Number(req.query.limit) || 200, 1000));
    const rows = await DutyRoster.find(q).sort({ rosterDate: -1, department: 1, shift: 1 }).limit(cap).lean();
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.get("/:id", requireAction("hr.roster.read"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await DutyRoster.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// Upsert on (rosterDate, department, shift) so re-posting a roster edits it.
router.post("/", requireAction("hr.roster.write"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.rosterDate || !b.department || !b.shift) {
      return res.status(400).json({ success: false, message: "rosterDate, department, shift are required" });
    }
    const u = req.user || {};
    const day = new Date(b.rosterDate); day.setHours(0, 0, 0, 0);
    const set = {
      rosterDate: day,
      department: b.department,
      shift: b.shift,
      entries: Array.isArray(b.entries) ? b.entries : [],
      plannedNurses: b.plannedNurses ?? null,
      plannedDoctors: b.plannedDoctors ?? null,
      bedStrength: b.bedStrength ?? null,
      notes: b.notes || "",
      preparedByName: u.fullName || u.name || "",
      preparedById: u._id || null,
      status: b.status === "Published" ? "Published" : "Draft",
      publishedAt: b.status === "Published" ? new Date() : null,
    };
    const row = await DutyRoster.findOneAndUpdate(
      { rosterDate: day, department: b.department, shift: b.shift },
      { $set: set },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return res.status(201).json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.patch("/:id", requireAction("hr.roster.write"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await DutyRoster.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    const b = req.body || {};
    if (Array.isArray(b.entries)) row.entries = b.entries;
    for (const f of ["plannedNurses", "plannedDoctors", "bedStrength", "notes", "approvedByName"]) {
      if (b[f] !== undefined) row[f] = b[f];
    }
    if (b.status === "Published" && row.status !== "Published") { row.status = "Published"; row.publishedAt = new Date(); }
    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
