// services/shiftHandoverService.js

const ShiftHandover = require("../../models/Nurse/shiftHandoverModel");
const VitalSheet = require("../../models/Vitals/vitalSheetModel");

const formatDate = (date) => {
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`; // R8-FIX(#24): must match vitalSheetService.formatDate / VitalSheet.date (YYYY-MM-DD)
};

// ── VitalSheet se latest snapshot pull karo ───────────
const pullLatestVitals = async (uhid, date) => {
  const formattedDate = formatDate(date);

  const sheet = await VitalSheet.findOne(
    { uhid, date: formattedDate },
    "_id tableData",
  ).lean();

  if (!sheet || !sheet.tableData?.length) {
    return { vitalSheetRef: null, vitalsSnapshot: {} };
  }

  const last = sheet.tableData[sheet.tableData.length - 1];
  const v = last.values || {};
  // R9-FIX(R9-058): the vital sheet's column keys are free-form and cased by
  // the charting UI ("Pulse", "BP", "SpO2", "Resp. Rate", "Temp."), but this
  // snapshot did exact-case lookups on "pulse"/"bp"/"rr"/"temp"/"spo2" — which
  // NEVER matched, so every shift-handover carried an all-null vitals snapshot.
  // Build a case/separator-insensitive index (same normalisation as
  // nabhRegisterEmitter.js:994) and resolve each vital through its aliases.
  const norm = (k) => String(k).toLowerCase().replace(/[\s._\-/]/g, "");
  const idx = {};
  const entries = v instanceof Map ? v.entries() : Object.entries(v);
  for (const [k, val] of entries) {
    const nk = norm(k);
    if (!(nk in idx)) idx[nk] = val?.value ?? null;
  }
  const get = (...aliases) => {
    for (const a of aliases) {
      const nk = norm(a);
      if (nk in idx && idx[nk] != null && idx[nk] !== "") return idx[nk];
    }
    return null;
  };

  return {
    vitalSheetRef: sheet._id,
    vitalsSnapshot: {
      pulse: get("pulse", "hr", "heartrate", "pr", "pulserate"),
      bp: get("bp", "bloodpressure", "nibp"),
      rr: get("rr", "resp", "resprate", "respiratoryrate", "respiration"),
      temp: get("temp", "temperature"),
      spo2: get("spo2", "sao2", "o2sat", "oxygensaturation"),
      takenAt: last.time,
    },
  };
};

exports.createHandover = async (data) => {
  const {
    admissionId,
    uhid,
    fromShift,
    toShift,
    date,
    outgoingNurse,
    incomingNurse,
    patientStatus,
    intakeOutput,
    medicationsDevices,
    pendingTasks,
    specialInstructions,
    verification,
    informedDoctor,
  } = data;

  const { vitalSheetRef, vitalsSnapshot } = await pullLatestVitals(uhid, date);

  return ShiftHandover.create({
    admissionId,
    uhid,
    fromShift,
    toShift,
    date: new Date(date),
    outgoingNurse,
    incomingNurse,
    patientStatus,
    vitalSheetRef,
    vitalsSnapshot,
    intakeOutput,
    medicationsDevices,
    pendingTasks,
    specialInstructions,
    verification,
    informedDoctor,
  });
};

exports.getHandoversByAdmission = async (admissionId) => {
  return ShiftHandover.find({ admissionId })
    .populate("outgoingNurse", "personalInfo.fullName staffId")
    .populate("incomingNurse", "personalInfo.fullName staffId")
    .populate("informedDoctor", "personalInfo.fullName doctorId")
    .populate("vitalSheetRef", "date tableData")
    .sort({ date: -1, createdAt: -1 })
    .lean();
};

exports.getLatestHandover = async (uhid) => {
  return ShiftHandover.findOne({ uhid })
    .populate("outgoingNurse", "personalInfo.fullName staffId")
    .populate("incomingNurse", "personalInfo.fullName staffId")
    .populate("vitalSheetRef", "date tableData")
    .sort({ createdAt: -1 })
    .lean();
};

exports.verifyHandover = async (handoverId, verificationData) => {
  const updated = await ShiftHandover.findByIdAndUpdate(
    handoverId,
    {
      "verification.incomingNurseSign": verificationData.incomingNurseSign,
      "verification.doctorInformed": verificationData.doctorInformed,
      "verification.verifiedAt": new Date(),
    },
    { new: true },
  );
  if (!updated) throw new Error("Handover record not found");
  return updated;
};
