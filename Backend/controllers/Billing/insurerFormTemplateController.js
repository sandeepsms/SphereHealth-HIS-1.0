// controllers/Billing/insurerFormTemplateController.js
// R7hr(CLAIM-P4.3) — manage the hospital's uploaded official insurer claim
// PDFs + their field-maps. insurerFormService overlays claim data onto the
// active template for an insurer; if none exists it generates the standard form.

const { PDFDocument } = require("pdf-lib");
const InsurerFormTemplate = require("../../models/Billing/insurerFormTemplateModel");
const { getInsurer } = require("../../config/insurers");

// The system value keys that can be mapped onto a form (mirror the keys of
// insurerFormService.claimFieldValues — the overlay engine resolves these).
const MAPPABLE_FIELDS = [
  { field: "insurerName", label: "Insurer Name" },
  { field: "policyNumber", label: "Policy Number" },
  { field: "policyHolderName", label: "Policy Holder Name" },
  { field: "tpaName", label: "TPA Name" },
  { field: "sumInsured", label: "Sum Insured" },
  { field: "patientName", label: "Patient Name" },
  { field: "uhid", label: "UHID" },
  { field: "age", label: "Age" },
  { field: "gender", label: "Gender" },
  { field: "address", label: "Address" },
  { field: "phone", label: "Contact No." },
  { field: "hospitalName", label: "Hospital Name" },
  { field: "rohiniId", label: "ROHINI ID" },
  { field: "gstin", label: "Hospital GSTIN" },
  { field: "pan", label: "Hospital PAN" },
  { field: "ipNo", label: "IPD / Admission No." },
  { field: "admissionDate", label: "Admission Date" },
  { field: "dischargeDate", label: "Discharge Date" },
  { field: "roomCategory", label: "Room Category" },
  { field: "consultant", label: "Treating Consultant" },
  { field: "diagnosis", label: "Diagnosis" },
  { field: "icdCode", label: "ICD-10 Code" },
  { field: "grossAmount", label: "Gross Amount" },
  { field: "discount", label: "Discount" },
  { field: "tax", label: "Tax (GST)" },
  { field: "netAmount", label: "Net Amount" },
  { field: "tpaPayable", label: "Insurer / TPA Payable" },
  { field: "patientPayable", label: "Patient Share / Co-pay" },
  { field: "preAuthNumber", label: "Pre-Auth / Approval No." },
  { field: "approvedAmount", label: "Approved Amount" },
];

// keyword → system field, to pre-suggest a map from an AcroForm's field names.
const HINTS = [
  { field: "policyNumber", kw: ["policy no", "policyno", "policy number", "policynumber", "policy"] },
  { field: "policyHolderName", kw: ["policy holder", "policyholder", "proposer", "primary insured", "insured name", "name of insured"] },
  { field: "patientName", kw: ["patient name", "name of patient", "patient", "claimant name"] },
  { field: "tpaName", kw: ["tpa", "third party"] },
  { field: "sumInsured", kw: ["sum insured", "suminsured", "sum assured"] },
  { field: "uhid", kw: ["uhid", "mrn", "hospital id", "reg no", "registration"] },
  { field: "age", kw: ["age"] },
  { field: "gender", kw: ["gender", "sex"] },
  { field: "address", kw: ["address"] },
  { field: "phone", kw: ["mobile", "phone", "contact", "cell"] },
  { field: "hospitalName", kw: ["hospital name", "name of hospital", "hospital"] },
  { field: "rohiniId", kw: ["rohini"] },
  { field: "gstin", kw: ["gstin", "gst"] },
  { field: "pan", kw: ["pan"] },
  { field: "ipNo", kw: ["ipd", "ip no", "ipno", "admission no", "ip number"] },
  { field: "admissionDate", kw: ["admission date", "date of admission", "doa", "admitted on"] },
  { field: "dischargeDate", kw: ["discharge date", "date of discharge", "dod", "discharged on"] },
  { field: "roomCategory", kw: ["room", "ward", "bed category", "accommodation"] },
  { field: "consultant", kw: ["consultant", "treating doctor", "doctor name", "physician"] },
  { field: "icdCode", kw: ["icd"] },
  { field: "diagnosis", kw: ["diagnosis", "disease", "ailment", "nature of illness"] },
  { field: "grossAmount", kw: ["gross", "total bill", "total amount"] },
  { field: "discount", kw: ["discount"] },
  { field: "tax", kw: ["gst", "tax"] },
  { field: "netAmount", kw: ["net amount", "net payable", "amount claimed", "claimed amount", "total claim"] },
  { field: "tpaPayable", kw: ["insurer payable", "tpa payable", "approved by insurer"] },
  { field: "patientPayable", kw: ["patient share", "co-pay", "copay", "non payable", "deduction"] },
  { field: "preAuthNumber", kw: ["pre-auth", "preauth", "authorization", "authorisation", "approval no", "ccn"] },
  { field: "approvedAmount", kw: ["approved amount", "sanctioned"] },
];

