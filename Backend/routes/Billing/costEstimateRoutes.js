/**
 * costEstimateRoutes — NABH PRE.4 numbered, itemized cost estimate.
 *
 * Mounted at /api/cost-estimates (below the global auth wall).
 *   POST   /                 create + number an estimate (lines built from the
 *                            tariff masters or entered directly)
 *   GET    /                 list by ?UHID / ?admissionId / ?status
 *   GET    /number/:number   retrieve by estimate number (CE-YY-N)
 *   GET    /:id              single
 *   POST   /:id/revise       issue a revised estimate that supersedes this one
 *   POST   /:id/cancel       cancel an estimate
 *
 * Reads: any clinician/front-office (billing.read). Writes: reception/billing/
 * admin (billing.write).
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAction } = require("../../middleware/auth");
const CostEstimate = require("../../models/Billing/CostEstimateModel");

// Resolve serviceCode → {description, unitPrice} from ServiceMaster for lines
// that supply only a code (tariff-master-built). Best-effort; never throws.
async function _hydrateLines(rawLines) {
  const lines = Array.isArray(rawLines) ? rawLines : [];
  let ServiceMaster = null;
  try { ServiceMaster = require("../../models/ServiceMaster/serviceMasterModel"); } catch { /* optional */ }
  const out = [];
  for (const ln of lines) {
    const line = {
      category: ln.category || "Other",
      description: ln.description || "",
      serviceCode: ln.serviceCode || "",
      unitPrice: Number(ln.unitPrice) || 0,
      quantity: Number(ln.quantity) || 1,
      estimatedDays: ln.estimatedDays ?? null,
    };
    if (ServiceMaster && line.serviceCode && (!line.description || !line.unitPrice)) {
      try {
        const m = await ServiceMaster.findOne({ serviceCode: line.serviceCode }).select("serviceName defaultPrice").lean();
        if (m) {
          if (!line.description) line.description = m.serviceName || line.serviceCode;
          if (!line.unitPrice) line.unitPrice = Number(m.defaultPrice) || 0;
        }
      } catch { /* leave line as-is */ }
    }
    if (!line.description) line.description = line.serviceCode || "Item";
    out.push(line);
  }
  return out;
}

function _actor(req) {
  const u = req.user || {};
  return { preparedBy: u.fullName || u.name || "", preparedById: u._id || null, preparedByRole: u.role || "" };
}

// ── POST / — create ────────────────────────────────────────────────
router.post("/", requireAction("billing.write"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.UHID) return res.status(400).json({ success: false, message: "UHID is required" });
    const lines = await _hydrateLines(b.lines);
    const doc = await CostEstimate.create({
      UHID: b.UHID,
      patientId: mongoose.isValidObjectId(b.patientId) ? b.patientId : null,
      patientName: b.patientName || "",
      admissionId: mongoose.isValidObjectId(b.admissionId) ? b.admissionId : null,
      admissionNumber: b.admissionNumber || "",
      visitType: b.visitType || "IPD",
      provisionalDiagnosis: b.provisionalDiagnosis || "",
      plannedProcedure: b.plannedProcedure || "",
      roomCategory: b.roomCategory || "",
      estimatedLengthOfStayDays: b.estimatedLengthOfStayDays ?? null,
      lines,
      estimatedTaxes: Number(b.estimatedTaxes) || 0,
      packageDiscount: Number(b.packageDiscount) || 0,
      advanceRequested: Number(b.advanceRequested) || 0,
      payerType: b.payerType || "SELF",
      insurerOrTpa: b.insurerOrTpa || "",
      validUntil: b.validUntil ? new Date(b.validUntil) : null,
      notes: b.notes || "",
      status: b.status === "Draft" ? "Draft" : "Issued",
      ..._actor(req),
    });
    return res.status(201).json({ success: true, data: doc });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[costEstimate] create failed:", e.message);
    return res.status(500).json({ success: false, message: e.message || "Create failed" });
  }
});

// ── GET / — list ───────────────────────────────────────────────────
router.get("/", requireAction("billing.read"), async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID) q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.admissionId && mongoose.isValidObjectId(req.query.admissionId)) q.admissionId = req.query.admissionId;
    if (req.query.status) q.status = req.query.status;
    const cap = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const rows = await CostEstimate.find(q).sort({ createdAt: -1 }).limit(cap).lean();
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || "List failed" });
  }
});

// ── GET /number/:number — retrieve by CE number ────────────────────
router.get("/number/:number", requireAction("billing.read"), async (req, res) => {
  try {
    const row = await CostEstimate.findOne({ estimateNumber: String(req.params.number).toUpperCase() }).lean();
    if (!row) return res.status(404).json({ success: false, message: "Estimate not found" });
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || "Lookup failed" });
  }
});

// ── GET /:id ───────────────────────────────────────────────────────
router.get("/:id", requireAction("billing.read"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await CostEstimate.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Estimate not found" });
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || "Lookup failed" });
  }
});

// ── POST /:id/revise — supersede with a new numbered estimate ──────
router.post("/:id/revise", requireAction("billing.write"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const prior = await CostEstimate.findById(req.params.id);
    if (!prior) return res.status(404).json({ success: false, message: "Estimate not found" });
    if (prior.status === "Superseded" || prior.status === "Cancelled") {
      return res.status(409).json({ success: false, message: `Cannot revise a ${prior.status} estimate` });
    }
    const b = req.body || {};
    const lines = b.lines ? await _hydrateLines(b.lines) : prior.lines.map((l) => l.toObject ? l.toObject() : l);
    const revised = await CostEstimate.create({
      UHID: prior.UHID,
      patientId: prior.patientId,
      patientName: prior.patientName,
      admissionId: prior.admissionId,
      admissionNumber: prior.admissionNumber,
      visitType: prior.visitType,
      provisionalDiagnosis: b.provisionalDiagnosis ?? prior.provisionalDiagnosis,
      plannedProcedure: b.plannedProcedure ?? prior.plannedProcedure,
      roomCategory: b.roomCategory ?? prior.roomCategory,
      estimatedLengthOfStayDays: b.estimatedLengthOfStayDays ?? prior.estimatedLengthOfStayDays,
      lines,
      estimatedTaxes: b.estimatedTaxes ?? prior.estimatedTaxes,
      packageDiscount: b.packageDiscount ?? prior.packageDiscount,
      advanceRequested: b.advanceRequested ?? prior.advanceRequested,
      payerType: b.payerType ?? prior.payerType,
      insurerOrTpa: b.insurerOrTpa ?? prior.insurerOrTpa,
      validUntil: b.validUntil ? new Date(b.validUntil) : prior.validUntil,
      notes: b.notes ?? prior.notes,
      status: "Issued",
      supersedes: prior._id,
      revisionOf: prior.estimateNumber,
      ..._actor(req),
    });
    prior.status = "Superseded";
    await prior.save();
    return res.status(201).json({ success: true, data: revised, supersededNumber: prior.estimateNumber });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[costEstimate] revise failed:", e.message);
    return res.status(500).json({ success: false, message: e.message || "Revise failed" });
  }
});

// ── POST /:id/cancel ───────────────────────────────────────────────
router.post("/:id/cancel", requireAction("billing.write"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const row = await CostEstimate.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Estimate not found" });
    row.status = "Cancelled";
    if (req.body?.reason) row.notes = `${row.notes ? row.notes + " | " : ""}Cancelled: ${req.body.reason}`;
    await row.save();
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || "Cancel failed" });
  }
});

module.exports = router;
