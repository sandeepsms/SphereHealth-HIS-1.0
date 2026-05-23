/**
 * dietitianController.js — Dietician workspace API.
 *
 * R7bj-F4 hardening:
 *   • DT-CRIT-1 mass-assignment: createPlan / updatePlan / *Template no
 *     longer spread req.body into the model. Explicit allow-lists keep an
 *     attacker from forging assignedBy / assessment.assessedBy / UHID on
 *     an existing plan to attach an allergy profile to another patient.
 *   • patientPlans IDOR: route already gates on diet.read; controller now
 *     additionally restricts to the clinical access set (Admin/Doctor/
 *     Nurse/Dietician/MRD). Doctor reads are not narrowed because
 *     attending physicians need full visibility across their patients.
 *   • Every response moved to apiEnvelope.sendOk / sendErr.
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
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

/* ── Allow-listed sub-schemas ───────────────────────────────── */

// Schema fields the dietitian is allowed to set on an assessment via
// create / update. `assessedBy` and `assessedAt` are SERVER-STAMPED.
const ASSESSMENT_KEYS = [
  "height", "weight", "bmi", "idealWeight", "waist", "hip",
  "bp", "bloodSugarFasting", "bloodSugarPP", "hba1c", "hemoglobin",
  "cholesterol", "triglycerides", "creatinine", "urea",
  "potassium", "sodium", "albumin",
  "conditions", "allergies", "allergens", "medications",
  "foodPreference", "religiousRestrictions", "dietaryHabits",
  "appetite", "bowelHabits", "fluidIntake", "swallowing",
  "alcohol", "smoking", "physicalActivity", "recentWeightChange",
  "notes",
];

// Fields the dietitian may set inside the plan sub-doc.
const PLAN_KEYS = [
  "templateId", "templateCode", "templateName",
  "meals", "customisations",
  "targetCalories", "targetProtein", "fluidRestriction", "saltRestriction",
  "notes", "instructions",
];

function pickAllowed(src, keys) {
  if (!src || typeof src !== "object") return {};
  const out = {};
  for (const k of keys) if (k in src) out[k] = src[k];
  return out;
}

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
    return sendOk(res, rows, { count: rows.length });
  } catch (e) { return sendErr(res, e); }
};

exports.getTemplate = async (req, res) => {
  try {
    const t = await DietPlanTemplate.findById(req.params.id).lean();
    if (!t) return sendErr(res, "Template not found", "NOT_FOUND", 404);
    return sendOk(res, t);
  } catch (e) { return sendErr(res, e); }
};

const TEMPLATE_KEYS = [
  "name", "code", "category", "active",
  "calories", "protein", "fat", "carbs", "fluid", "salt",
  "indications", "contraindications", "generalInstructions",
  "meals",
  "religious", "vegetarian",
];

