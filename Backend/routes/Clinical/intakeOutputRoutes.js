// routes/Clinical/intakeOutputRoutes.js
// ════════════════════════════════════════════════════════════════════
// R7bq-3 / R7bq-4 / R7bq-5 — I/O ledger read + manual write API.
//
// Routes:
//   GET  /api/intake-output?admissionId=&from=&to=   list entries + totals
//   POST /api/intake-output                          manual entry (nurse)
//   PATCH /api/intake-output/:id/void                soft-cancel an entry
//
// `mar.read` gates the listing because the I/O chart is sensitive
// fluid-balance data; `mar.write` gates manual entry / void since
// those are nursing actions.
// ════════════════════════════════════════════════════════════════════
const express = require("express");
const router  = express.Router();
const mongoose = require("mongoose");
const { attemptAuth, requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");
const ioService = require("../../services/Clinical/intakeOutputService");

router.use(attemptAuth);

/**
 * GET /api/intake-output?admissionId=...&from=...&to=...
 * Returns:
 *   { ok, data: { rows: [...], totals: { in, out, net } } }
 */
router.get("/", requireAction("mar.read"), async (req, res) => {
  try {
    const { admissionId, UHID, from, to } = req.query;
    if (!admissionId && !UHID) {
      return res.status(400).json({ ok: false, message: "admissionId or UHID required" });
    }

    // Resolve admissionId from UHID if needed
    let resolvedId = admissionId;
    if (!resolvedId && UHID) {
      resolvedId = await ioService.resolveAdmissionId({ UHID });
      if (!resolvedId) {
        return res.json({ ok: true, data: { rows: [], totals: { in: 0, out: 0, net: 0 } } });
      }
    }
    if (!mongoose.isValidObjectId(resolvedId)) {
      return res.status(400).json({ ok: false, message: "Invalid admissionId" });
    }

    const result = await ioService.listForAdmission({
      admissionId: resolvedId,
      from,
      to,
    });
    return res.json({ ok: true, data: result });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

/**
 * POST /api/intake-output
 * Body: { admissionId, UHID, patientName?, direction, volumeML, fluidType?, label?, notes?, ts? }
 *
 * Used by the nurse "Intake / Output" chip in NursingNotes when she
 * records an oral fluid, drain, urine, etc. manually. Auto-fed rows
 * go through the service helpers, never this endpoint.
 */
router.post("/", requireAction("mar.write"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.admissionId || !b.UHID || !b.direction || b.volumeML == null) {
      return res.status(400).json({ ok: false, message: "admissionId, UHID, direction, volumeML required" });
    }
    const entry = await ioService.recordManualEntry({
      admissionId:  b.admissionId,
      UHID:         b.UHID,
      patientName:  b.patientName,
      direction:    b.direction,
      volumeML:     b.volumeML,
      fluidType:    b.fluidType,
      label:        b.label,
      notes:        b.notes,
      ts:           b.ts,
      recordedBy: {
        id:   req.user?.id || req.user?._id || null,
        name: req.user?.fullName
             || [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ").trim()
             || "Nurse",
        role: req.user?.role || "Nurse",
      },
    });
    return res.status(201).json({ ok: true, data: entry });
  } catch (e) {
    return res.status(400).json({ ok: false, message: e.message });
  }
});

/**
 * PATCH /api/intake-output/:id/void
 * Soft-cancel an entry (wrong auto-fed row, or correcting a manual entry).
 */
router.patch("/:id/void", validateObjectIdParam("id"), requireAction("mar.write"), async (req, res) => {
  try {
    const updated = await ioService.voidEntry({
      id: req.params.id,
      voidedBy: req.user?.fullName || req.user?.email || "Nurse",
      reason:   req.body?.reason || "",
    });
    if (!updated) return res.status(404).json({ ok: false, message: "Entry not found" });
    return res.json({ ok: true, data: updated });
  } catch (e) {
    return res.status(400).json({ ok: false, message: e.message });
  }
});

module.exports = router;
