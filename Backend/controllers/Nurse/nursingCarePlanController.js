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
    const plan = await NursingCarePlan.create(req.body);
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
  update = handle(async (req, res) => {
    const plan = await NursingCarePlan.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!plan) return res.status(404).json({ success: false, message: "Nursing care plan not found" });
    return res.json({ success: true, data: plan });
  });

  // PATCH /api/nursing-care-plans/:id/problem/:problemId/status
  updateProblemStatus = handle(async (req, res) => {
    const { status, evaluation } = req.body;
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
    const plan = await NursingCarePlan.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: "Nursing care plan not found" });
    return res.json({ success: true, message: "Nursing care plan deleted" });
  });
}

module.exports = new NursingCarePlanController();
