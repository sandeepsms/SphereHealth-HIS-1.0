/**
 * esg-complianceRegisterRoutes.js — R7gw-B10-T03 / NABH 6th-ed Environment
 *
 * ESG (Environmental, Social & Governance) Compliance register write + read.
 *
 * Endpoints under /api/nabh-registers/esg-compliance:
 *   GET  /       — list rows with q / status / period / date-range filters
 *   GET  /:id    — single row
 *   POST /       — Compliance / Facilities monthly entry
 *
 * Permissions:
 *   reads gated on `compliance.nabh.read`
 *   writes gated on `compliance.nabh.write`
 *
 * Writes call emitESGCompliance from nabhRegisterEmitter so the row goes
 * through the same idempotency / audit-trail path as other registers.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const ESGComplianceRegister = require("../../../models/Compliance/ESGComplianceRegisterModel");
const { emitESGCompliance } = require("../../../services/Compliance/nabhRegisterEmitter");

// ── GET / — list with filters ─────────────────────────────────────
router.get(
  "/",
  requireAction("compliance.nabh.read"),
  async (req, res) => {
    try {
      const {
        q = "",
        status = "",
        period = "",
        startDate = "",
        endDate = "",
        reportedByEmpId = "",
        limit = "200",
      } = req.query || {};

      const filter = {};
      if (status) filter.status = status;
      if (period) filter.period = period;
      if (reportedByEmpId) filter.reportedByEmpId = reportedByEmpId;

      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.createdAt.$lte = end;
        }
      }

      if (q) {
        const qre = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { period: qre },
          { auditFindings: qre },
          { reportedByName: qre },
          { reportedByEmpId: qre },
        ];
      }

      const cap = Math.max(1, Math.min(Number(limit) || 200, 1000));
      const rows = await ESGComplianceRegister
        .find(filter)
        .sort({ period: -1, createdAt: -1 })
        .limit(cap)
        .lean();

      return res.json({ data: rows, count: rows.length });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[esg-complianceRegisterRoutes] list failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to list ESG-compliance register" });
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
      const row = await ESGComplianceRegister.findById(req.params.id).lean();
      if (!row) return res.status(404).json({ message: "Not found" });
      return res.json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[esg-complianceRegisterRoutes] getById failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to load row" });
    }
  },
);

// ── POST / — Compliance officer / Facilities monthly entry ────────
router.post(
  "/",
  requireAction("compliance.nabh.write"),
  async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.period || !/^\d{4}-\d{2}$/.test(String(body.period))) {
        return res.status(400).json({ message: "period (YYYY-MM) is required" });
      }
      if (!body.reportedByEmpId) {
        return res.status(400).json({ message: "reportedByEmpId is required" });
      }

      const initiatives = Array.isArray(body.greenInitiatives)
        ? body.greenInitiatives.map((s) => String(s).trim()).filter(Boolean)
        : (typeof body.greenInitiatives === "string"
            ? String(body.greenInitiatives).split(",").map((s) => s.trim()).filter(Boolean)
            : []);

      const row = await emitESGCompliance({
        report: {
          period: String(body.period),
          energyKwh:         Number(body.energyKwh)         || 0,
          waterKl:           Number(body.waterKl)           || 0,
          dieselLitres:      Number(body.dieselLitres)      || 0,
          medicalWasteKg:    Number(body.medicalWasteKg)    || 0,
          biomedicalWasteKg: Number(body.biomedicalWasteKg) || 0,
          recycledPct:       Number(body.recycledPct)       || 0,
          co2eqKg:           Number(body.co2eqKg)           || 0,
          greenInitiatives:  initiatives,
          auditFindings:     body.auditFindings || "",
          reportedByEmpId:   body.reportedByEmpId,
          reportedByName:    body.reportedByName || "",
          status:            body.status || "Closed",
          sourceRef:         body.sourceRef || "",   // empty → emit will generate UUID
          sourceType:        "Manual",
          hospitalId:        body.hospitalId || null,
        },
        actor: req.user || {},
      });

      if (!row) return res.status(400).json({ message: "Failed to record ESG report" });
      return res.status(201).json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[esg-complianceRegisterRoutes] create failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to create row" });
    }
  },
);

module.exports = router;
