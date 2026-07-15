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
  const get = (key) => {
    if (v instanceof Map) return v.get(key)?.value ?? null;
    return v[key]?.value ?? null;
  };

  return {
    vitalSheetRef: sheet._id,
    vitalsSnapshot: {
      pulse: get("pulse"),
      bp: get("bp"),
      rr: get("rr"),
      temp: get("temp"),
      spo2: get("spo2"),
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
