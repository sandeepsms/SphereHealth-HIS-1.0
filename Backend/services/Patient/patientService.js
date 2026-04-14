// services/Patient/patientService.js
// ✅ Fixed: visit counter increments on FIRST registration too
// ✅ Patient history tracked via VisitHistory embedded or separate

const Patient = require("../../models/Patient/patientModel");
const Department = require("../../models/Department/department");
const Doctor = require("../../models/Doctor/doctorModel");
const TPA = require("../../models/tpa/tpaModel");

/* ── Helper: which counter field for a registration type ── */
const visitCounterField = (regType) => {
  if (regType === "OPD") return "totalOPDVisits";
  if (regType === "Emergency") return "totalEmergencyVisits";
  if (regType === "IPD") return "totalIPDVisits";
  if (regType === "Daycare") return "totalDaycareVisits";
  if (regType === "Services") return "totalServicesVisits";
  return null;
};

class PatientService {
  /* ══════════════════════════════════════════════
     CREATE — new patient + increment correct counter
  ══════════════════════════════════════════════ */
  async createPatient(patientData) {
    const department = await Department.findById(patientData.department);
    if (!department) throw new Error("Department not found");

    const doctor = await Doctor.findById(patientData.doctor);
    if (!doctor) throw new Error("Doctor not found");

    if (doctor.department.toString() !== patientData.department.toString()) {
      throw new Error(
        "Selected doctor does not belong to the selected department",
      );
    }

    if (patientData.paymentType === "TPA") {
      if (!patientData.tpa)
        throw new Error("TPA is required for TPA payment type");
      const tpa = await TPA.findById(patientData.tpa);
      if (!tpa || !tpa.isActive)
        throw new Error("Invalid or inactive TPA selected");
      if (!patientData.policyNumber)
        throw new Error("Policy number is required for TPA payment type");
    }

    // ✅ Initialise the correct visit counter to 1 on first registration
    const counterField = visitCounterField(patientData.registrationType);
    if (counterField) {
      patientData[counterField] = 1;
    }

    // ✅ Set lastVisitDate on first registration
    patientData.lastVisitDate = new Date();

    const patient = new Patient(patientData);
    await patient.save();

    await patient.populate([
      { path: "department", select: "departmentName departmentCode" },
      { path: "doctor", select: "personalInfo doctorId" },
      { path: "tpa", select: "tpaName tpaCode phone email" },
    ]);

    return patient;
  }

  /* ══════════════════════════════════════════════
     GET ALL
  ══════════════════════════════════════════════ */
  async getAllPatients(filters = {}) {
    const {
      registrationType,
      department,
      doctor,
      paymentType,
      tpa,
      search,
      page = 1,
      limit = 1000,
    } = filters;

    const query = { isActive: true };
    if (registrationType) query.registrationType = registrationType;
    if (department) query.department = department;
    if (doctor) query.doctor = doctor;
    if (paymentType) query.paymentType = paymentType;
    if (tpa) query.tpa = tpa;

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { patientId: { $regex: search, $options: "i" } },
        { UHID: { $regex: search, $options: "i" } },
        { contactNumber: { $regex: search, $options: "i" } },
        { policyNumber: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const patients = await Patient.find(query)
      .populate("department", "departmentName")
      .populate("doctor", "personalInfo")
      .populate("tpa", "tpaName tpaCode")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const count = await Patient.countDocuments(query);
    return {
      patients,
      totalPages: Math.ceil(count / parseInt(limit)),
      currentPage: parseInt(page),
      totalPatients: count,
    };
  }

  /* ══════════════════════════════════════════════
     SEARCH
  ══════════════════════════════════════════════ */
  async searchPatients(searchTerm, limit = 10) {
    if (!searchTerm || searchTerm.trim().length < 2) return [];
    const trimmed = searchTerm.trim();
    return Patient.find({
      isActive: true,
      $or: [
        { fullName: { $regex: trimmed, $options: "i" } },
        { UHID: { $regex: trimmed, $options: "i" } },
        { contactNumber: { $regex: trimmed, $options: "i" } },
        { patientId: { $regex: trimmed, $options: "i" } },
        { email: { $regex: trimmed, $options: "i" } },
      ],
    })
      .populate("department", "departmentName")
      .populate("doctor", "personalInfo")
      .populate("tpa", "tpaName")
      .select(
        "fullName title UHID contactNumber email gender dateOfBirth maritalStatus department doctor completeAddress knownAllergies tpa companionName companionRelationship companionContact hasAppointment appointmentDate appointmentTime registrationType bloodGroup address totalOPDVisits totalEmergencyVisits totalIPDVisits totalDaycareVisits totalServicesVisits lastVisitDate",
      )
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
  }

  /* ══════════════════════════════════════════════
     GET BY ID
  ══════════════════════════════════════════════ */
  async getPatientById(id) {
    const patient = await Patient.findById(id)
      .populate("department", "departmentName departmentCode")
      .populate("doctor", "personalInfo doctorId")
      .populate("tpa", "tpaName tpaCode phone email contactPerson");
    if (!patient) throw new Error("Patient not found");
    return patient;
  }

  /* ══════════════════════════════════════════════
     GET BY UHID
  ══════════════════════════════════════════════ */
  async getPatientByUHID(uhid) {
    const patient = await Patient.findOne({ UHID: uhid })
      .populate("department", "departmentName")
      .populate("doctor", "personalInfo")
      .populate("tpa", "tpaName tpaCode phone");
    if (!patient) throw new Error("Patient not found");
    return patient;
  }

  /* ══════════════════════════════════════════════
     UPDATE — also increments visit counter
     Frontend sends _incrementVisit: "totalOPDVisits" etc.
  ══════════════════════════════════════════════ */
  async updatePatient(id, updateData) {
    if (updateData.doctor && updateData.department) {
      const doctor = await Doctor.findById(updateData.doctor);
      if (
        doctor &&
        doctor.department.toString() !== updateData.department.toString()
      ) {
        throw new Error(
          "Selected doctor does not belong to the selected department",
        );
      }
    }

    if (updateData.paymentType === "TPA" && updateData.tpa) {
      const tpa = await TPA.findById(updateData.tpa);
      if (!tpa || !tpa.isActive)
        throw new Error("Invalid or inactive TPA selected");
    }

    // ⭐ NEVER overwrite UHID / patientId
    delete updateData.UHID;
    delete updateData.patientId;

    // ⭐ Handle visit counter increment
    const incrementField = updateData._incrementVisit;
    delete updateData._incrementVisit;

    const updateOp = { $set: updateData };

    const VALID_COUNTERS = [
      "totalOPDVisits",
      "totalIPDVisits",
      "totalEmergencyVisits",
      "totalDaycareVisits",
      "totalServicesVisits",
    ];
    if (incrementField && VALID_COUNTERS.includes(incrementField)) {
      updateOp.$inc = { [incrementField]: 1 };
    }

    const patient = await Patient.findByIdAndUpdate(id, updateOp, {
      new: true,
      runValidators: true,
    })
      .populate("department", "departmentName")
      .populate("doctor", "personalInfo")
      .populate("tpa", "tpaName tpaCode");

    if (!patient) throw new Error("Patient not found");
    return patient;
  }

  /* ══════════════════════════════════════════════
     DELETE (soft)
  ══════════════════════════════════════════════ */
  async deletePatient(id) {
    const patient = await Patient.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    );
    if (!patient) throw new Error("Patient not found");
    return patient;
  }

