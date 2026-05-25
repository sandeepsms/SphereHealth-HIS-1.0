const Doctor = require("../../models/Doctor/doctorModel");
const mongoose = require("mongoose");

class DoctorService {
  async createDoctor(doctorData) {
    const doctor = new Doctor(doctorData);
    await doctor.save();
    await doctor.populate("department");
    return doctor;
  }

  async getAllDoctors(page = 1, limit = 10, filters = {}) {
    const skip = (page - 1) * limit;
    const query = { isActive: true, ...filters };

    const doctors = await Doctor.find(query)
      .populate("department")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Doctor.countDocuments(query);

    return {
      doctors,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getDoctorById(id) {
    if (mongoose.Types.ObjectId.isValid(id)) {
      const doctor = await Doctor.findById(id).populate("department");
      if (doctor) return doctor;
    }

    return await Doctor.findOne({ doctorId: id, isActive: true }).populate(
      "department",
    );
  }

  async updateDoctor(id, updateData) {
    if (mongoose.Types.ObjectId.isValid(id)) {
      const doctor = await Doctor.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      }).populate("department");
      if (doctor) return doctor;
    }

    return await Doctor.findOneAndUpdate({ doctorId: id }, updateData, {
      new: true,
      runValidators: true,
    }).populate("department");
  }

  async deleteDoctor(id) {
    if (mongoose.Types.ObjectId.isValid(id)) {
      const doctor = await Doctor.findByIdAndUpdate(
        id,
        { isActive: false },
        { new: true },
      ).populate("department");
      if (doctor) return doctor;
    }

    return await Doctor.findOneAndUpdate(
      { doctorId: id },
      { isActive: false },
      { new: true },
    ).populate("department");
  }

  async getDoctorsByDepartment(department) {
    return await Doctor.find({ department, isActive: true })
      .populate("department")
      .sort({ "personalInfo.fullName": 1 });
  }

  async getDoctorsBySpecialization(specialization) {
    return await Doctor.find({
      "professional.specialization": specialization,
      isActive: true,
    })
      .populate("department")
      .sort({ "personalInfo.fullName": 1 });
  }

  async searchDoctors(searchTerm) {
    const regex = new RegExp(searchTerm, "i");
    return await Doctor.find({
      isActive: true,
      $or: [
        { doctorId: regex },
        { "personalInfo.fullName": regex },
        { "personalInfo.firstName": regex },
        { "personalInfo.lastName": regex },
        { "contact.email": regex },
        { "professional.specialization": regex },
      ],
    })
      .populate("department")
      .limit(20);
  }

  async getActiveDoctors() {
    return await Doctor.find({ isActive: true })
      .populate("department")
      .sort({ "personalInfo.fullName": 1 });
  }

  // R7dp — Accept any subset of opd/opdFirst/opdFollowup/emergency/mlc/ipdCrossConsult
  async updateConsultationFee(doctorId, fees) {
    if (!doctorId) throw new Error("Doctor ID is required");
    if (!fees || typeof fees !== "object") throw new Error("Fees object required");

    const allowed = ["opd", "opdFirst", "opdFollowup", "emergency", "mlc", "ipdCrossConsult"];
    const update = {};
    for (const k of allowed) {
      if (fees[k] !== undefined) {
        const n = Number(fees[k]);
        if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid fee for ${k}`);
        update[`consultationFee.${k}`] = n;
      }
    }
    // If only legacy `opd` is passed, mirror it onto opdFirst so the new
    // codepath (which reads opdFirst) gets the same value. This makes
    // the field rename non-breaking for any external integration still
    // sending {opd: X}.
    if (fees.opd !== undefined && fees.opdFirst === undefined) {
      update["consultationFee.opdFirst"] = Number(fees.opd) || 0;
    }
    if (Object.keys(update).length === 0) throw new Error("No fee fields to update");

    // Support either ObjectId or string doctorId code, matching the rest
    // of this service.
    if (mongoose.Types.ObjectId.isValid(doctorId)) {
      const doctor = await Doctor.findByIdAndUpdate(
        doctorId,
        { $set: update },
        { new: true, runValidators: true },
      ).populate("department");
      if (doctor) return doctor;
    }

    const doctor = await Doctor.findOneAndUpdate(
      { doctorId },
      { $set: update },
      { new: true, runValidators: true },
    ).populate("department");
    if (!doctor) throw new Error("Doctor not found");
    return doctor;
  }

  async getDoctorStats(id) {
    let doctor;

    if (mongoose.Types.ObjectId.isValid(id)) {
      doctor = await Doctor.findById(id).populate("department");
    }

    if (!doctor) {
      doctor = await Doctor.findOne({ doctorId: id }).populate("department");
    }

    if (!doctor) {
      throw new Error("Doctor not found");
    }

    return {
      doctorId: doctor.doctorId,
      fullName: doctor.personalInfo.fullName,
      specialization: doctor.professional.specialization,
      department: doctor.department,
      experience: doctor.professional.experience,
      consultationFee: doctor.consultationFee,
    };
  }

  async getDoctorsByExperience(minExperience) {
    return await Doctor.find({
      "professional.experience": { $gte: minExperience },
      isActive: true,
    })
      .populate("department")
      .sort({ "professional.experience": -1 });
  }
}

module.exports = new DoctorService();
