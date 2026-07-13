/**
 * staffTrainingRoutes — NABH HRM.4/5 competency + in-service training.
 * Mounted at /api/staff-training.
 *   GET  /            list (?userId / ?recordType / ?status / ?due / ?from / ?to)
 *   GET  /due         reassessments due/overdue (?days=30 lookahead)
 *   GET  /:id         single
 *   POST /            record a competency / training event
 *   PATCH /:id        update result / next-due
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { authenticate, requireAction } = require("../../middleware/auth");
const StaffTrainingRecord = require("../../models/HR/StaffTrainingRecordModel");

router.use(authenticate);

// Compute the status from nextDueDate at read/write time.
function _deriveStatus(row, now = new Date()) {
  if (row.result === "Fail") return "Failed";
  if (!row.nextDueDate) return "Valid";
  const due = new Date(row.nextDueDate);
  if (due < now) return "Overdue";
  const soon = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  if (due <= soon) return "Due";
  return "Valid";
}

router.get("/", requireAction("hr.training.read"), async (req, res) => {
  try {
    const q = {};
    if (req.query.userId && mongoose.isValidObjectId(req.query.userId)) q.userId = req.query.userId;
    if (req.query.employeeId) q.employeeId = req.query.employeeId;
    if (req.query.recordType) q.recordType = req.query.recordType;
    if (req.query.status) q.status = req.query.status;
    if (req.query.from || req.query.to) {
      q.date = {};
      if (req.query.from) q.date.$gte = new Date(req.query.from);
      if (req.query.to) { const e = new Date(req.query.to); e.setHours(23, 59, 59, 999); q.date.$lte = e; }
    }
    const cap = Math.max(1, Math.min(Number(req.query.limit) || 200, 1000));
    const rows = await StaffTrainingRecord.find(q).sort({ date: -1 }).limit(cap).lean();
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// Reassessments due within `days` (default 30) or already overdue.
router.get("/due", requireAction("hr.training.read"), async (req, res) => {
  try {
    const days = Math.max(1, Math.min(Number(req.query.days) || 30, 365));
    const horizon = new Date(Date.now() + days * 24 * 3600 * 1000);
    const rows = await StaffTrainingRecord.find({
      nextDueDate: { $ne: null, $lte: horizon },
      result: { $ne: "Fail" },
    }).sort({ nextDueDate: 1 }).limit(1000).lean();
    const now = new Date();
    const data = rows.map((r) => ({ ...r, computedStatus: _deriveStatus(r, now) }));
    return res.json({ success: true, data, count: data.length, overdue: data.filter((r) => r.computedStatus === "Overdue").length });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.get("/:id", requireAction("hr.training.read"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await StaffTrainingRecord.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.post("/", requireAction("hr.training.write"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.staffName) return res.status(400).json({ success: false, message: "staffName is required" });
    if (!b.recordType) return res.status(400).json({ success: false, message: "recordType is required" });
    if (!b.title) return res.status(400).json({ success: false, message: "title is required" });
    const u = req.user || {};
    const row = new StaffTrainingRecord({
      userId: mongoose.isValidObjectId(b.userId) ? b.userId : null,
      staffName: b.staffName,
      staffRole: b.staffRole || "",
      employeeId: b.employeeId || "",
      department: b.department || "",
      recordType: b.recordType,
      title: b.title,
      category: b.category || "",
      description: b.description || "",
      assessedByName: b.assessedByName || u.fullName || "",
      assessedById: u._id || null,
      trainerName: b.trainerName || "",
      date: b.date ? new Date(b.date) : new Date(),
      durationHours: b.durationHours ?? null,
      result: b.result || "",
      score: b.score ?? null,
      remarks: b.remarks || "",
      validFrom: b.validFrom ? new Date(b.validFrom) : null,
      nextDueDate: b.nextDueDate ? new Date(b.nextDueDate) : null,
      attachmentUrl: b.attachmentUrl || "",
      createdByName: u.fullName || u.name || "",
    });
    row.status = _deriveStatus(row);
    await row.save();
    return res.status(201).json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.patch("/:id", requireAction("hr.training.write"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await StaffTrainingRecord.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    const b = req.body || {};
    for (const f of ["result", "score", "remarks", "trainerName", "category", "durationHours", "attachmentUrl"]) {
      if (b[f] !== undefined) row[f] = b[f];
    }
    if (b.nextDueDate !== undefined) row.nextDueDate = b.nextDueDate ? new Date(b.nextDueDate) : null;
    if (b.validFrom !== undefined) row.validFrom = b.validFrom ? new Date(b.validFrom) : null;
    row.status = _deriveStatus(row);
    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
