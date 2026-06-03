/**
 * statutoryRegisterRoutes.js — R7gw-B10-T07 / NABH AAC.16
 *
 * Statutory Compliance register write + read surface.
 *
 * Endpoints under /api/nabh-registers/statutory:
 *   GET  /            — list rows with filters (licenseType / renewalStatus /
 *                       status / expiry-window / q free-text)
 *   GET  /:id         — single row
 *   POST /            — Compliance / Admin manual entry (add new licence or
 *                       renewal)
 *
 * Permissions:
 *   reads gated on `compliance.nabh.read` (Admin + Doctor + Nurse + MRD +
 *                                          ComplianceOfficer);
 *   writes gated on `compliance.nabh.write` (Admin + ComplianceOfficer).
 *
 * Writes route through emitStatutoryCompliance in nabhRegisterEmitter so the
 * row goes through the same idempotency / audit-trail path as auto-emitted
 * rows (even though this register has no auto-trigger today).
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const StatutoryComplianceRegister = require("../../../models/Compliance/StatutoryComplianceRegisterModel");
const { emitStatutoryCompliance } = require("../../../services/Compliance/nabhRegisterEmitter");

// ── GET / — list with filters ─────────────────────────────────────
router.get(
  "/",
  requireAction("compliance.nabh.read"),
  async (req, res) => {
    try {
      const {
        q = "",
        status = "",
        licenseType = "",
        renewalStatus = "",
        expiringWithinDays = "",
        startDate = "",
        endDate = "",
        limit = "200",
      } = req.query || {};

      const filter = {};
      if (status) filter.status = status;
      if (licenseType) filter.licenseType = licenseType;
      if (renewalStatus) filter.renewalStatus = renewalStatus;

      // expiringWithinDays — surveyor-friendly "show me everything expiring in
      // the next N days" filter for dashboard alerts.
      if (expiringWithinDays) {
        const days = Math.max(0, Math.min(Number(expiringWithinDays) || 0, 3650));
        const end = new Date();
        end.setDate(end.getDate() + days);
        filter.expiryDate = { $lte: end };
      } else if (startDate || endDate) {
        // Issue-date range filter (alternative). Field: issuedDate.
        filter.issuedDate = {};
        if (startDate) filter.issuedDate.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.issuedDate.$lte = end;
        }
      }

      if (q) {
        const qre = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { licenseNo: qre },
          { issuedBy: qre },
          { notes: qre },
        ];
      }

      const cap = Math.max(1, Math.min(Number(limit) || 200, 1000));
      const rows = await StatutoryComplianceRegister
        .find(filter)
        .sort({ expiryDate: 1, createdAt: -1 })
        .limit(cap)
        .lean();

      return res.json({ data: rows, count: rows.length });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[statutoryRegisterRoutes] list failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to list statutory register" });
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
      const row = await StatutoryComplianceRegister.findById(req.params.id).lean();
      if (!row) return res.status(404).json({ message: "Not found" });
      return res.json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[statutoryRegisterRoutes] getById failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to load row" });
    }
  },
);

// ── POST / — manual Compliance officer entry ──────────────────────
router.post(
  "/",
  requireAction("compliance.nabh.write"),
  async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.licenseType) {
        return res.status(400).json({ message: "licenseType is required" });
      }
      if (!body.licenseNo) {
        return res.status(400).json({ message: "licenseNo is required" });
      }

      const row = await emitStatutoryCompliance({
        entry: {
          licenseType: body.licenseType,
          licenseNo: body.licenseNo,
          issuedBy: body.issuedBy || "",
          issuedDate: body.issuedDate || null,
          expiryDate: body.expiryDate || null,
          renewalAppliedDate: body.renewalAppliedDate || null,
          renewalStatus: body.renewalStatus || "NotStarted",
          documentPath: body.documentPath || "",
          notes: body.notes || "",
          status: body.status || "Active",
          sourceRef: body.sourceRef || "",   // empty → emit will generate UUID
          sourceType: "Manual",
          hospitalId: body.hospitalId || null,
        },
        actor: req.user || {},
      });

      if (!row) return res.status(400).json({ message: "Failed to record licence" });
      return res.status(201).json({ data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[statutoryRegisterRoutes] create failed:", e.message);
      return res.status(500).json({ message: e.message || "Failed to create row" });
    }
  },
);

module.exports = router;
