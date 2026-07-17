/**
 * labRecordsController.js — manual lab data entry (trends + narrative
 * reports). Public surface under /api/lab-records.
 *
 *   /panels        — preset test panels (CBC, LFT, etc.) + report types
 *   /trends        list / get / create / update / verify
 *   /reports       list / get / create / update / verify
 */
const { LabTrend, LabReport } = require("../../models/Clinical/labRecordsModels");
const sendErr = require("../../utils/sendErr");
const resolveUserName = require("../../utils/userName");

/* ── Reference panels (single source of truth, served to frontend) ── */
const PANELS = {
  CBC: {
    label: "Complete Blood Count",
    tests: [
      { name: "Hb",         unit: "g/dL",   refMin: 12,   refMax: 16 },
      { name: "TLC",        unit: "/mm³",   refMin: 4000, refMax: 11000 },
      { name: "Platelets",  unit: "/mm³",   refMin: 150000, refMax: 450000 },
      { name: "HCT (PCV)",  unit: "%",      refMin: 36,   refMax: 48 },
      { name: "RBC",        unit: "M/μL",   refMin: 4.5,  refMax: 5.9 },
      { name: "MCV",        unit: "fL",     refMin: 80,   refMax: 100 },
      { name: "MCH",        unit: "pg",     refMin: 27,   refMax: 33 },
      { name: "MCHC",       unit: "g/dL",   refMin: 32,   refMax: 36 },
      { name: "Neutrophils",unit: "%",      refMin: 40,   refMax: 75 },
      { name: "Lymphocytes",unit: "%",      refMin: 20,   refMax: 45 },
      { name: "ESR",        unit: "mm/hr",  refMin: 0,    refMax: 20 },
    ],
  },
  BIOCHEM: {
    label: "Biochemistry (Standard)",
    tests: [
      { name: "Glucose (RBS)", unit: "mg/dL", refMin: 70,  refMax: 140 },
      { name: "Glucose (FBS)", unit: "mg/dL", refMin: 70,  refMax: 100 },
      { name: "Urea",          unit: "mg/dL", refMin: 15,  refMax: 45 },
      { name: "Creatinine",    unit: "mg/dL", refMin: 0.6, refMax: 1.3 },
      { name: "Sodium",        unit: "mmol/L",refMin: 135, refMax: 145 },
      { name: "Potassium",     unit: "mmol/L",refMin: 3.5, refMax: 5 },
      { name: "Chloride",      unit: "mmol/L",refMin: 96,  refMax: 106 },
      { name: "Calcium",       unit: "mg/dL", refMin: 8.5, refMax: 10.5 },
      { name: "CRP",           unit: "mg/L",  refMin: 0,   refMax: 6 },
    ],
  },
  LFT: {
    label: "Liver Function Test",
    tests: [
      { name: "Bilirubin Total",    unit: "mg/dL", refMin: 0.2,  refMax: 1.2 },
      { name: "Bilirubin Direct",   unit: "mg/dL", refMin: 0,    refMax: 0.3 },
      { name: "Bilirubin Indirect", unit: "mg/dL", refMin: 0.2,  refMax: 0.9 },
      { name: "SGOT (AST)",         unit: "U/L",   refMin: 5,    refMax: 40 },
      { name: "SGPT (ALT)",         unit: "U/L",   refMin: 5,    refMax: 40 },
      { name: "ALP",                unit: "U/L",   refMin: 44,   refMax: 147 },
      { name: "GGT",                unit: "U/L",   refMin: 9,    refMax: 48 },
      { name: "Total Protein",      unit: "g/dL",  refMin: 6,    refMax: 8.3 },
      { name: "Albumin",            unit: "g/dL",  refMin: 3.5,  refMax: 5 },
      { name: "Globulin",           unit: "g/dL",  refMin: 2,    refMax: 3.5 },
    ],
  },
  KFT: {
    label: "Kidney Function Test",
    tests: [
      { name: "Urea",       unit: "mg/dL",  refMin: 15,  refMax: 45 },
      { name: "Creatinine", unit: "mg/dL",  refMin: 0.6, refMax: 1.3 },
      { name: "Uric Acid",  unit: "mg/dL",  refMin: 3.4, refMax: 7 },
      { name: "Sodium",     unit: "mmol/L", refMin: 135, refMax: 145 },
      { name: "Potassium",  unit: "mmol/L", refMin: 3.5, refMax: 5 },
      { name: "Chloride",   unit: "mmol/L", refMin: 96,  refMax: 106 },
      { name: "eGFR",       unit: "mL/min", refMin: 90,  refMax: 120 },
    ],
  },
  LIPID: {
    label: "Lipid Profile",
    tests: [
      { name: "Total Cholesterol", unit: "mg/dL", refMin: 0,  refMax: 200 },
      { name: "LDL",               unit: "mg/dL", refMin: 0,  refMax: 100 },
      { name: "HDL",               unit: "mg/dL", refMin: 40, refMax: 60 },
      { name: "Triglycerides",     unit: "mg/dL", refMin: 0,  refMax: 150 },
      { name: "VLDL",              unit: "mg/dL", refMin: 5,  refMax: 40 },
      { name: "Cholesterol/HDL",   unit: "ratio", refMin: 0,  refMax: 4.5 },
    ],
  },
  THYROID: {
    label: "Thyroid Profile",
    tests: [
      { name: "TSH", unit: "μIU/mL", refMin: 0.4, refMax: 4 },
      { name: "T3",  unit: "ng/dL",  refMin: 80,  refMax: 200 },
      { name: "T4",  unit: "μg/dL",  refMin: 5,   refMax: 12 },
      { name: "FT3", unit: "pg/mL",  refMin: 2.3, refMax: 4.2 },
      { name: "FT4", unit: "ng/dL",  refMin: 0.8, refMax: 1.8 },
    ],
  },
  COAG: {
    label: "Coagulation Profile",
    tests: [
      { name: "PT",      unit: "sec",   refMin: 11,  refMax: 13.5 },
      { name: "INR",     unit: "",      refMin: 0.8, refMax: 1.2 },
      { name: "APTT",    unit: "sec",   refMin: 25,  refMax: 35 },
      { name: "D-Dimer", unit: "ng/mL", refMin: 0,   refMax: 500 },
      { name: "Fibrinogen", unit: "mg/dL", refMin: 200, refMax: 400 },
    ],
  },
  ABG: {
    label: "Arterial Blood Gas",
    tests: [
      { name: "pH",      unit: "",       refMin: 7.35, refMax: 7.45 },
      { name: "pCO2",    unit: "mmHg",   refMin: 35,   refMax: 45 },
      { name: "pO2",     unit: "mmHg",   refMin: 75,   refMax: 100 },
      { name: "HCO3",    unit: "mmol/L", refMin: 22,   refMax: 28 },
      { name: "BE",      unit: "mmol/L", refMin: -2,   refMax: 2 },
      { name: "SaO2",    unit: "%",      refMin: 95,   refMax: 100 },
      { name: "Lactate", unit: "mmol/L", refMin: 0.5,  refMax: 2 },
    ],
  },
  URINE: {
    label: "Urine Routine + Microscopy",
    tests: [
      { name: "Colour",           unit: "", refMin: null, refMax: null },
      { name: "Appearance",       unit: "", refMin: null, refMax: null },
      { name: "pH",               unit: "", refMin: 4.5, refMax: 8 },
      { name: "Specific Gravity", unit: "", refMin: 1.005, refMax: 1.030 },
      { name: "Protein",          unit: "", refMin: null, refMax: null },
      { name: "Glucose",          unit: "", refMin: null, refMax: null },
      { name: "Ketones",          unit: "", refMin: null, refMax: null },
      { name: "Blood",            unit: "", refMin: null, refMax: null },
      { name: "Pus cells",        unit: "/hpf", refMin: 0, refMax: 5 },
      { name: "RBCs",             unit: "/hpf", refMin: 0, refMax: 2 },
      { name: "Casts",            unit: "", refMin: null, refMax: null },
      { name: "Crystals",         unit: "", refMin: null, refMax: null },
    ],
  },
};

