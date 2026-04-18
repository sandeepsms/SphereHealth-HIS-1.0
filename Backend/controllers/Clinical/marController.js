// controllers/Clinical/marController.js
const MAR = require("../../models/Clinical/MARModel");

const handle = (fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (err) {
    const status = err.statusCode || (err.message?.includes("not found") ? 404 : 400);
    return res.status(status).json({ success: false, message: err.message });
  }
};

class MARController {
  // POST /api/mar — create or get existing MAR for a date
  createOrGet = handle(async (req, res) => {
    const { UHID, ipdNo, date, admissionId, patientName, allergies } = req.body;
    const marDate = new Date(date || new Date().toDateString());

    let mar = await MAR.findOne({ ipdNo, date: marDate });
    if (!mar) {
      mar = await MAR.create({
        UHID,
        ipdNo,
        admissionId,
        patientName,
        date: marDate,
        allergies: allergies || [],
        medications: req.body.medications || [],
      });
    }
    return res.status(201).json({ success: true, data: mar });
  });

  // GET /api/mar/ipd/:ipdNo
  getByIPD = handle(async (req, res) => {
    const mars = await MAR.find({ ipdNo: req.params.ipdNo })
      .sort({ date: -1 })
      .lean();
    return res.json({ success: true, data: mars, count: mars.length });
  });

  // GET /api/mar/ipd/:ipdNo/date/:date — get MAR for a specific date
  getByIPDAndDate = handle(async (req, res) => {
    const marDate = new Date(req.params.date);
    const mar = await MAR.findOne({ ipdNo: req.params.ipdNo, date: marDate }).lean();
    if (!mar) return res.status(404).json({ success: false, message: "MAR not found for this date" });
    return res.json({ success: true, data: mar });
  });

  // GET /api/mar/uhid/:uhid
  getByUHID = handle(async (req, res) => {
    const mars = await MAR.find({ UHID: req.params.uhid })
      .sort({ date: -1 })
      .lean();
    return res.json({ success: true, data: mars, count: mars.length });
  });

  // GET /api/mar/:id
  getById = handle(async (req, res) => {
    const mar = await MAR.findById(req.params.id).lean();
    if (!mar) return res.status(404).json({ success: false, message: "MAR not found" });
    return res.json({ success: true, data: mar });
  });

  // POST /api/mar/:id/medication — add medication to MAR
  addMedication = handle(async (req, res) => {
    const mar = await MAR.findByIdAndUpdate(
      req.params.id,
      { $push: { medications: req.body } },
      { new: true }
    );
    if (!mar) return res.status(404).json({ success: false, message: "MAR not found" });
    return res.json({ success: true, data: mar });
  });

  // PATCH /api/mar/:id/medication/:medId/administer — record administration
  recordAdministration = handle(async (req, res) => {
    const { scheduledTime, status, nurseName, nurseStaffId, batchNumber, reason, remarks } = req.body;
    const entry = {
      scheduledTime,
      actualTime: new Date(),
      status,
      nurseName,
      nurseStaffId,
      batchNumber,
      reason,
      remarks,
    };

    const mar = await MAR.findOneAndUpdate(
      { _id: req.params.id, "medications._id": req.params.medId },
      { $push: { "medications.$.administrations": entry } },
      { new: true }
    );
    if (!mar) return res.status(404).json({ success: false, message: "MAR or medication not found" });
    // ── Auto-billing hook ──────────────────────────────────────
    try {
      const autoBilling = require("../../services/billing/autoBillingService");
      const med = mar.medications.id(req.params.medId);
      if (med && status === "administered") {
        autoBilling.onMARAdministration(mar, med, entry).catch(() => {});
      }
    } catch {}
    return res.json({ success: true, data: mar, message: "Administration recorded" });
  });

  // PATCH /api/mar/:id/medication/:medId/discontinue
  discontinueMedication = handle(async (req, res) => {
    const { discontinuedBy, discontinueReason } = req.body;
    const mar = await MAR.findOneAndUpdate(
      { _id: req.params.id, "medications._id": req.params.medId },
      {
        $set: {
          "medications.$.isActive": false,
          "medications.$.discontinuedAt": new Date(),
          "medications.$.discontinuedBy": discontinuedBy,
          "medications.$.discontinueReason": discontinueReason,
        },
      },
      { new: true }
    );
    if (!mar) return res.status(404).json({ success: false, message: "MAR or medication not found" });
    return res.json({ success: true, data: mar });
  });

  // PUT /api/mar/:id — update full MAR
  update = handle(async (req, res) => {
    const mar = await MAR.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!mar) return res.status(404).json({ success: false, message: "MAR not found" });
    return res.json({ success: true, data: mar });
  });
}

module.exports = new MARController();
