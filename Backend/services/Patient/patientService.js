// services/Patient/patientService.js
const Patient = require("../../models/Patient/patientModel");
const Department = require("../../models/Department/department");
const Doctor = require("../../models/Doctor/doctorModel");
const TPA = require("../../models/tpa/tpaModel");

class PatientService {
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

    const patient = new Patient(patientData);
    await patient.save();

    await patient.populate([
      { path: "department", select: "departmentName departmentCode" },
      { path: "doctor", select: "personalInfo doctorId" },
      { path: "tpa", select: "tpaName tpaCode phone email" },
    ]);

    return patient;
  }

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

  // ✅ NEW: Search patients - UHID, name, phone se search karo
  async searchPatients(searchTerm, limit = 10) {
    if (!searchTerm || searchTerm.trim().length < 2) {
      return [];
    }

    const trimmed = searchTerm.trim();

    const patients = await Patient.find({
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
        "fullName UHID contactNumber email gender dateOfBirth department doctor tpa registrationType bloodGroup address",
      )
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    return patients;
  }

  async getPatientById(id) {
    const patient = await Patient.findById(id)
      .populate("department", "departmentName departmentCode")
      .populate("doctor", "personalInfo doctorId")
      .populate("tpa", "tpaName tpaCode phone email contactPerson");

    if (!patient) throw new Error("Patient not found");
    return patient;
  }

  async getPatientByUHID(uhid) {
    const patient = await Patient.findOne({ UHID: uhid })
      .populate("department", "departmentName")
      .populate("doctor", "personalInfo")
      .populate("tpa", "tpaName tpaCode phone");

    if (!patient) throw new Error("Patient not found");
    return patient;
  }

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

    const patient = await Patient.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true },
    )
      .populate("department", "departmentName")
      .populate("doctor", "personalInfo")
      .populate("tpa", "tpaName tpaCode");

    if (!patient) throw new Error("Patient not found");
    return patient;
  }

  async deletePatient(id) {
    const patient = await Patient.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true },
    );
    if (!patient) throw new Error("Patient not found");
    return patient;
  }

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
