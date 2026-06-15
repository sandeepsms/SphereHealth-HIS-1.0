// routes/Clinical/patientDeviceRoutes.js — R7hr-184
//
// Invasive-device registry (intubation / catheter / cannula / lines).
// Doctor OR Nurse can place / change / remove (requireAnyAction mirrors
// the R7hr-114 doctor-notes pattern). Reads under mar.read so the same
// audience that sees the MAR + ICU bundles can see device status.
//
// Every write stamps the JWT actor (never client-supplied — R7gw-B1)
// and emits a ClinicalAudit row (NABH HIC.5 device-days trail).
const express = require("express");
const router  = express.Router();
const PatientDevice = require("../../models/Clinical/PatientDeviceModel");
const Admission = require("../../models/Patient/admissionModel");
const { requireAction, requireAnyAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");
const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");

const jwtActor = (req) => ({
  name:       req.user?.fullName || req.user?.name || "System",
  employeeId: req.user?.employeeId || "",
  role:       req.user?.role || "",
});

// ── Reads ───────────────────────────────────────────────────────────
// /ipd/:ipdNo?status=Active|Removed|all  (default: all, newest first)
router.get("/ipd/:ipdNo", requireAction("mar.read"), async (req, res) => {
  try {
    const q = { ipdNo: req.params.ipdNo };
    const st = req.query.status;
    if (st === "Active" || st === "Removed") q.status = st;
    const rows = await PatientDevice.find(q).sort({ status: 1, placedAt: -1 }).lean();
    res.json({ success: true, data: rows, deviceTypes: PatientDevice.DEVICE_TYPES });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get("/admission/:admissionId", validateObjectIdParam("admissionId"), requireAction("mar.read"), async (req, res) => {
  try {
    const q = { admissionId: req.params.admissionId };
    const st = req.query.status;
    if (st === "Active" || st === "Removed") q.status = st;
    const rows = await PatientDevice.find(q).sort({ status: 1, placedAt: -1 }).lean();
    res.json({ success: true, data: rows, deviceTypes: PatientDevice.DEVICE_TYPES });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── Place a new device ──────────────────────────────────────────────
router.post("/", requireAnyAction("doctor-orders.write", "nurse.write"), async (req, res) => {
  try {
    const { ipdNo, UHID, deviceType, site, size, placedAt, notes, deviceLabel } = req.body || {};
    if (!deviceType || !PatientDevice.DEVICE_TYPES[deviceType]) {
      return res.status(400).json({ success: false, message: "Valid deviceType is required" });
    }
    if (!ipdNo && !UHID) {
      return res.status(400).json({ success: false, message: "ipdNo or UHID is required" });
    }
    // Resolve the admission server-side so UHID / admissionId / name are
    // trustworthy even if the client sent only ipdNo. The Admission
    // schema's IPD number lives in `admissionNumber` (IPD-YY-NN, R7ag).
    const adm = await Admission.findOne(
      ipdNo ? { admissionNumber: ipdNo } : { UHID, status: "Active" }
    ).sort({ admissionDate: -1 }).lean();
    if (!adm) return res.status(404).json({ success: false, message: "Admission not found" });

    // Guard: don't double-register the same ACTIVE device type (one
    // active ET tube / Foley at a time; IV cannulas CAN coexist —
    // allow multiples only for IV_CANNULA / OTHER).
    const singleton = !["IV_CANNULA", "OTHER"].includes(deviceType);
    if (singleton) {
      const existing = await PatientDevice.findOne({ admissionId: adm._id, deviceType, status: "Active" }).lean();
      if (existing) {
        return res.status(409).json({ success: false, code: "DEVICE_ALREADY_ACTIVE", message: `${PatientDevice.DEVICE_TYPES[deviceType].label} is already active — use Change or Remove on the existing entry` });
      }
    }

    const doc = await PatientDevice.create({
      UHID: adm.UHID,
      admissionId: adm._id,
      ipdNo: adm.admissionNumber || adm.ipdNo || ipdNo || "",
      patientName: adm.patientName || "",
      deviceType,
      deviceLabel: (deviceLabel || "").trim() || PatientDevice.DEVICE_TYPES[deviceType].label,
      site: (site || "").trim(),
      size: (size || "").trim(),
      placedAt: placedAt ? new Date(placedAt) : new Date(),
      placedBy: jwtActor(req),
      notes: (notes || "").trim(),
    });

    emitClinicalAudit({
      req,
      event: "PATIENT_DEVICE_PLACED",
      UHID: doc.UHID,
      admissionId: doc.admissionId,
      patientName: doc.patientName,
      targetType: "PatientDevice",
      targetId: doc._id,
      after: { deviceType: doc.deviceType, site: doc.site, size: doc.size, placedAt: doc.placedAt },
    });

    res.status(201).json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── Log a change (re-site / article replacement) ───────────────────
router.patch("/:id/change", validateObjectIdParam("id"), requireAnyAction("doctor-orders.write", "nurse.write"), async (req, res) => {
  try {
    const doc = await PatientDevice.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Device entry not found" });
    if (doc.status !== "Active") {
      return res.status(400).json({ success: false, message: "Device already removed — place a new entry instead" });
    }
    const { reason, site, size, note, changedAt } = req.body || {};
    const entry = {
      changedAt: changedAt ? new Date(changedAt) : new Date(),
      changedBy: jwtActor(req),
      reason: (reason || "").trim(),
      site: (site || "").trim(),
      size: (size || "").trim(),
      note: (note || "").trim(),
    };
    doc.changes.push(entry);
    // The latest article's site/size become the device's current ones.
    if (entry.site) doc.site = entry.site;
    if (entry.size) doc.size = entry.size;
    await doc.save();

    emitClinicalAudit({
      req,
      event: "PATIENT_DEVICE_CHANGED",
      UHID: doc.UHID,
      admissionId: doc.admissionId,
      patientName: doc.patientName,
      targetType: "PatientDevice",
      targetId: doc._id,
      after: { deviceType: doc.deviceType, change: entry },
    });

    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── Remove the device ──────────────────────────────────────────────
router.patch("/:id/remove", validateObjectIdParam("id"), requireAnyAction("doctor-orders.write", "nurse.write"), async (req, res) => {
  try {
    const doc = await PatientDevice.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Device entry not found" });
    if (doc.status === "Removed") {
      return res.status(400).json({ success: false, message: "Device already removed" });
    }
    const { reason, removedAt } = req.body || {};
    doc.status = "Removed";
    doc.removedAt = removedAt ? new Date(removedAt) : new Date();
    doc.removedBy = jwtActor(req);
    doc.removalReason = (reason || "").trim();
    await doc.save();

    emitClinicalAudit({
      req,
      event: "PATIENT_DEVICE_REMOVED",
      UHID: doc.UHID,
      admissionId: doc.admissionId,
      patientName: doc.patientName,
      targetType: "PatientDevice",
      targetId: doc._id,
      after: { deviceType: doc.deviceType, removedAt: doc.removedAt, removalReason: doc.removalReason },
    });

    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