exports.createTemplate = async (req, res) => {
  try {
    const payload = {
      ...pickAllowed(req.body, TEMPLATE_KEYS),
      createdBy: req.user?.id,
      updatedBy: req.user?.id,
    };
    const t = await DietPlanTemplate.create(payload);
    return sendOk(res, t, null, 201);
  } catch (e) {
    if (e.code === 11000) return sendErr(res, "Template code already exists", "DUPLICATE", 409);
    return sendErr(res, e, null, 400);
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const $set = { ...pickAllowed(req.body, TEMPLATE_KEYS), updatedBy: req.user?.id };
    const t = await DietPlanTemplate.findByIdAndUpdate(
      req.params.id,
      $set,
      { new: true, runValidators: true }
    ).lean();
    if (!t) return sendErr(res, "Template not found", "NOT_FOUND", 404);
    return sendOk(res, t);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.deleteTemplate = async (req, res) => {
  try {
    // Soft delete — set active=false so historical plans keep their snapshot reference.
    const t = await DietPlanTemplate.findByIdAndUpdate(
      req.params.id,
      { active: false, updatedBy: req.user?.id },
      { new: true }
    ).lean();
    if (!t) return sendErr(res, "Template not found", "NOT_FOUND", 404);
    return sendOk(res, t);
  } catch (e) { return sendErr(res, e, null, 400); }
};

/* ── REFERRED PATIENTS ──────────────────────────────────────
   See header comment in the previous revision. */
exports.referredPatients = async (req, res) => {
  try {
    const out = [];
    try {
      const Admission = require("../../models/Patient/admissionModel");
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

    // 3. Map "has existing plan?" flag
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

    return sendOk(res, out, { count: out.length });
  } catch (e) { return sendErr(res, e); }
};

/* ── PER-PATIENT PLANS ─────────────────────────────────────────
   R7bj-F4 DT-CRIT-1 / IDOR: explicit clinical-access role gate. The
   diet.read permission is broad (Admin/Doctor/Nurse/Dietician/MRD); we
   restate the set here so a route-table edit can't silently widen the
   surface. Dietician scope-narrowing to assigned-admissions is a
   feature-toggle for a future iteration — current MVP doesn't store
   `assignedDietitianId` on the Admission, so any Dietician on duty can
   read any patient's plans. */
const PATIENT_PLAN_READ_ROLES = ["Admin", "Doctor", "Nurse", "Dietician", "MRD"];

exports.patientPlans = async (req, res) => {
  try {
    const role = req.user?.role || "";
    if (!PATIENT_PLAN_READ_ROLES.includes(role)) {
      return sendErr(res, "Insufficient clinical role for diet-plan read", "FORBIDDEN", 403);
    }
    const uhid = String(req.params.uhid || "").trim().toUpperCase();
    if (!uhid) return sendErr(res, "uhid required", "VALIDATION", 400);

    const plans = await PatientDietPlan.find({ UHID: uhid })
      .sort({ createdAt: -1 }).limit(50).lean();
    return sendOk(res, plans, { count: plans.length });
  } catch (e) { return sendErr(res, e); }
};

// R7bm-F10 / R7bl-10 CRIT-1 IDOR: `getPlan` previously returned any plan
// by :id with NO ownership / scope check. A Dietician (or any clinical
// role holding diet.read) could enumerate plan _id's and pull plans for
// patients outside their care, including allergen profiles and condition
// lists — a PHI-grade IDOR per HIPAA §164.502.
//
// Fix: gate read by role + scope:
//   • Admin / MRD / Auditor / Nurse  → full read (compliance + chart access)
//   • Doctor                         → only plans whose patient is on the
//                                      doctor's admission roster (attendingDoctor
//                                      ID match, or admissionId points to one of
//                                      their active admissions)
//   • Dietician                      → only plans they assigned themselves
//                                      (assignedBy / assessment.assessedBy ===
//                                      req.user._id), OR plans for patients on
//                                      an Admission whose dietitian assignment
//                                      ties to them (MVP: assignedBy only —
//                                      Admission has no `assignedDietitianId`
//                                      column yet, future iteration)
//   • Other roles                    → 403 FORBIDDEN_DIET_PLAN
const PLAN_READ_FULL = ["Admin", "MRD", "Auditor", "Nurse"];

exports.getPlan = async (req, res) => {
  try {
    const role = req.user?.role || "";
    const uid  = String(req.user?.id || req.user?._id || "");
    if (!uid) {
      return sendErr(res, "Authentication required", "FORBIDDEN_DIET_PLAN", 403);
    }

    const p = await PatientDietPlan.findById(req.params.id).lean();
    if (!p) return sendErr(res, "Plan not found", "NOT_FOUND", 404);

    // Full-read roles bypass scope check.
    if (PLAN_READ_FULL.includes(role)) return sendOk(res, p);

    // Dietician: only their own plans.
    if (role === "Dietician") {
      const ownAssigned = String(p.assignedBy || "") === uid;
      const ownAssessed = String(p.assessment?.assessedBy || "") === uid;
      if (ownAssigned || ownAssessed) return sendOk(res, p);
      return sendErr(
        res,
        "You may only read diet plans you assigned",
        "FORBIDDEN_DIET_PLAN",
        403,
      );
    }

    // Doctor: must be the attending of the patient's admission. We resolve
    // via Admission -> attendingDoctorId match against the Doctor profile
    // linked to req.user.id (same convention as mlcController and the
    // restrictToOwnDoctorPatients helper). The dietitian route stack does not
    // run `attachDoctorProfile`, so we look up the Doctor doc inline.
    if (role === "Doctor") {
      let docId = String(req.doctorProfile?._id || "");
      if (!docId) {
        try {
          const Doctor = require("../../models/Doctor/doctorModel");
          const docRow = await Doctor.findOne({ loginUserId: req.user.id })
            .select("_id").lean();
          if (docRow?._id) docId = String(docRow._id);
        } catch (e) { /* fall through to 403 */ }
      }
      if (!docId) {
        // Doctor with no linked profile — can't scope, deny.
        return sendErr(
          res,
          "Doctor profile not linked to login — cannot scope diet-plan read",
          "FORBIDDEN_DIET_PLAN",
          403,
        );
      }
      try {
        const Admission = require("../../models/Patient/admissionModel");
        // Prefer the plan's admissionId. If absent (OPD diet-plan), fall back
        // to any Active admission for this UHID where the doctor is attending.
        const q = p.admissionId
          ? { _id: p.admissionId }
          : { UHID: p.UHID, status: "Active", attendingDoctorId: docId };
        const adm = await Admission.findOne(q).select("attendingDoctorId attendingDoctorUserId").lean();
        if (adm) {
          const isAttending =
            String(adm.attendingDoctorId || "") === docId ||
            String(adm.attendingDoctorUserId || "") === uid;
          if (isAttending) return sendOk(res, p);
        }
      } catch (e) {
        // If Admission lookup fails, fall through to 403 — safer than leaking.
        console.error("getPlan Admission scope-check error:", e.message);
      }
      return sendErr(
        res,
        "You may only read diet plans for patients on your roster",
        "FORBIDDEN_DIET_PLAN",
        403,
      );
    }

    // All other roles (including unknown / stub roles): deny.
    return sendErr(
      res,
      "Insufficient role for diet-plan read",
      "FORBIDDEN_DIET_PLAN",
      403,
    );
  } catch (e) { return sendErr(res, e); }
};

// Re-snapshot the template fields into a plan body whenever the body
// has a templateId. Used by BOTH create and update so the snapshot stays
// attached to the plan even when the UI sends back only its editable
// fields.
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
    const b = req.body || {};
    const {
      UHID, patientName, patientId, admissionId, visitType,
      startDate, endDate, followUpAt, followUpNotes, status,
    } = b;
    if (!UHID || !String(UHID).trim()) {
      return sendErr(res, "UHID required", "VALIDATION", 400);
    }

    const assessment = pickAllowed(b.assessment, ASSESSMENT_KEYS);
    // R7bj-F4 DT-CRIT-1: server stamps assessedBy + assessedAt — never
    // taken from req.body. Pre-fix an attacker could attribute their
    // assessment to another dietitian.
    assessment.assessedBy = req.user?.id;
    assessment.assessedAt = new Date();

    const plan = pickAllowed(b.plan, PLAN_KEYS);
    await snapshotTemplateInto(plan);

    const doc = {
      UHID:         String(UHID).toUpperCase().trim(),
      patientName:  patientName || "",
      patientId:    patientId || undefined,
      admissionId:  admissionId || undefined,
      visitType:    ["IPD","OPD","ER","DC"].includes(visitType) ? visitType : "IPD",
      assessment,
      plan,
      status:       ["draft","active","completed","cancelled"].includes(status) ? status : "draft",
      startDate:    startDate ? new Date(startDate) : new Date(),
      endDate:      endDate ? new Date(endDate) : null,
      followUpAt:   followUpAt ? new Date(followUpAt) : null,
      followUpNotes: typeof followUpNotes === "string" ? followUpNotes : "",
      // Server-stamped audit trio.
      assignedBy:   req.user?.id,
      assignedAt:   new Date(),
    };
    const p = await PatientDietPlan.create(doc);
    return sendOk(res, p, null, 201);
  } catch (e) { return sendErr(res, e, null, 400); }
};

exports.updatePlan = async (req, res) => {
  try {
    const b = req.body || {};
    const $set = {};

    // R7bj-F4: plan body subset only, never bare spread.
    if (b.plan && typeof b.plan === "object") {
      const planSubset = pickAllowed(b.plan, PLAN_KEYS);
      await snapshotTemplateInto(planSubset);
      $set.plan = planSubset;
    }
    if (b.assessment && typeof b.assessment === "object") {
      // assessment update — keep assessedBy/assessedAt frozen (don't
      // overwrite the original assessor). Only the assessment fields
      // listed in the allow-list mutate.
      const aSubset = pickAllowed(b.assessment, ASSESSMENT_KEYS);
      // Apply via dotted paths so we don't replace the whole sub-doc.
      for (const k of Object.keys(aSubset)) {
        $set[`assessment.${k}`] = aSubset[k];
      }
    }
    // Top-level mutable fields.
    if (typeof b.followUpNotes === "string") $set.followUpNotes = b.followUpNotes;
    if (b.followUpAt)                        $set.followUpAt    = new Date(b.followUpAt);
    if (b.endDate)                           $set.endDate       = new Date(b.endDate);
    if (["draft","active","completed","cancelled"].includes(b.status)) $set.status = b.status;
    $set.updatedBy = req.user?.id;

    const p = await PatientDietPlan.findByIdAndUpdate(
      req.params.id,
      $set,
      { new: true, runValidators: true }
    ).lean();
    if (!p) return sendErr(res, "Plan not found", "NOT_FOUND", 404);
    return sendOk(res, p);
  } catch (e) { return sendErr(res, e, null, 400); }
};

/* ── Kitchen-indent push (F2 owns the service body — we just call it) */
exports.pushKitchenIndent = async (req, res) => {
  try {
    const svc = require("../../services/Dietitian/dietitianService");
    const result = await svc.pushToKitchenIndent(req.params.id, {
      id:       req.user?._id || req.user?.id,
      fullName: req.user?.fullName || req.user?.employeeId || "",
      role:     req.user?.role || "",
    });
    // Service returns a plain object — wrap under data with optional meta.
    const { meta, ...rest } = result || {};
    return sendOk(res, rest, meta, 201);
  } catch (e) {
    return sendErr(res, e, e?.code, e?.status || 400);
  }
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
    return sendOk(res, { activePlans, plansToday, totalTemplates, pendingFollowUps });
  } catch (e) { return sendErr(res, e); }
};
