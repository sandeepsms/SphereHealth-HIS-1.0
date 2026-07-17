const VitalSheet = require("../../models/Vitals/vitalSheetModel");
const Patient = require("../../models/Patient/patientModel");
const NurseStaff = require("../../models/Nurse/NurseStaffModel");

// ── Helper: date format ──────────────────────────────
const formatDate = (date) => {
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`; // "2026-03-24"
};

// ── Resolve nurse name from ID ────────────────────────
// Resolve nurse from either an ObjectId, a staffId string, or a free-text
// name. The legacy implementation only handled ObjectIds, so when the
// frontend sent a plain name (the actual UI) the lookup silently failed
// and `recordedBy: null, nurseName: ""` was written — every vital lost
// its audit trail (audit P20). New behaviour:
//   • ObjectId    → findById
//   • staffId/name → findOne match + fall through to using the raw
//                    string as `nurseName` if no NurseStaff row exists
const mongoose = require("mongoose");
const resolveNurse = async (input) => {
  if (!input) return { id: null, name: "" };
  try {
    let nurse = null;
    if (mongoose.isValidObjectId(input)) {
      nurse = await NurseStaff.findById(input)
        .select("personalInfo.fullName staffId")
        .lean();
    } else {
      // Try staffId / name lookup
      const trimmed = String(input).trim();
      nurse = await NurseStaff.findOne({
        $or: [
          { staffId: trimmed },
          { "personalInfo.fullName": trimmed },
        ],
      }).select("personalInfo.fullName staffId").lean();
    }
    return {
      id:   nurse?._id || null,
      // Always preserve the input as `name` so the audit trail isn't lost
      // even if no NurseStaff row matched.
      name: nurse?.personalInfo?.fullName || String(input).trim(),
    };
  } catch (_) {
    return { id: null, name: String(input || "").trim() };
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

  // R9-FIX(R9-059): merge-preserve instead of wholesale-replacing tableData.
  // The old `$set: { tableData: resolvedTableData }` let a single POST overwrite
  // (or blank out) a whole day's recorded vitals with the request payload — no
  // append-only guarantee. Merge the incoming rows into the existing ones by
  // `time` slot: a POST can ADD a new hour or UPDATE its own hour, but can no
  // longer silently DROP hours it didn't send.
  const existingSheet = await VitalSheet.findOne({ uhid, date: formattedDate }).select("tableData").lean();
  const _byTime = new Map();
  for (const row of (existingSheet?.tableData || [])) _byTime.set(String(row.time), row);
  for (const row of resolvedTableData) _byTime.set(String(row.time), row);
  const mergedTableData = Array.from(_byTime.values());

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
        tableData: mergedTableData,
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

  // R7bn-5 / D6-fix: update AssessmentCompliance for vitals + (when MEWS
  // is included in the sheet) MEWS too. Twice-daily cadence per the
  // user requirement.
  if (admissionId) {
    try {
      const { recordAssessment } = require("../Compliance/assessmentComplianceService");
      const lastRowActor = data?.actor || data?.nurse || null;
      recordAssessment({
        admissionId,
        UHID: uhid,
        patientName: patient.fullName,
        assessmentType: "vitals",
        role: "nurse",
        actor: lastRowActor,
      }).catch(() => {});
      // If the row carries a mews score, also count it as a MEWS assessment.
      const hasMews = (tableData || []).some(r => r && (r.mews != null || r.mewsScore != null));
      if (hasMews) {
        recordAssessment({
          admissionId,
          UHID: uhid,
          patientName: patient.fullName,
          assessmentType: "mews",
          role: "nurse",
          actor: lastRowActor,
        }).catch(() => {});
      }
    } catch (_) { /* silent — compliance is non-blocking */ }
  }

  return record;
};

// ── Get all sheets for a patient ──────────────────────
// `limit` defaults to 90 days of sheets — vital trends rarely need more
// than 3 months of history at once, and an unbounded scan on a long-stay
// IPD patient (months of daily vitals) used to melt the API. Pagination
// is exposed via the optional `limit` arg so the trend-graph page can
// override on demand. Re-audit C-05 (R9 follow-up).
exports.getVitalSheet = async (uhid, date, opts = {}) => {
  if (!uhid) throw new Error("uhid is required");

  const filter = { uhid };
  if (date) filter.date = formatDate(date);

  const lim = Math.max(1, Math.min(500, Number(opts.limit) || 90));

  const records = await VitalSheet.find(filter)
    .populate("patient", "fullName UHID age gender contactNumber bloodGroup")
    .populate("doctor", "personalInfo.fullName doctorId")
    .populate("department", "departmentName")
    .populate(
      "tableData.recordedBy",
      "personalInfo.fullName staffId professional.designation",
    )
    .sort({ date: -1 })
    .limit(lim)
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

  // R9-FIX(R9-059): a vital sheet with recorded readings is a clinical record —
  // refuse to hard-delete it (NABH record-retention). A row is "recorded" once a
  // nurse is attributed (recordedBy). An empty/mistaken sheet may still be removed.
  const existing = await VitalSheet.findOne({ uhid, date: formattedDate }).select("tableData").lean();
  if (!existing) throw new Error("Record not found");
  if ((existing.tableData || []).some((r) => r && r.recordedBy)) {
    const e = new Error("Cannot delete a vital sheet that has recorded readings — it is a clinical record.");
    e.status = 409; e.code = "VITAL_SHEET_HAS_DATA";
    throw e;
  }

  const deleted = await VitalSheet.findOneAndDelete({
    uhid,
    date: formattedDate,
  });
  if (!deleted) throw new Error("Record not found");

  return deleted;
};
