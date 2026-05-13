// controllers/Clinical/dischargeSummaryController.js
const DischargeSummary = require("../../models/Clinical/DischargeSummaryModel");
const Admission = require("../../models/Patient/admissionModel");

const handle = (fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (err) {
    const status = err.statusCode || (err.message?.includes("not found") ? 404 : 400);
    return res.status(status).json({ success: false, message: err.message });
  }
};

class DischargeSummaryController {
  // POST /api/discharge-summary
  create = handle(async (req, res) => {
    const data = req.body;

    // Compute days admitted
    if (data.admissionDate && data.dischargeDate) {
      const diff = new Date(data.dischargeDate) - new Date(data.admissionDate);
      data.totalDaysAdmitted = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    const summary = await DischargeSummary.create(data);
    return res.status(201).json({ success: true, data: summary });
  });

  // GET /api/discharge-summary/uhid/:uhid
  getByUHID = handle(async (req, res) => {
    const summaries = await DischargeSummary.find({ UHID: req.params.uhid })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: summaries, count: summaries.length });
  });

  // GET /api/discharge-summary/admission/:admissionId
  getByAdmission = handle(async (req, res) => {
    const summary = await DischargeSummary.findOne({
      admissionId: req.params.admissionId,
    }).lean();
    if (!summary) return res.status(404).json({ success: false, message: "Discharge summary not found" });
    return res.json({ success: true, data: summary });
  });

  // GET /api/discharge-summary/:id
  getById = handle(async (req, res) => {
    const summary = await DischargeSummary.findById(req.params.id).lean();
    if (!summary) return res.status(404).json({ success: false, message: "Discharge summary not found" });
    return res.json({ success: true, data: summary });
  });

  // PUT /api/discharge-summary/:id
  update = handle(async (req, res) => {
    const data = req.body;
    if (data.admissionDate && data.dischargeDate) {
      const diff = new Date(data.dischargeDate) - new Date(data.admissionDate);
      data.totalDaysAdmitted = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }
    const summary = await DischargeSummary.findByIdAndUpdate(
      req.params.id,
      data,
      { new: true, runValidators: true }
    );
    if (!summary) return res.status(404).json({ success: false, message: "Discharge summary not found" });
    return res.json({ success: true, data: summary });
  });

  // PATCH /api/discharge-summary/:id/finalize
  finalize = handle(async (req, res) => {
    const { finalizedByName } = req.body;
    const summary = await DischargeSummary.findByIdAndUpdate(
      req.params.id,
      {
        status: "finalized",
        finalizedByName: finalizedByName || "Doctor",
        finalizedAt: new Date(),
      },
      { new: true }
    );
    if (!summary) return res.status(404).json({ success: false, message: "Discharge summary not found" });

    // Also update the admission record status AND release the bed.
    // Audit-Pass-17 found the bed was never released on finalize — the bed
    // stayed Occupied forever, blocking new admissions. Now we free it
    // atomically (Available + clear patient + clear currentAdmission).
    if (summary.admissionId) {
      const admission = await Admission.findByIdAndUpdate(
        summary.admissionId,
        {
          status: "Discharged",
          actualDischargeDate: summary.dischargeDate || new Date(),
          conditionOnDischarge: summary.conditionOnDischarge,
          dischargeSummary: summary._id.toString(),
          followUpInstructions: summary.followUpInstructions,
        },
        { new: true },
      );
      if (admission?.bedId) {
        try {
          const Bed = require("../../models/bedMgmt/bedsModel");
          await Bed.findByIdAndUpdate(admission.bedId, {
            $set: {
              status: "Available",
              patient: null,
              currentAdmission: null,
              lastDischargedAt: new Date(),
            },
          });
        } catch (e) { /* non-fatal — surface in admin alerts */ }
      }
    }

    return res.json({ success: true, data: summary, message: "Discharge summary finalized" });
  });

  // DELETE /api/discharge-summary/:id
  delete = handle(async (req, res) => {
    const summary = await DischargeSummary.findById(req.params.id);
    if (!summary) return res.status(404).json({ success: false, message: "Discharge summary not found" });
    if (summary.status === "finalized") {
      return res.status(400).json({ success: false, message: "Cannot delete a finalized discharge summary" });
    }
    await summary.deleteOne();
    return res.json({ success: true, message: "Discharge summary deleted" });
  });

  // GET /api/discharge-summary — all with optional filters
  getAll = handle(async (req, res) => {
    const { status, department, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (department) filter.department = department;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [data, total] = await Promise.all([
      DischargeSummary.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      DischargeSummary.countDocuments(filter),
    ]);
    return res.json({ success: true, data, total, page: parseInt(page) });
  });
}

module.exports = new DischargeSummaryController();
