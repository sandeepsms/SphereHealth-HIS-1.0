/**
 * cssdLoadRegisterRoutes — NABH HIC.7 CSSD sterilisation load-release.
 * Mounted at /api/nabh-registers/cssd-load.
 *   GET  /            list (?sterilizerId / ?status / ?from / ?to / ?biPending)
 *   GET  /:id         single
 *   POST /            record a sterilisation load (CSSD-YY-N minted on save)
 *   PATCH /:id/release  release the load — BLOCKED if any indicator FAILED
 *   PATCH /:id/bi     enter a late biological-indicator result (recall on Fail)
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAction } = require("../../../middleware/auth");
const CSSDLoadRecord = require("../../../models/Compliance/CSSDLoadRecordModel");

function _audit(req, action, notes) {
  const u = req.user || {};
  return { action, at: new Date(), byName: u.fullName || u.name || "", byRole: u.role || "", byUserId: u._id || null, notes: notes || "" };
}

router.get("/", requireAction("compliance.nabh.read"), async (req, res) => {
  try {
    const q = {};
    if (req.query.sterilizerId) q.sterilizerId = req.query.sterilizerId;
    if (req.query.status) q.status = req.query.status;
    if (req.query.biPending === "true") { q.biologicalIndicator = "Pending"; q.loadReleased = true; }
    if (req.query.from || req.query.to) {
      q.createdAt = {};
      if (req.query.from) q.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) { const e = new Date(req.query.to); e.setHours(23, 59, 59, 999); q.createdAt.$lte = e; }
    }
    const cap = Math.max(1, Math.min(Number(req.query.limit) || 200, 1000));
    const rows = await CSSDLoadRecord.find(q).sort({ createdAt: -1 }).limit(cap).lean();
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.get("/:id", requireAction("compliance.nabh.read"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await CSSDLoadRecord.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.post("/", requireAction("compliance.nabh.write"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.sterilizerId) return res.status(400).json({ success: false, message: "sterilizerId is required" });
    const u = req.user || {};
    const row = await CSSDLoadRecord.create({
      sterilizerId: b.sterilizerId,
      cycleType: b.cycleType || "Steam",
      cycleNumber: b.cycleNumber || "",
      startedAt: b.startedAt ? new Date(b.startedAt) : null,
      endedAt: b.endedAt ? new Date(b.endedAt) : null,
      temperatureC: b.temperatureC ?? null,
      pressureKpa: b.pressureKpa ?? null,
      exposureMinutes: b.exposureMinutes ?? null,
      bowieDickResult: b.bowieDickResult || "NA",
      chemicalIndicator: b.chemicalIndicator || "NA",
      biologicalIndicator: b.biologicalIndicator || "Pending",
      biologicalReadAt: b.biologicalReadAt ? new Date(b.biologicalReadAt) : null,
      instrumentSets: Array.isArray(b.instrumentSets) ? b.instrumentSets : [],
      itemCount: b.itemCount ?? null,
      department: b.department || "",
      expiryDate: b.expiryDate ? new Date(b.expiryDate) : null,
      remarks: b.remarks || "",
      createdByName: u.fullName || u.name || "",
      auditTrail: [_audit(req, "CREATED")],
    });
    return res.status(201).json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// PATCH /:id/release — the release gate. Any FAILED indicator blocks release.
router.patch("/:id/release", requireAction("compliance.nabh.write"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await CSSDLoadRecord.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    if (row.loadReleased) return res.status(409).json({ success: false, code: "ALREADY_RELEASED", message: "Load already released" });

    const failed = [];
    if (row.bowieDickResult === "Fail") failed.push("Bowie-Dick");
    if (row.chemicalIndicator === "Fail") failed.push("chemical indicator");
    if (row.biologicalIndicator === "Fail") failed.push("biological indicator");
    if (failed.length) {
      return res.status(409).json({
        success: false, code: "INDICATOR_FAILED",
        message: `Cannot release — FAILED: ${failed.join(", ")}. Quarantine + reprocess the load.`,
        failed,
      });
    }
    const u = req.user || {};
    row.loadReleased = true;
    row.releasedWithBiPending = row.biologicalIndicator === "Pending";
    row.releasedByName = u.fullName || u.name || "";
    row.releasedById = u._id || null;
    row.releasedAt = new Date();
    row.status = "Released";
    row.auditTrail.push(_audit(req, "RELEASED", row.releasedWithBiPending ? "released with BI pending" : "all indicators passed"));
    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

// PATCH /:id/bi — enter a late biological-indicator result. A Fail on an
// already-released load flags a RECALL (items may need to be traced).
router.patch("/:id/bi", requireAction("compliance.nabh.write"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const result = req.body?.result;
    if (!["Pass", "Fail"].includes(result)) return res.status(400).json({ success: false, message: "result must be Pass | Fail" });
    const row = await CSSDLoadRecord.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    row.biologicalIndicator = result;
    row.biologicalReadAt = new Date();
    row.releasedWithBiPending = false;
    if (result === "Fail" && row.loadReleased) {
      row.status = "Recalled";
      row.auditTrail.push(_audit(req, "RECALLED", "BI FAILED after release — recall + trace load items"));
    } else {
      row.auditTrail.push(_audit(req, "UPDATED", `BI result ${result}`));
    }
    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
