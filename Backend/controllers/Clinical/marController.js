// controllers/Clinical/marController.js
const MAR = require("../../models/Clinical/MARModel");
const Patient = require("../../models/Patient/patientModel");

// R7az-D6-CRIT-3: dedupe window for double-tap on Administer button.
// Two charts of the SAME (scheduledDate, scheduledTime, medicineId)
// within IDEMPOTENT_WINDOW_MS are treated as a duplicate submission
// and rejected 409 instead of being recorded twice.
const IDEMPOTENT_WINDOW_MS = 10 * 60 * 1000; // ±10 minutes
function _isSameSchedule(prevEntry, newScheduled, withinMs = IDEMPOTENT_WINDOW_MS) {
  if (!prevEntry || !newScheduled) return false;
  // Same string slot wins immediately.
  if (prevEntry.scheduledTime && prevEntry.scheduledTime === newScheduled) return true;
  // Otherwise compare actualTime within the window.
  const prevTs = prevEntry.actualTime ? new Date(prevEntry.actualTime).getTime() : null;
  if (!prevTs) return false;
  // Parse newScheduled as HH:MM today (best-effort).
  if (/^\d{1,2}:\d{2}/.test(String(newScheduled))) {
    const [h, m] = String(newScheduled).split(":").map(Number);
    const target = new Date(); target.setHours(h, m, 0, 0);
    return Math.abs(prevTs - target.getTime()) <= withinMs;
  }
  return false;
}

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
  //
  // R7az-D6-CRIT-3: idempotency guard — reject duplicate scheduled slot
  // within ±10 min as 409 IDEMPOTENT_DUPLICATE. Prevents double-tap on
  // the nurse Administer button generating two billing rows.
  //
  // R7az-D7-HIGH-3 / D7-HIGH-4: nurseName + req.user.id mandatory,
  // reason mandatory for non-GIVEN statuses (HELD/REFUSED/MISSED).
  // actualTime is always server-stamped — never trust client clocks.
  // Signature carried from req.user.signature if present.
  recordAdministration = handle(async (req, res) => {
    const { scheduledTime, status, nurseName, nurseStaffId, batchNumber, reason, remarks } = req.body;
    const finalStatus = normalizeStatus(status);

    // Actor + signature must be resolvable
    const resolvedNurseName  = nurseName    || req.user?.fullName   || "";
    const resolvedStaffId    = nurseStaffId || req.user?.employeeId || "";
    const resolvedUserId     = req.user?.id || req.user?._id || null;
    const resolvedSignature  = req.user?.signature || req.body?.signatureUrl || "";

    if (!resolvedNurseName || !resolvedUserId) {
      return res.status(400).json({ success: false, message: "nurseName and authenticated user are required for MAR administration" });
    }
    const NEEDS_REASON = new Set(["HELD", "REFUSED", "MISSED"]);
    if (NEEDS_REASON.has(finalStatus) && !(reason && String(reason).trim())) {
      return res.status(400).json({ success: false, message: `reason is required when status is ${finalStatus}` });
    }

    // Idempotency check — load the MAR first, scan existing entries.
    const mar = await MAR.findOne({ _id: req.params.id, "medications._id": req.params.medId });
    if (!mar) return res.status(404).json({ success: false, message: "MAR or medication not found" });
    const med = mar.medications.id(req.params.medId);
    if (!med) return res.status(404).json({ success: false, message: "Medication not found in MAR" });

    if (scheduledTime) {
      const dup = (med.administrations || []).find((a) => _isSameSchedule(a, scheduledTime));
      if (dup) {
        return res.status(409).json({
          success: false,
          code: "IDEMPOTENT_DUPLICATE",
          message: `Duplicate administration for ${scheduledTime} within ±10 minutes — refusing to chart twice`,
        });
      }
    }

    const entry = {
      scheduledTime,
      actualTime: new Date(),       // server-side only
      status: finalStatus,
      nurseName:    resolvedNurseName,
      nurseStaffId: resolvedStaffId,
      administeredBy: resolvedUserId,
      signatureUrl: resolvedSignature || undefined,
      batchNumber,
      reason,
      remarks,
    };

    med.administrations.push(entry);
    await mar.save();

    // ── Auto-billing hook ──────────────────────────────────────
    // Bill on every GIVEN dose; HELD/REFUSED/MISSED/NOT_AVAILABLE do NOT bill.
    try {
      const { logErr } = require("../../utils/logErr");
      const autoBilling = require("../../services/Billing/autoBillingService");
      if (finalStatus === "GIVEN") {
        autoBilling.onMARAdministration(mar, med, entry).catch(logErr("autoBilling", `onMARAdministration ${mar?._id} med ${med?._id}`));
      }
    } catch (e) {
      const { logErr } = require("../../utils/logErr");
      logErr("autoBilling", "load failure on MAR.administer")(e);
    }
    return res.json({ success: true, data: mar, message: "Administration recorded" });
  });

  // PATCH /api/mar/:id/medication/:medId/discontinue
  // R7az-D6-HIGH-7: load + .save() so the append-only pre-save hook
  // and any future validators fire on discontinuation.
  discontinueMedication = handle(async (req, res) => {
    const { discontinuedBy, discontinueReason } = req.body;
    const mar = await MAR.findOne({ _id: req.params.id, "medications._id": req.params.medId });
    if (!mar) return res.status(404).json({ success: false, message: "MAR or medication not found" });
    const med = mar.medications.id(req.params.medId);
    if (!med) return res.status(404).json({ success: false, message: "Medication not found in MAR" });
    med.isActive = false;
    med.discontinuedAt = new Date();
    med.discontinuedBy = discontinuedBy || req.user?.fullName || "";
    med.discontinueReason = discontinueReason || "";
    await mar.save();
    return res.json({ success: true, data: mar });
  });

  // PUT /api/mar/:id — update full MAR
  // R7az-D2-CRIT-5 / D6-MED-6: CAS-style update. Refuse any attempt to
  // mutate the `administrations[]` array via PUT body (append-only is
  // enforced for that path via /administer). Whitelist mutable top-level
  // fields and call .save() so the schema-level append-only hook still
  // fires against any sneak attempt to rewrite existing rows.
  update = handle(async (req, res) => {
    const mar = await MAR.findById(req.params.id);
    if (!mar) return res.status(404).json({ success: false, message: "MAR not found" });

    // Whitelist of mutable top-level fields. medications[] is intentionally
    // OUT — that path is mutated via add/administer/discontinue endpoints
    // which carry their own validators and audit semantics.
    const MUTABLE = new Set([
      "allergies", "allergyAlertAcknowledged", "status", "patientName",
    ]);
    const body = req.body || {};
    if (Array.isArray(body.medications)) {
      // Reject upfront — a PUT must not silently overwrite the medication
      // tree (which would erase administration history per D2-CRIT-5).
      return res.status(400).json({
        success: false,
        code: "MAR_MEDICATIONS_IMMUTABLE_VIA_PUT",
        message: "MAR.medications[] is append-only — use /medication, /administer or /discontinue endpoints instead",
      });
    }
    for (const [k, v] of Object.entries(body)) {
      if (MUTABLE.has(k)) mar.set(k, v);
    }
    mar.updatedBy = req.user?.id || req.user?._id || mar.updatedBy;
    await mar.save();
    return res.json({ success: true, data: mar });
  });
}

module.exports = new MARController();
