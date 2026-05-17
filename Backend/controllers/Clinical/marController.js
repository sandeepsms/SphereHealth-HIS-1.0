// controllers/Clinical/marController.js
const MAR = require("../../models/Clinical/MARModel");
const Patient = require("../../models/Patient/patientModel");

// Status enum normaliser — historical typos (`administered`, `Administered`)
// must map onto the MAR model enum [GIVEN, HELD, REFUSED, NOT_AVAILABLE, MISSED].
const STATUS_MAP = {
  administered: "GIVEN", given: "GIVEN", taken: "GIVEN",
  held: "HELD", hold: "HELD",
  refused: "REFUSED",
  not_available: "NOT_AVAILABLE", unavailable: "NOT_AVAILABLE", na: "NOT_AVAILABLE",
  missed: "MISSED", skipped: "MISSED",
};
const normalizeStatus = (s) => STATUS_MAP[String(s || "").toLowerCase()] || s;

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
  //
  // FIX (audit P19): MARSchema.patient is `required: true`, but the legacy
  // controller never resolved it from UHID — every create blew up with
  // ValidationError. Now we look up the Patient by UHID and stamp the
  // ObjectId before create. Also normalize the day window so two callers
  // sending different ms-precision dates on the same day land on the
  // same document instead of creating duplicates.
  createOrGet = handle(async (req, res) => {
    const { UHID, ipdNo, date, admissionId, patientName, allergies } = req.body;
    const raw = date ? new Date(date) : new Date();
    const marDate = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate()); // local midnight
    const nextDay = new Date(marDate); nextDay.setDate(nextDay.getDate() + 1);

    let mar = await MAR.findOne({ ipdNo, date: { $gte: marDate, $lt: nextDay } });
    if (mar) return res.status(200).json({ success: true, data: mar });

    // Resolve the required patient ObjectId
    let patientId = req.body.patient || req.body.patientId;
    if (!patientId && UHID) {
      const p = await Patient.findOne({ UHID }).select("_id").lean();
      patientId = p?._id;
    }
    if (!patientId) {
      return res.status(400).json({ success: false, message: "patient (UHID) required to open a MAR" });
    }

    mar = await MAR.create({
      patient: patientId,
      UHID,
      ipdNo,
      admissionId,
      patientName,
      date: marDate,
      allergies: allergies || [],
      medications: (req.body.medications || []).map((m) => ({
        ...m,
        administrations: (m.administrations || []).map((a) => ({
          ...a,
          status: normalizeStatus(a.status),
        })),
      })),
    });
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
      { new: true, runValidators: true }
    );
    if (!mar) return res.status(404).json({ success: false, message: "MAR not found" });
    return res.json({ success: true, data: mar });
  });

  // PATCH /api/mar/:id/medication/:medId/administer — record administration
  recordAdministration = handle(async (req, res) => {
    const { scheduledTime, status, nurseName, nurseStaffId, batchNumber, reason, remarks } = req.body;
    const finalStatus = normalizeStatus(status);  // accept "administered" → "GIVEN" etc.
    const entry = {
      scheduledTime,
      actualTime: new Date(),
      status: finalStatus,
      // Stamp authoritative actor from JWT — never trust req.body for audit
      nurseName:    nurseName    || req.user?.fullName    || "",
      nurseStaffId: nurseStaffId || req.user?.employeeId  || "",
      batchNumber,
      reason,
      remarks,
    };

    const mar = await MAR.findOneAndUpdate(
      { _id: req.params.id, "medications._id": req.params.medId },
      { $push: { "medications.$.administrations": entry } },
      { new: true, runValidators: true }
    );
    if (!mar) return res.status(404).json({ success: false, message: "MAR or medication not found" });

    // ── Auto-billing hook ──────────────────────────────────────
    // Bill on every GIVEN dose; HELD/REFUSED/MISSED/NOT_AVAILABLE do NOT bill.
    try {
      const autoBilling = require("../../services/Billing/autoBillingService");
      const med = mar.medications.id(req.params.medId);
      if (med && finalStatus === "GIVEN") {
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
      { new: true, runValidators: true }
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
