/**
 * prom-premRegisterRoutes.js — R7gw-B10-T05 / NABH PRE.4 (6th-ed)
 *
 * PROM / PREM register write + read surface.
 *
 * Endpoints under /api/nabh-registers/prom-prem:
 *   GET  /            — list rows with q (free-text) / instrument /
 *                       dischargeContext / dateRange / UHID filters
 *   GET  /:id         — single row
 *   POST /            — PRO officer / floor nurse manual entry (one survey
 *                       administration → one row)
 *
 * Permissions:
 *   reads gated on `compliance.nabh.read`;
 *   writes gated on `compliance.nabh.write`.
 *
 * Writes call emitPROMPREMReg from nabhRegisterEmitter so the row goes
 * through the same idempotency / audit-trail path as any future auto-emit.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const PROMPREMRegRegister = require("../../../models/Compliance/PROMPREMRegRegisterModel");
const { emitPROMPREMReg } = require("../../../services/Compliance/nabhRegisterEmitter");

// ── GET / — list with filters ─────────────────────────────────────
router.get(
  "/",
  requireAction("compliance.nabh.read"),
  async (req, res) => {
    try {
      const {
        q = "",
        status = "",
        instrument = "",
        dischargeContext = "",
        UHID = "",
        startDate = "",
        endDate = "",
        limit = "200",
      } = req.query || {};

      const filter = {};
      if (status) filter.status = status;
      if (instrument) filter.instrument = instrument;
      if (UHID) filter.UHID = String(UHID).toUpperCase();
      if (dischargeContext === "true") filter.dischargeContext = true;
      if (dischargeContext === "false") filter.dischargeContext = false;

      if (startDate || endDate) {
        filter.administeredAt = {};
        if (startDate) filter.administeredAt.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.administeredAt.$lte = end;
        }
      }

      if (q) {
        const qre = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { patientName: qre },
          { UHID: qre },
          { comments: qre },
          { recommendation: qre },
          { administeredByName: qre },
          { administeredByEmpId: qre },
        ];
      }

      const cap = Math.max(1, Math.min(Number(limit) || 200, 1000));
      const rows = await PROMPREMRegRegister
        .find(filter)
        .sort({ administeredAt: -1 })
        .limit(cap)
        .lean();

      return res.json({ data: rows, count: rows.length });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[prom-premRegisterRoutes] list failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to list PROM/PREM register" });
    }
  },
);

// ── GET /:id ──────────────────────────────────────────────────────
router.get(
  "/:id",
  validateObjectIdParam("id"),
  requireAction("compliance.nabh.read"),
  async (req, res) => {
    try {
      const row = await PROMPREMRegRegister.findById(req.params.id).lean();
      if (!row) return res.status(404).json({ message: "Not found" });
      return res.json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[prom-premRegisterRoutes] getById failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to load row" });
    }
  },
);

// ── POST / — manual entry ─────────────────────────────────────────
router.post(
  "/",
  requireAction("compliance.nabh.write"),
  async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.UHID) {
        return res.status(400).json({ message: "UHID is required" });
      }
      if (!body.instrument) {
        return res.status(400).json({ message: "instrument is required" });
      }
      if (!body.administeredAt) {
        return res.status(400).json({ message: "administeredAt is required" });
      }

      const row = await emitPROMPREMReg({
        UHID: String(body.UHID).toUpperCase(),
        patientId: body.patientId || null,
        patientName: body.patientName || "",
        admissionId: body.admissionId || null,
        admissionNumber: body.admissionNumber || "",
        instrument: body.instrument,
        administeredAt: body.administeredAt,
        administeredByEmpId: body.administeredByEmpId || "",
        administeredByName: body.administeredByName || "",
        scores: body.scores || {},
        comments: body.comments || "",
        recommendation: body.recommendation || "",
        dischargeContext: body.dischargeContext != null ? !!body.dischargeContext : true,
        status: body.status || "Closed",
        sourceRef: body.sourceRef || "",   // empty → emit will generate UUID
        sourceType: "Manual",
        hospitalId: body.hospitalId || null,
        actor: req.user || {},
      });

      if (!row) return res.status(400).json({ message: "Failed to record PROM/PREM administration" });
      return res.status(201).json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[prom-premRegisterRoutes] create failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to create row" });
    }
  },
);

module.exports = router;
