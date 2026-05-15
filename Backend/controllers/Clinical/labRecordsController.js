/**
 * labRecordsController.js — manual lab data entry (trends + narrative
 * reports). Public surface under /api/lab-records.
 *
 *   /panels        — preset test panels (CBC, LFT, etc.) + report types
 *   /trends        list / get / create / update / verify
 *   /reports       list / get / create / update / verify
 */
const { LabTrend, LabReport } = require("../../models/Clinical/labRecordsModels");
const User = require("../../models/User/userModel");

/* JWT only carries { id, role, employeeId } — so look up the user
   record once per write to stamp a readable name on createdByName /
   reportedByName. Falls back to a synthesised name if the DB lookup
   fails for any reason. */
async function resolveUserName(req) {
  // Honour anything the JWT already provided (future-proofing in case
  // we ever expand the JWT payload).
  if (req.user?.fullName) return req.user.fullName;
  const composed = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim();
  if (composed) return composed;
  if (!req.user?.id) return "Unknown";
  try {
    const u = await User.findById(req.user.id).select("fullName firstName lastName").lean();
    if (!u) return "Unknown";
    return u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Unknown";
  } catch { return "Unknown"; }
}

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
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.trendGet = async (req, res) => {
  try {
    const row = await LabTrend.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
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
    body.status        = body.status || "draft";
    const row = await LabTrend.create(body);
    res.status(201).json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.trendUpdate = async (req, res) => {
  try {
    const body = req.body || {};
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
    const row = await LabTrend.findByIdAndUpdate(req.params.id,
      { $set: { status: "verified", verifiedBy: req.user?.id, verifiedAt: new Date() } },
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
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.reportGet = async (req, res) => {
  try {
    const row = await LabReport.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
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
    body.status         = body.status || "reported";
    const row = await LabReport.create(body);
    res.status(201).json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.reportUpdate = async (req, res) => {
  try {
    const row = await LabReport.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.reportVerify = async (req, res) => {
  try {
    const row = await LabReport.findByIdAndUpdate(req.params.id,
      { $set: { status: "verified", verifiedBy: req.user?.id, verifiedAt: new Date() } },
      { new: true }).lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* Expose presets to other modules without re-fetching */
exports._PANELS = PANELS;
exports._REPORT_TYPES = REPORT_TYPES;
exports._classify = classify;
