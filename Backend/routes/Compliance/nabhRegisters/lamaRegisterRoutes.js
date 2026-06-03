/**
 * lamaRegisterRoutes.js — R7gw-B9-B9-T07 / NABH AAC.4
 *
 * LAMA / DAMA Register surface. Auto-populated when a discharge is
 * finalised with disposition === "LAMA" via emitLAMA in
 * nabhRegisterEmitter.js. Also exposes a manual POST so Compliance /
 * MRD can backfill historical episodes or capture LAMA events that
 * happened outside the discharge form (e.g. an ER patient who walked out
 * before triage).
 *
 * Endpoints (mounted at /api/nabh-registers/lama):
 *   GET    /        — List with filters (?q, ?status, ?startDate, ?endDate, ?UHID)
 *   GET    /:id     — Single row by _id
 *   POST   /        — Manual entry (Admin / Doctor / Nurse / MRD)
 */
"use strict";

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { requireAction } = require("../../../middleware/auth");
const { validateObjectIdParam } = require("../../../utils/queryGuards");
const LAMARegister = require("../../../models/Compliance/LAMARegisterModel");
const emitter = require("../../../services/Compliance/nabhRegisterEmitter");

function _dateRange(query) {
  const out = {};
  if (query.startDate) out.$gte = new Date(query.startDate);
  if (query.endDate) {
    const e = new Date(query.endDate);
    e.setHours(23, 59, 59, 999);
    out.$lte = e;
  }
  return Object.keys(out).length ? out : null;
}

function _pageLimit(query) {
  const page  = Math.max(1, parseInt(query.page  || "1", 10));
  const limit = Math.min(500, Math.max(1, parseInt(query.limit || "50", 10)));
  return { page, limit, skip: (page - 1) * limit };
}

// ─────────────────────────────────────────────────────────────────────────
// GET / — list with filters
// ─────────────────────────────────────────────────────────────────────────
router.get("/", requireAction("compliance.nabh.read"), async (req, res) => {
  try {
    const q = {};
    if (req.query.UHID)   q.UHID = String(req.query.UHID).toUpperCase();
    if (req.query.status) q.status = req.query.status;

    // Free-text search across patient name + reason + witness name + UHID
    if (req.query.q) {
      const term = String(req.query.q).trim();
      if (term) {
        const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        q.$or = [
          { patientName:  new RegExp(safe, "i") },
          { lamaReason:   new RegExp(safe, "i") },
          { witnessName:  new RegExp(safe, "i") },
          { UHID:         new RegExp(safe, "i") },
          { transferTo:   new RegExp(safe, "i") },
        ];
      }
    }

    const dr = _dateRange(req.query);
    if (dr) q.lamaAt = dr;

    const { page, limit, skip } = _pageLimit(req.query);
    const [rows, total] = await Promise.all([
      LAMARegister.find(q).sort({ lamaAt: -1 }).skip(skip).limit(limit).lean(),
      LAMARegister.countDocuments(q),
    ]);
    return res.json({ success: true, data: rows, total, pagination: { page, limit, total } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /:id — single row
// ─────────────────────────────────────────────────────────────────────────
router.get("/:id", validateObjectIdParam("id"), requireAction("compliance.nabh.read"), async (req, res) => {
  try {
    const row = await LAMARegister.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "LAMA register row not found" });
    return res.json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST / — manual entry
//
// Body shape: { UHID, patientId?, patientName?, admissionId?, lamaAt?,
//   lamaReason, patientSignature?, witnessName?, witnessSignature?,
//   doctorCounsellingNotes?, risksExplained?, familyInformed?,
//   policeNotified?, transferRequested?, transferTo?, sourceRef? }
// ─────────────────────────────────────────────────────────────────────────
router.post("/", requireAction("compliance.nabh.write"), async (req, res) => {
  try {
    const body = req.body || {};
    const UHID = String(body.UHID || "").trim().toUpperCase();
    if (!UHID) return res.status(400).json({ success: false, message: "UHID is required" });

    const row = await emitter.emitLAMA({
      patient: {
        _id: mongoose.isValidObjectId(body.patientId) ? body.patientId : null,
        UHID,
        fullName: body.patientName || "",
        age: body.age || null,
        gender: body.sex || body.gender || "",
      },
      admission: mongoose.isValidObjectId(body.admissionId)
        ? { _id: body.admissionId, admissionNumber: body.admissionNumber || "" }
        : null,
      lama: {
        sourceRef:              body.sourceRef || undefined,
        sourceType:             body.sourceType || "Manual",
        lamaAt:                 body.lamaAt || new Date(),
        lamaReason:             body.lamaReason || "",
        patientSignature:       body.patientSignature || "",
        witnessName:            body.witnessName || "",
        witnessSignature:       body.witnessSignature || "",
        doctorCounsellingNotes: body.doctorCounsellingNotes || "",
        risksExplained:         !!body.risksExplained,
        familyInformed:         !!body.familyInformed,
        policeNotified:         !!body.policeNotified,
        policeStation:          body.policeStation || "",
        policeFIRNo:            body.policeFIRNo || "",
        transferRequested:      !!body.transferRequested,
        transferTo:             body.transferTo || "",
        counsellingDoctor:      body.counsellingDoctor || "",
        counsellingDoctorId:    mongoose.isValidObjectId(body.counsellingDoctorId) ? body.counsellingDoctorId : null,
        hospitalId:             mongoose.isValidObjectId(body.hospitalId) ? body.hospitalId : null,
      },
      actor: req.user || {},
    });

    if (!row) {
      return res.status(400).json({
        success: false,
        message: "Could not write LAMA register row (check server logs)",
      });
    }
    return res.status(201).json({ success: true, data: row });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
