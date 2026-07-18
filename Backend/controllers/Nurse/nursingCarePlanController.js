// controllers/Nurse/nursingCarePlanController.js
const NursingCarePlan = require("../../models/Nurse/NursingCarePlanModel");

const handle = (fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (err) {
    const status = err.statusCode || (err.message?.includes("not found") ? 404 : 400);
    return res.status(status).json({ success: false, message: err.message });
  }
};

class NursingCarePlanController {
  // POST /api/nursing-care-plans
  create = handle(async (req, res) => {
    // R9-FIX(R9-087): a fresh care plan must not be born signed/completed.
    // create(req.body) let any nurse forge signedBy/signedAt/status:"completed"
    // and attribute a locked NABH COP.1 plan to another nurse. Strip the
    // attestation/lifecycle fields; a new plan is always the ACTIVE default,
    // unsigned, and created by the authenticated actor.
    const body = { ...(req.body || {}) };
    delete body.signedBy;
    delete body.signedAt;
    delete body.status;
    delete body.completedAt;
    delete body.updatedBy;
    body.createdBy = req.user?.id || req.user?._id || null;

    // BUG-3 fix: make the required-field contract consistent with sibling
    // nursing endpoints. /nurse-notes and /nursing-assessments accept
    // {UHID, admissionId} and resolve the rest server-side, but the care-plan
    // model requires patient(ObjectId) + ipdNo too — so a client sending the
    // common {UHID, admissionId} shape hit a 400. Resolve ipdNo + patient (+
    // UHID/patientName) from the admission when only admissionId was supplied.
    if (body.admissionId && (!body.ipdNo || !body.patient)) {
      try {
        const Admission = require("../../models/Patient/admissionModel");
        const adm = await Admission.findById(body.admissionId)
          .select("admissionNumber ipdNo patientId UHID patientName").lean();
        if (adm) {
          if (!body.ipdNo)       body.ipdNo       = adm.admissionNumber || adm.ipdNo || "";
          if (!body.patient)     body.patient     = adm.patientId || undefined;
          if (!body.UHID)        body.UHID        = adm.UHID;
          if (!body.patientName) body.patientName = adm.patientName;
        }
      } catch (_) { /* fall through — model validation will surface a clear error */ }
    }

    const plan = await NursingCarePlan.create(body);
    return res.status(201).json({ success: true, data: plan });
  });

  // GET /api/nursing-care-plans/uhid/:uhid
  getByUHID = handle(async (req, res) => {
    const plans = await NursingCarePlan.find({ UHID: req.params.uhid })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: plans, count: plans.length });
  });

  // GET /api/nursing-care-plans/ipd/:ipdNo
  getByIPD = handle(async (req, res) => {
    const plan = await NursingCarePlan.findOne({ ipdNo: req.params.ipdNo, status: "ACTIVE" })
      .lean();
    return res.json({ success: true, data: plan });
  });

  // GET /api/nursing-care-plans/admission/:admissionId
  getByAdmission = handle(async (req, res) => {
    const plan = await NursingCarePlan.findOne({ admissionId: req.params.admissionId })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: plan });
  });

  // GET /api/nursing-care-plans/:id
  getById = handle(async (req, res) => {
    const plan = await NursingCarePlan.findById(req.params.id).lean();
    if (!plan) return res.status(404).json({ success: false, message: "Nursing care plan not found" });
    return res.json({ success: true, data: plan });
  });

  // PUT /api/nursing-care-plans/:id
  // R7az-D2-HIGH-3: refuse PUT on a completed plan (NABH COP.1). The
  // amendment workflow is a separate path that flips status to
  // "amended" explicitly; a stock PUT must not silently overwrite a
  // signed care plan.
  update = handle(async (req, res) => {
    const plan = await NursingCarePlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: "Nursing care plan not found" });
    if (plan.status === "completed" || plan.status === "COMPLETED") {
      return res.status(409).json({
        success: false,
        code: "CARE_PLAN_LOCKED",
        message: "Nursing care plan is completed — use the amendment endpoint to change it (NABH COP.1)",
      });
    }
    const body = { ...(req.body || {}) };
    // Don't let callers backdoor signedBy / signedAt via PUT.
    delete body.signedBy;
    delete body.signedAt;
    for (const [k, v] of Object.entries(body)) plan.set(k, v);
    plan.updatedBy = req.user?.id || req.user?._id || plan.updatedBy;
    await plan.save();
    return res.json({ success: true, data: plan });
  });

  // PATCH /api/nursing-care-plans/:id/problem/:problemId/status
  updateProblemStatus = handle(async (req, res) => {
    const { status, evaluation } = req.body;
    // R9-FIX(R9-060): findOneAndUpdate bypasses the model's completed-lock
    // pre-save hook, so a completed (signed) care plan's problems could still
    // be mutated. Gate it the same way PUT is gated.
    const locked = await NursingCarePlan.findById(req.params.id).select("status").lean();
    if (!locked) return res.status(404).json({ success: false, message: "Plan or problem not found" });
    if (["completed", "COMPLETED"].includes(locked.status)) {
      return res.status(409).json({ success: false, code: "CARE_PLAN_LOCKED", message: "Nursing care plan is completed — problems are locked (NABH COP.1)." });
    }
    const plan = await NursingCarePlan.findOneAndUpdate(
      { _id: req.params.id, "nursingProblems._id": req.params.problemId },
      {
        $set: {
          "nursingProblems.$.status": status,
          "nursingProblems.$.evaluation": evaluation || "",
          ...(status === "RESOLVED" && { "nursingProblems.$.resolvedAt": new Date() }),
        },
      },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, message: "Plan or problem not found" });
    return res.json({ success: true, data: plan });
  });

  // PATCH /api/nursing-care-plans/:id/complete
  complete = handle(async (req, res) => {
    const plan = await NursingCarePlan.findByIdAndUpdate(
      req.params.id,
      { status: "COMPLETED", completedAt: new Date() },
      { new: true }
    );
    if (!plan) return res.status(404).json({ success: false, message: "Nursing care plan not found" });
    return res.json({ success: true, data: plan, message: "Care plan completed" });
  });

  // DELETE /api/nursing-care-plans/:id
  delete = handle(async (req, res) => {
    // R9-FIX(R9-060): a completed (signed) care plan is a locked NABH COP.1
    // record. findByIdAndDelete previously destroyed it with no lock check —
    // the third bypass of the completed-lock alongside PUT and problem-status.
    const existing = await NursingCarePlan.findById(req.params.id).select("status").lean();
    if (!existing) return res.status(404).json({ success: false, message: "Nursing care plan not found" });
    if (["completed", "COMPLETED"].includes(existing.status)) {
      return res.status(409).json({ success: false, code: "CARE_PLAN_LOCKED", message: "A completed nursing care plan cannot be deleted (NABH COP.1)." });
    }
    await NursingCarePlan.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: "Nursing care plan deleted" });
  });
}

module.exports = new NursingCarePlanController();
