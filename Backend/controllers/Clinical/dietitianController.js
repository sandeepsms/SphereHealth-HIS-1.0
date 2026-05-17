/**
 * dietitianController.js — Dietician workspace API.
 *
 * Surface:
 *   Templates
 *     GET    /templates                 list all (filterable by category)
 *     GET    /templates/:id             single
 *     POST   /templates                 create (Admin/Dietician)
 *     PUT    /templates/:id             update
 *     DELETE /templates/:id             soft-delete (active=false)
 *
 *   Referred patients
 *     GET    /patients                  active IPD admissions + OPD visits
 *                                       flagged for diet consult
 *
 *   Per-patient plans
 *     GET    /patient/:uhid/plans       all diet plans for this UHID
 *     GET    /plan/:id                  single
 *     POST   /plan                      create new plan (assessment + assigned plan)
 *     PUT    /plan/:id                  update existing
 *
 *   Stats
 *     GET    /stats                     dashboard KPIs
 */
const { DietPlanTemplate, PatientDietPlan } = require("../../models/Clinical/DietitianModels");

/* ── TEMPLATES ──────────────────────────────────────────────── */
exports.listTemplates = async (req, res) => {
  try {
    const { category, q, active } = req.query;
    const filter = {};
    if (category)            filter.category = category;
    if (active === "true")   filter.active = true;
    if (active === "false")  filter.active = false;
    if (q)                   filter.$text = { $search: q };
    const rows = await DietPlanTemplate.find(filter).sort({ category: 1, name: 1 }).lean();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.getTemplate = async (req, res) => {
  try {
    const t = await DietPlanTemplate.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ success: false, message: "Template not found" });
    res.json({ success: true, data: t });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createTemplate = async (req, res) => {
  try {
    const payload = { ...req.body, createdBy: req.user?.id, updatedBy: req.user?.id };
    const t = await DietPlanTemplate.create(payload);
    res.status(201).json({ success: true, data: t });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ success: false, message: "Template code already exists" });
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const t = await DietPlanTemplate.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedBy: req.user?.id },
      { new: true, runValidators: true }
    ).lean();
    if (!t) return res.status(404).json({ success: false, message: "Template not found" });
    res.json({ success: true, data: t });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.deleteTemplate = async (req, res) => {
  try {
    // Soft delete — set active=false so historical plans keep their snapshot reference.
    const t = await DietPlanTemplate.findByIdAndUpdate(
      req.params.id,
      { active: false, updatedBy: req.user?.id },
      { new: true }
    ).lean();
    if (!t) return res.status(404).json({ success: false, message: "Template not found" });
    res.json({ success: true, data: t });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── REFERRED PATIENTS ──────────────────────────────────────
   For MVP we return all currently-admitted IPD patients (every
   admit is a candidate for nutritional rounds) plus today's OPD
   visits flagged with a "diet" keyword in doctor-notes/orders.
   The Dietician's workflow is to walk through this list and create
   an assessment + plan per patient.

   The endpoint deliberately keeps the heuristics simple so it never
   returns 500 if the optional collections (DoctorOrder, OPDVisit)
   are empty or missing in this deployment. */
exports.referredPatients = async (req, res) => {
  try {
    const out = [];
    // 1. Active IPD admissions — correct path is models/Patient/admissionModel
    //    (NOT models/Admission/...). Earlier silent require failure was the
    //    reason the endpoint always returned [].
    try {
      const Admission = require("../../models/Patient/admissionModel");
      // hasBed: true is what distinguishes a true IPD admission from an
      // OPD / Day-Care / Services stub that also lives in the same
      // collection. Without this filter every OPD visit leaked into the
      // dietician's "Referred IPD patients" board as source="IPD".
      const active = await Admission.find({ status: "Active", hasBed: true })
        .sort({ admissionDate: -1 }).limit(200)
        .select("UHID patientName admissionDate roomNumber bedNumber department attendingDoctor admissionNumber wardId")
        .populate("wardId", "wardName name")
        .lean();
      for (const a of active) {
        out.push({
          source: "IPD",
          UHID: a.UHID,
          patientName: a.patientName,
          admissionId: a._id,
          admissionNumber: a.admissionNumber,
          room: a.roomNumber,
          bed:  a.bedNumber,
          ward: a.wardId?.wardName || a.wardId?.name || "—",
          department: a.department,
          admittedAt: a.admissionDate,
          referredBy: a.attendingDoctor || "",
        });
      }
    } catch (e) { console.error("dietitian referredPatients IPD error:", e.message); }

    // 2. OPD registrations today flagged with diet/nutrition keyword.
    //    Model is OPDRegistration in models/Patient/OPDModels.js.
    try {
      const OPDRegistration = require("../../models/Patient/OPDModels");
      const today = new Date(); today.setHours(0,0,0,0);
      const opds = await OPDRegistration.find({
        visitDate: { $gte: today },
        $or: [
          { chiefComplaint: /diet|nutrition|dietary|weight/i },
          { diagnosis:      /diabet|hypertens|renal|obes|malnut|cardiac/i },
        ],
      }).sort({ visitDate: -1 }).limit(100)
        .select("UHID patientName visitDate visitNumber chiefComplaint diagnosis department attendingDoctor")
        .lean();
      for (const v of opds) {
        out.push({
          source: "OPD",
          UHID: v.UHID,
          patientName: v.patientName,
          visitId: v._id,
          visitNumber: v.visitNumber,
          admittedAt: v.visitDate,
          chiefComplaint: v.chiefComplaint || v.diagnosis || "",
          department: v.department,
          referredBy: v.attendingDoctor || "",
        });
      }
    } catch (e) { console.error("dietitian referredPatients OPD error:", e.message); }

    // 3. Map "has existing plan?" flag — flag patients with active plans
    const uhids = [...new Set(out.map(o => o.UHID))];
    const existing = await PatientDietPlan.find({ UHID: { $in: uhids }, status: { $in: ["draft", "active"] } })
      .select("UHID status plan.templateName")
      .lean();
    const planMap = new Map();
    for (const p of existing) planMap.set(p.UHID, { status: p.status, plan: p.plan?.templateName });
    for (const r of out) {
      const hit = planMap.get(r.UHID);
      r.hasPlan = !!hit;
      r.planStatus = hit?.status || null;
      r.planName = hit?.plan || null;
    }

    res.json({ success: true, count: out.length, data: out });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

/* ── PER-PATIENT PLANS ─────────────────────────────────────── */
exports.patientPlans = async (req, res) => {
  try {
    const plans = await PatientDietPlan.find({ UHID: req.params.uhid })
      .sort({ createdAt: -1 }).limit(50).lean();
    res.json({ success: true, count: plans.length, data: plans });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.getPlan = async (req, res) => {
  try {
    const p = await PatientDietPlan.findById(req.params.id).lean();
    if (!p) return res.status(404).json({ success: false, message: "Plan not found" });
    res.json({ success: true, data: p });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// Re-snapshot the template fields (templateName, templateCode, meals,
// instructions, target macros) into a plan body whenever the body has a
// templateId. Used by BOTH create and update so the snapshot stays attached
// to the plan even when the UI sends back only its editable fields. Earlier
// (before 13 May 2026) update was a raw spread that stripped templateName
// every save — patient files then showed "Custom" for plans that were
// actually built from a template.
async function snapshotTemplateInto(planBody) {
  if (!planBody?.templateId) return;
  const tmpl = await DietPlanTemplate.findById(planBody.templateId).lean();
  if (!tmpl) return;
  planBody.templateCode    = planBody.templateCode    || tmpl.code;
  planBody.templateName    = planBody.templateName    || tmpl.name;
  planBody.meals           = planBody.meals?.length         ? planBody.meals        : tmpl.meals;
  planBody.instructions    = planBody.instructions?.length  ? planBody.instructions : tmpl.generalInstructions;
  planBody.targetCalories  = planBody.targetCalories ?? tmpl.calories;
  planBody.targetProtein   = planBody.targetProtein  ?? tmpl.protein;
}

exports.createPlan = async (req, res) => {
  try {
    const body = req.body || {};
    await snapshotTemplateInto(body.plan);
    body.assignedBy        = req.user?.id;
    body.assessment        = body.assessment || {};
    body.assessment.assessedBy = req.user?.id;
    body.assessment.assessedAt = new Date();

    const p = await PatientDietPlan.create(body);
    res.status(201).json({ success: true, data: p });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

exports.updatePlan = async (req, res) => {
  try {
    const body = req.body || {};
    await snapshotTemplateInto(body.plan);
    const p = await PatientDietPlan.findByIdAndUpdate(
      req.params.id,
      { ...body, updatedBy: req.user?.id },
      { new: true, runValidators: true }
    ).lean();
    if (!p) return res.status(404).json({ success: false, message: "Plan not found" });
    res.json({ success: true, data: p });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
};

/* ── DASHBOARD STATS ───────────────────────────────────────── */
exports.stats = async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const [activePlans, plansToday, totalTemplates, pendingFollowUps] = await Promise.all([
      PatientDietPlan.countDocuments({ status: "active" }),
      PatientDietPlan.countDocuments({ assignedAt: { $gte: today } }),
      DietPlanTemplate.countDocuments({ active: true }),
      PatientDietPlan.countDocuments({ followUpAt: { $lte: new Date() }, status: "active" }),
    ]);
    res.json({
      success: true,
      data: { activePlans, plansToday, totalTemplates, pendingFollowUps },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
