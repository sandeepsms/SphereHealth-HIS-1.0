const VitalSheet = require("../../models/Vitals/vitalSheetModel");
const Patient = require("../../models/Patient/patientModel");
const NurseStaff = require("../../models/Nurse/nurseStaffModel");

// ── Helper: date format ──────────────────────────────
const formatDate = (date) => {
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`; // "2026-03-24"
};

// ── Resolve nurse name from ID ────────────────────────
const resolveNurse = async (nurseId) => {
  if (!nurseId) return { id: null, name: "" };
  try {
    const nurse = await NurseStaff.findById(nurseId)
      .select("personalInfo.fullName staffId")
      .lean();
    return {
      id: nurse?._id || null,
      name: nurse?.personalInfo?.fullName || "",
    };
  } catch (_) {
    return { id: null, name: "" };
  }
};

// ── Save (upsert) ─────────────────────────────────────
exports.saveVitalSheet = async (data) => {
  const { uhid, date, activeVitals, tableData, nurseId, admissionId } = data;

  // Get patient from UHID
  const patient = await Patient.findOne({ UHID: uhid })
    .populate("doctor", "personalInfo.fullName doctorId")
    .populate("department", "departmentName");

  if (!patient) throw new Error(`Patient not found with UHID: ${uhid}`);

  const formattedDate = formatDate(date);

  // Resolve nurse for each tableData entry
  const resolvedTableData = await Promise.all(
    (tableData || []).map(async (entry) => {
      const nid = entry.recordedBy || nurseId || null;
      const { id, name } = await resolveNurse(nid);
      return {
        ...entry,
        recordedBy: id,
        nurseName: name || entry.nurseName || "",
      };
    }),
  );

  const record = await VitalSheet.findOneAndUpdate(
    { uhid, date: formattedDate },
    {
      $set: {
        patient: patient._id,
        uhid,
        patientName: patient.fullName,
        date: formattedDate,
        ipdNo: uhid,
        doctor: patient.doctor?._id || null,
        doctorName: patient.doctor?.personalInfo?.fullName || "",
        department: patient.department?._id || null,
        departmentName: patient.department?.departmentName || "",
        admission: admissionId || null,
        activeVitals: activeVitals || [],
        tableData: resolvedTableData,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
    .populate("patient", "fullName UHID age gender contactNumber bloodGroup")
    .populate("doctor", "personalInfo.fullName doctorId")
    .populate("department", "departmentName")
    .populate(
      "tableData.recordedBy",
      "personalInfo.fullName staffId professional.designation",
    );

  return record;
};

// ── Get all sheets for a patient ──────────────────────
exports.getVitalSheet = async (uhid, date) => {
  if (!uhid) throw new Error("uhid is required");

  const filter = { uhid };
  if (date) filter.date = formatDate(date);

  const records = await VitalSheet.find(filter)
    .populate("patient", "fullName UHID age gender contactNumber bloodGroup")
    .populate("doctor", "personalInfo.fullName doctorId")
    .populate("department", "departmentName")
    .populate(
      "tableData.recordedBy",
      "personalInfo.fullName staffId professional.designation",
    )
    .sort({ date: -1 })
    .lean();

  return { exists: records.length > 0, data: records, count: records.length };
};

// ── Update ────────────────────────────────────────────
exports.updateVitalSheet = async (data) => {
  const { uhid, date, activeVitals, tableData, nurseId } = data;
  if (!uhid || !date) throw new Error("uhid and date are required");

  const formattedDate = formatDate(date);

  const sheet = await VitalSheet.findOne({ uhid, date: formattedDate });
  if (!sheet) throw new Error("Record not found for this UHID & date");

  if (tableData) {
    const resolvedTableData = await Promise.all(
      tableData.map(async (entry) => {
        const nid = entry.recordedBy || nurseId || null;
        const { id, name } = await resolveNurse(nid);
        return {
          ...entry,
          recordedBy: id,
          nurseName: name || entry.nurseName || "",
        };
      }),
    );
    sheet.tableData = resolvedTableData;
  }

  if (activeVitals) sheet.activeVitals = activeVitals;
  await sheet.save();

  return VitalSheet.findById(sheet._id)
    .populate("patient", "fullName UHID age gender")
    .populate("doctor", "personalInfo.fullName doctorId")
    .populate("department", "departmentName")
    .populate("tableData.recordedBy", "personalInfo.fullName staffId");
};

// ── Delete ────────────────────────────────────────────
exports.deleteVitalSheet = async ({ uhid, date }) => {
  if (!uhid || !date) throw new Error("uhid and date are required");

  const formattedDate = formatDate(date);

  const deleted = await VitalSheet.findOneAndDelete({
    uhid,
    date: formattedDate,
  });
  if (!deleted) throw new Error("Record not found");

  return deleted;
};
