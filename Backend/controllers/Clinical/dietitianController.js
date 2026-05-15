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
    // 1. Active IPD admissions
    try {
      const Admission = require("../../models/Admission/admissionModel");
      const active = await Admission.find({ status: { $in: ["Active", "Admitted", "active", "admitted"] } })
        .sort({ admissionDate: -1 }).limit(200)
        .select("UHID patientName admissionDate roomNumber bedNumber wardName doctor ipdNumber")
        .lean();
      for (const a of active) {
        out.push({
          source: "IPD",
          UHID: a.UHID,
          patientName: a.patientName,
          admissionId: a._id,
          ipdNumber: a.ipdNumber,
          room: a.roomNumber, bed: a.bedNumber, ward: a.wardName,
          admittedAt: a.admissionDate,
          referredBy: a.doctor?.personalInfo?.fullName || a.doctor || "",
        });
      }
    } catch (e) { /* admission model not available, skip */ }

    // 2. OPD visits with "diet" / "dietary" / "nutrition" keyword in chief complaint
    try {
      const OPDVisit = require("../../models/Patient/OPDVisitModel");
      const today = new Date(); today.setHours(0,0,0,0);
      const opds = await OPDVisit.find({
        visitDate: { $gte: today },
        $or: [
          { chiefComplaint: /diet|nutrition|dietary/i },
          { reasonForVisit: /diet|nutrition|dietary/i },
        ],
      }).sort({ visitDate: -1 }).limit(100)
        .select("UHID patientName visitDate visitNumber chiefComplaint doctor")
        .lean();
      for (const v of opds) {
        out.push({
          source: "OPD",
          UHID: v.UHID,
          patientName: v.patientName,
          visitId: v._id,
          visitNumber: v.visitNumber,
          admittedAt: v.visitDate,
          chiefComplaint: v.chiefComplaint,
          referredBy: v.doctor?.personalInfo?.fullName || "",
        });
      }
    } catch (e) { /* OPD model not available, skip */ }

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

exports.createPlan = async (req, res) => {
  try {
    const body = req.body || {};

    // If a template was selected, snapshot its meals into plan.meals so the
    // assignment is immutable even if the template is later edited.
    if (body.plan?.templateId) {
      const tmpl = await DietPlanTemplate.findById(body.plan.templateId).lean();
      if (tmpl) {
        body.plan.templateCode = tmpl.code;
        body.plan.templateName = tmpl.name;
        body.plan.meals        = body.plan.meals?.length ? body.plan.meals : tmpl.meals;
        body.plan.instructions = body.plan.instructions?.length ? body.plan.instructions : tmpl.generalInstructions;
        body.plan.targetCalories = body.plan.targetCalories ?? tmpl.calories;
        body.plan.targetProtein  = body.plan.targetProtein  ?? tmpl.protein;
      }
    }

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
    const p = await PatientDietPlan.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedBy: req.user?.id },
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