const REPORT_TYPES = [
  { value: "imaging-xray",  label: "X-ray",       group: "Imaging" },
  { value: "imaging-usg",   label: "Ultrasound",  group: "Imaging" },
  { value: "imaging-ct",    label: "CT scan",     group: "Imaging" },
  { value: "imaging-mri",   label: "MRI",         group: "Imaging" },
  { value: "imaging-mammo", label: "Mammography", group: "Imaging" },
  { value: "imaging-bmd",   label: "BMD (DEXA)",  group: "Imaging" },
  { value: "imaging-other", label: "Other imaging", group: "Imaging" },
  { value: "microbiology",  label: "Microbiology / Culture", group: "Path" },
  { value: "histopath",     label: "Histopathology", group: "Path" },
  { value: "cytology",      label: "Cytology",       group: "Path" },
  { value: "ecg",           label: "ECG",            group: "Cardio" },
  { value: "echo",          label: "Echocardiogram", group: "Cardio" },
  { value: "pft",           label: "Pulmonary Function Test", group: "Other" },
  { value: "endoscopy",     label: "Endoscopy",      group: "Other" },
  { value: "other",         label: "Other",          group: "Other" },
];

/* Classify a numeric reading against the test's reference range.
   • outside range but within ±20% → borderline (yellow)
   • outside range and beyond ±20%  → critical   (red)
   • within range                   → normal     (green)
   • non-numeric                    → ""         (no colour) */