function suggestMap(acroFields = []) {
  return acroFields.map((name) => {
    const low = String(name).toLowerCase();
    const hit = HINTS.find((h) => h.kw.some((k) => low.includes(k)));
    return { field: hit ? hit.field : "", acroName: name };
  }).filter((m) => m.field);   // only pre-fill the confident ones
}

// GET /api/insurer-forms/mappable-fields
exports.getMappableFields = (req, res) => res.json({ success: true, data: MAPPABLE_FIELDS });

// GET /api/insurer-forms  → all active templates (meta only, no blob)
exports.listTemplates = async (req, res) => {
  try {
    const docs = await InsurerFormTemplate.find({ isActive: true })
      .select("-pdf").sort({ insurerCode: 1, formType: 1 }).lean();
    res.json({ success: true, data: docs });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// GET /api/insurer-forms/:code  → active template meta for one insurer
exports.getTemplate = async (req, res) => {
  try {
    const doc = await InsurerFormTemplate.findOne({
      insurerCode: req.params.code.toUpperCase(), formType: req.query.formType || "CLAIM", isActive: true,
    }).select("-pdf").sort({ version: -1 }).lean();
    res.json({ success: true, data: doc || null });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// GET /api/insurer-forms/:code/blank  → stream the stored blank PDF (preview)
exports.downloadBlank = async (req, res) => {
  try {
    const doc = await InsurerFormTemplate.findOne({
      insurerCode: req.params.code.toUpperCase(), formType: req.query.formType || "CLAIM", isActive: true,
    }).sort({ version: -1 }).lean();
    if (!doc || !doc.pdf) return res.status(404).json({ success: false, message: "No template on file" });
    const buf = doc.pdf.buffer || doc.pdf;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${doc.fileName || "blank.pdf"}"`);
    res.send(Buffer.from(buf));
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// POST /api/insurer-forms/:code/template  (multipart: pdf) — upload a blank
// official form. Detects AcroForm fields, pre-suggests a map, bumps version.
exports.uploadTemplate = async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const insurer = getInsurer(code);
    if (insurer.code === "OTHER" && code !== "OTHER") {
      return res.status(400).json({ success: false, message: `Unknown insurer code: ${code}` });
    }
    if (!req.file || !req.file.buffer) return res.status(400).json({ success: false, message: "PDF file required (field 'pdf')" });
    const mt = (req.file.mimetype || "").toLowerCase();
    if (mt !== "application/pdf" && !(req.file.originalname || "").toLowerCase().endsWith(".pdf")) {
      return res.status(400).json({ success: false, message: "Only PDF files are accepted" });
    }
    const formType = (req.body.formType || "CLAIM").toUpperCase();

    // Introspect the PDF: page count + AcroForm field names (if fillable).
    let pageCount = 0, acroFields = [];
    try {
      const pdf = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
      pageCount = pdf.getPageCount();
      try { acroFields = pdf.getForm().getFields().map((f) => f.getName()); } catch { acroFields = []; }
    } catch (e) {
      return res.status(400).json({ success: false, message: `Not a readable PDF: ${e.message}` });
    }

    // Provided field-map wins; else pre-suggest from AcroForm names.
    let fieldMap = [];
    if (req.body.fieldMap) {
      try { fieldMap = JSON.parse(req.body.fieldMap); } catch { fieldMap = []; }
    }
    if (!fieldMap.length && acroFields.length) fieldMap = suggestMap(acroFields);

    // Version bump: deactivate the current active, add a new active version.
    const prev = await InsurerFormTemplate.findOne({ insurerCode: code, formType, isActive: true }).sort({ version: -1 });
    const version = prev ? prev.version + 1 : 1;
    if (prev) { prev.isActive = false; await prev.save(); }

    const doc = await InsurerFormTemplate.create({
      insurerCode: code, insurerName: insurer.name, formType,
      fileName: req.file.originalname, mimeType: "application/pdf", pdf: req.file.buffer,
      pageCount, hasAcroForm: acroFields.length > 0, acroFields, fieldMap,
      version, isActive: true,
      uploadedBy: req.user?._id, uploadedByName: req.user?.fullName || req.user?.name,
      notes: req.body.notes,
    });
    const out = doc.toObject(); delete out.pdf;
    res.status(201).json({ success: true, data: out, suggestedFrom: acroFields.length ? "acroform" : "none" });
  } catch (e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
};

// PUT /api/insurer-forms/:id/field-map  → replace the field-map
exports.updateFieldMap = async (req, res) => {
  try {
    const fieldMap = Array.isArray(req.body.fieldMap) ? req.body.fieldMap : [];
    const doc = await InsurerFormTemplate.findByIdAndUpdate(
      req.params.id, { $set: { fieldMap } }, { new: true }
    ).select("-pdf");
    if (!doc) return res.status(404).json({ success: false, message: "Template not found" });
    res.json({ success: true, data: doc });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// DELETE /api/insurer-forms/:id  → deactivate (keeps history)
exports.deleteTemplate = async (req, res) => {
  try {
    const doc = await InsurerFormTemplate.findByIdAndUpdate(
      req.params.id, { $set: { isActive: false } }, { new: true }
    ).select("-pdf");
    if (!doc) return res.status(404).json({ success: false, message: "Template not found" });
    res.json({ success: true, data: doc });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