  /* ══════════════════════════════════════════════
     STATS
  ══════════════════════════════════════════════ */
  async getPatientStats() {
    const stats = await Patient.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$registrationType", count: { $sum: 1 } } },
    ]);
    const totalPatients = await Patient.countDocuments({ isActive: true });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayPatients = await Patient.countDocuments({
      isActive: true,
      registrationDate: { $gte: today },
    });
    const tpaPatients = await Patient.countDocuments({
      isActive: true,
      paymentType: "TPA",
    });
    return {
      total: totalPatients,
      today: todayPatients,
      tpaPatients,
      byType: stats,
    };
  }

  /* ══════════════════════════════════════════════
     PATIENT HISTORY — all admissions + OPD visits
     Returns visits sorted by date desc
  ══════════════════════════════════════════════ */
  async getPatientHistory(patientId) {
    const Admission = require("../../models/Admission/admissionModel");

    const [patient, admissions] = await Promise.all([
      Patient.findById(patientId)
        .populate("department", "departmentName")
        .populate("doctor", "personalInfo")
        .select(
          "fullName UHID gender age contactNumber bloodGroup registrationType registrationDate totalOPDVisits totalEmergencyVisits totalIPDVisits totalDaycareVisits totalServicesVisits lastVisitDate",
        ),
      Admission.find({ patientId })
        .populate("bedId", "bedNumber")
        .populate("department", "departmentName")
        .sort({ admissionDate: -1 })
        .limit(50),
    ]);

    if (!patient) throw new Error("Patient not found");

    return { patient, admissions };
  }

  /* ══════════════════════════════════════════════
     UPDATE VISIT COUNT — called by OPDService etc.
  ══════════════════════════════════════════════ */
  async updateVisitCount(patientId, type) {
    const field = visitCounterField(type);
    if (!field) return;
    return Patient.findByIdAndUpdate(
      patientId,
      { $inc: { [field]: 1 }, lastVisitDate: new Date() },
      { new: true }
    );
  }

  async getPatientsByTPA(tpaId, filters = {}) {
    const { search, fromDate, toDate, page = 1, limit = 10 } = filters;
    const query = { isActive: true, paymentType: "TPA", tpa: tpaId };
    if (fromDate && toDate) {
      query.registrationDate = {
        $gte: new Date(fromDate),
        $lte: new Date(toDate),
      };
    }
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { UHID: { $regex: search, $options: "i" } },
        { contactNumber: { $regex: search, $options: "i" } },
      ];
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const patients = await Patient.find(query)
      .populate("department", "departmentName")
      .populate("doctor", "personalInfo")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);
    const count = await Patient.countDocuments(query);
    return {
      patients,
      totalPages: Math.ceil(count / parseInt(limit)),
      currentPage: parseInt(page),
      totalPatients: count,
    };
  }
}

module.exports = new PatientService();