function classify(value, refMin, refMax) {
  const n = parseFloat(value);
  if (isNaN(n) || refMin == null || refMax == null) return "";
  if (n < refMin * 0.8 || n > refMax * 1.2) return "critical";
  if (n < refMin || n > refMax) return "borderline";
  return "normal";
}

/* Walk every reading in a trend body and stamp the auto-status. */
function applyClassification(tests) {
  for (const t of (tests || [])) {
    for (const r of (t.readings || [])) {
      r.status = classify(r.value, t.refMin, t.refMax);
    }
  }
}

/* ── Presets endpoint ─────────────────────────────────────── */
exports.panels  = (req, res) => res.json({ success: true, data: PANELS });
exports.reportTypes = (req, res) => res.json({ success: true, data: REPORT_TYPES });

/* ── TRENDS ────────────────────────────────────────────── */
exports.trendList = async (req, res) => {
  try {
    const filter = {};
    if (req.query?.UHID) filter.UHID = req.query.UHID;
    if (req.query?.status) filter.status = req.query.status;
    const rows = await LabTrend.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { sendErr(res, e); }
};

exports.trendGet = async (req, res) => {
  try {
    const row = await LabTrend.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { sendErr(res, e); }
};

exports.trendCreate = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.UHID) return res.status(400).json({ success: false, message: "UHID required" });
    applyClassification(body.tests);
    const name = await resolveUserName(req);
    body.createdBy     = req.user?.id;
    body.createdByName = name;
    body.updatedBy     = req.user?.id;
    body.updatedByName = name;
    // R9-FIX(R9-052): a fresh sheet is ALWAYS draft — verification is the gated
    // lab.records.verify transition, never settable at create. Previously
    // `status || "draft"` let a Lab Tech POST status:"verified" with a forged
    // verifiedByName, releasing a NABL report under a radiologist's signature.
    body.status = "draft";
    delete body.verifiedBy;
    delete body.verifiedByName;
    delete body.verifiedAt;
    const row = await LabTrend.create(body);
    res.status(201).json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.trendUpdate = async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    // NABL / ISO 15189 7.4.1.7 — a VERIFIED (released) sheet's result VALUES
    // are locked; a generic update must not silently overwrite them. Only a
    // recorded amendment may correct a released report.
    const existing = await LabTrend.findById(req.params.id).select("status").lean();
    if (!existing) return res.status(404).json({ success: false, message: "Not found" });
    if (existing.status === "verified" && (body.tests !== undefined || body.results !== undefined)) {
      return res.status(409).json({ success: false, code: "REPORT_VERIFIED_LOCKED", message: "This sheet is verified — result values are locked. Correct a released report through a recorded amendment, not a generic edit." });
    }
    // R7hr(LAB-P4) — same guard as reportUpdate (R7hr-233): verification is
    // the lab.records.verify transition; a generic write must never forge
    // the verified status or the signatory stamps on a NABL report.
    if (body.status === "verified") delete body.status;
    delete body.verifiedBy;
    delete body.verifiedByName;
    delete body.verifiedAt;
    if (body.tests) applyClassification(body.tests);
    body.updatedBy     = req.user?.id;
    body.updatedByName = await resolveUserName(req);
    const row = await LabTrend.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true }).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.trendVerify = async (req, res) => {
  try {
    // TD-2 (NABH AAC.3 / ISO 15189 deferred gate, now live) — results run on
    // an analyser whose latest QC control FAILED must not be released until
    // a passing control is logged. Only fires when the sheet names its
    // analyser (LAB-P4 equipmentId) AND a QC row exists for it; sheets
    // without equipment info verify as before.
    const sheetDoc = await LabTrend.findById(req.params.id).select("equipmentId").lean();
    if (sheetDoc?.equipmentId) {
      const eq = sheetDoc.equipmentId.trim();
      const { escapeRegex } = require("../../utils/queryGuards");
      const lastQc = await LabQCLog.findOne({ equipmentName: new RegExp(`^${escapeRegex(eq)}$`, "i") })
        .sort({ performedAt: -1 }).lean();
      if (lastQc && lastQc.result === "FAIL") {
        return res.status(409).json({
          success: false, code: "QC_FAILED",
          message: `Release blocked — latest QC on ${eq} FAILED (${new Date(lastQc.performedAt).toLocaleString("en-IN")}). Log a passing control, then verify.`,
        });
      }
    }
    // R7hr(LAB-P4) — stamp the authorizing signatory's NAME too: the NABL
    // print must show who released the report, not just an ObjectId.
    const row = await LabTrend.findByIdAndUpdate(req.params.id,
      { $set: { status: "verified", verifiedBy: req.user?.id, verifiedByName: await resolveUserName(req), verifiedAt: new Date() } },
      { new: true }).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── REPORTS ─────────────────────────────────────────── */
exports.reportList = async (req, res) => {
  try {
    const filter = {};
    if (req.query?.UHID) filter.UHID = req.query.UHID;
    if (req.query?.reportType) filter.reportType = req.query.reportType;
    if (req.query?.status) filter.status = req.query.status;
    const rows = await LabReport.find(filter).sort({ reportDate: -1 }).limit(100).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { sendErr(res, e); }
};

exports.reportGet = async (req, res) => {
  try {
    const row = await LabReport.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { sendErr(res, e); }
};

exports.reportCreate = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.UHID || !body.reportType || !body.testName) {
      return res.status(400).json({ success: false, message: "UHID + reportType + testName required" });
    }
    body.reportedBy     = req.user?.id;
    body.reportedByName = await resolveUserName(req);
    body.reportDate     = body.reportDate ? new Date(body.reportDate) : new Date();
    // R9-FIX(R9-052): verification is the gated lab.records.verify transition —
    // a create must never mint an already-"verified" report or forge the
    // verifying signatory (mirrors reportUpdate's strip).
    if (body.status === "verified") delete body.status;
    body.status = body.status || "reported";
    delete body.verifiedBy;
    delete body.verifiedByName;
    delete body.verifiedAt;
    const row = await LabReport.create(body);
    res.status(201).json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.reportUpdate = async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    // NABL / ISO 15189 7.4.1.7 — a VERIFIED (released) report's content is
    // locked; a generic update must not silently overwrite results/findings.
    const existing = await LabReport.findById(req.params.id).select("status").lean();
    if (!existing) return res.status(404).json({ success: false, message: "Not found" });
    const VALUE_FIELDS = ["findings", "impression", "clinicalDetails", "organism", "sensitivity", "parameters", "results", "recommendation", "microMethod"];
    if (existing.status === "verified" && VALUE_FIELDS.some((f) => body[f] !== undefined)) {
      return res.status(409).json({ success: false, code: "REPORT_VERIFIED_LOCKED", message: "This report is verified — its content is locked. Correct a released report through a recorded amendment, not a generic edit." });
    }
    // R7hr-233 (audit: lab self-verify escalation) — verification is the
    // doctor-only transition and must go through reportVerify; never let a
    // generic field update forge the verified status or its identity stamps.
    if (body.status === "verified") delete body.status;
    delete body.verifiedBy;
    delete body.verifiedAt;
    const row = await LabReport.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true }).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.reportVerify = async (req, res) => {
  try {
    const row = await LabReport.findByIdAndUpdate(req.params.id,
      { $set: { status: "verified", verifiedBy: req.user?.id, verifiedByName: await resolveUserName(req), verifiedAt: new Date() } },
      { new: true }).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* R7hr(LAB-P3) — attach the ORIGINAL scanned outside report (PDF / image)
   to a LabReport. The files land on disk via safeUpload (hardened multer,
   uploads/lab-records/); we only ever store server-derived /uploads paths
   in `attachments`, then re-validate them with filterSafeUrls so a crafted
   filename can never smuggle a javascript:/data: URL into the array. */
exports.reportAttachmentUpload = async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ success: false, message: "No files uploaded" });
    const { filterSafeUrls } = require("../../utils/urlValidator");
    const urls = filterSafeUrls(files.map((f) => `/uploads/lab-records/${f.filename}`));
    const row = await LabReport.findByIdAndUpdate(
      req.params.id,
      { $push: { attachments: { $each: urls } } },
      { new: true },
    ).lean();
    if (!row) return res.status(404).json({ success: false, message: "Report not found" });
    res.status(201).json({ success: true, data: row, added: urls });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.reportAttachmentDelete = async (req, res) => {
  try {
    const target = String(req.body?.path || req.query?.path || "");
    if (!target) return res.status(400).json({ success: false, message: "path required" });
    const row = await LabReport.findByIdAndUpdate(
      req.params.id,
      { $pull: { attachments: target } },
      { new: true },
    ).lean();
    if (!row) return res.status(404).json({ success: false, message: "Report not found" });
    // best-effort unlink — only within our own uploads/lab-records dir.
    if (/^\/uploads\/lab-records\/[a-zA-Z0-9._-]+$/.test(target)) {
      const fs = require("fs"), path = require("path");
      fs.unlink(path.join(__dirname, "..", "..", target.replace(/^\//, "")), () => {});
    }
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* Expose presets to other modules without re-fetching */
exports._PANELS = PANELS;
exports._REPORT_TYPES = REPORT_TYPES;
exports._classify = classify;

/* ────────────────────────────────────────────────────────────
   R7bb-FIX-E-8 / D6-CRIT-5: Lab QC log + panel CRUD
   ─────────────────────────────────────────────────────────
   NABH AAC.3 + ISO 15189 require labs to run a control sample
   per analyzer per shift and retain the record. Pre-R7bb the
   HIS had no place for this — labs kept paper logs that didn't
   tie to a result trail. The collection lives in models/Lab.

   Endpoints (routes registered in labRecordsRoutes.js):
     GET  /api/lab-records/qc       — list (filterable)
     POST /api/lab-records/qc       — create a QC entry
     POST /api/lab-records/panels   — Lab Tech adds a custom panel
     PUT  /api/lab-records/panels/:code — update custom panel
     DELETE /api/lab-records/panels/:code — soft-delete (deactivate)
   ──────────────────────────────────────────────────────────── */
const LabQCLog = require("../../models/Lab/LabQCLogModel");

exports.qcList = async (req, res) => {
  try {
    const { equipmentName, result, from, to } = req.query;
    const q = {};
    if (equipmentName) q.equipmentName = new RegExp(String(equipmentName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (result && ["PASS", "FAIL"].includes(String(result).toUpperCase())) q.result = String(result).toUpperCase();
    if (from || to) {
      q.performedAt = {};
      if (from) q.performedAt.$gte = new Date(`${from}T00:00:00`);
      if (to)   q.performedAt.$lte = new Date(`${to}T23:59:59.999`);
    }
    const rows = await LabQCLog.find(q).sort({ performedAt: -1 }).limit(500).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { sendErr(res, e); }
};

exports.qcCreate = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.equipmentName) {
      return res.status(400).json({ success: false, message: "equipmentName required" });
    }
    if (!["PASS", "FAIL"].includes(String(body.result || "").toUpperCase())) {
      return res.status(400).json({ success: false, message: "result must be PASS or FAIL" });
    }
    body.result = String(body.result).toUpperCase();
    body.performedBy   = req.user?.fullName || req.user?.employeeId || "Lab";
    body.performedById = req.user?.id || req.user?._id || null;
    body.performedByRole = req.user?.role || "";
    body.performedAt = body.performedAt ? new Date(body.performedAt) : new Date();
    // R9-FIX(R9-049): retainUntil drives a TTL index (expireAfterSeconds:0), so
    // a client-supplied past date would make MongoDB auto-delete the QC row —
    // erasing the NABL quality-control evidence. It is server-owned (model
    // default / retention floor), never accepted from the body.
    delete body.retainUntil;
    const row = await LabQCLog.create(body);
    res.status(201).json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

// In-memory custom-panel store. Persisted via a lightweight collection
// (re-using the labRecordsModels file would require a schema add; keep
// MVP simple by leaning on PANELS at runtime + a separate Mongo doc
// per custom panel).
const CustomPanelSchema = new (require("mongoose").Schema)({
  code:    { type: String, required: true, unique: true, uppercase: true, trim: true },
  label:   { type: String, required: true, trim: true },
  tests:   [{
    name:   { type: String, required: true },
    unit:   { type: String, default: "" },
    refMin: { type: Number, default: null },
    refMax: { type: Number, default: null },
  }],
  active:    { type: Boolean, default: true },
  createdBy: { type: String, trim: true, default: "" },
  createdById: { type: require("mongoose").Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });
const CustomPanel = require("mongoose").models.LabCustomPanel ||
  require("mongoose").model("LabCustomPanel", CustomPanelSchema);

exports.panelCreate = async (req, res) => {
  try {
    const { code, label, tests } = req.body || {};
    if (!code || !label) {
      return res.status(400).json({ success: false, message: "code and label required" });
    }
    if (!Array.isArray(tests) || !tests.length) {
      return res.status(400).json({ success: false, message: "tests[] required with at least one entry" });
    }
    const upperCode = String(code).toUpperCase().trim();
    // Conflict with built-in PANELS code.
    if (PANELS[upperCode]) {
      return res.status(409).json({
        success: false,
        message: `Code '${upperCode}' is a built-in panel — choose another code.`,
      });
    }
    const row = await CustomPanel.create({
      code: upperCode, label, tests,
      createdBy: req.user?.fullName || req.user?.employeeId || "",
      createdById: req.user?.id || req.user?._id || null,
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ success: false, message: "Panel code already exists" });
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.panelUpdate = async (req, res) => {
  try {
    const code = String(req.params.code || "").toUpperCase().trim();
    if (PANELS[code]) {
      return res.status(409).json({ success: false, message: `'${code}' is built-in and immutable` });
    }
    // R7hr-249 (audit: mass-assignment) — strip protected/identity fields from
    // the raw spread so a client can't reassign code/createdBy/_id/__v.
    const { code: _pc, createdBy: _pcb, _id: _pid, __v: _pv, ...editablePanel } = req.body || {};
    const row = await CustomPanel.findOneAndUpdate(
      { code },
      { $set: { ...editablePanel, updatedBy: req.user?.fullName || "" } },
      { new: true, runValidators: true },
    );
    if (!row) return res.status(404).json({ success: false, message: "Custom panel not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.panelDelete = async (req, res) => {
  try {
    const code = String(req.params.code || "").toUpperCase().trim();
    if (PANELS[code]) {
      return res.status(409).json({ success: false, message: `'${code}' is built-in — cannot delete` });
    }
    const row = await CustomPanel.findOneAndUpdate({ code }, { $set: { active: false } }, { new: true });
    if (!row) return res.status(404).json({ success: false, message: "Custom panel not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

// Returned by GET /api/lab-records/panels — merges built-in + custom.
exports.panelsMerged = async (_req, res) => {
  try {
    const customs = await CustomPanel.find({ active: true }).lean();
    const out = { ...PANELS };
    for (const c of customs) {
      out[c.code] = { label: c.label, tests: c.tests, _custom: true };
    }
    res.json({ success: true, data: out });
  } catch (e) { sendErr(res, e); }
};
