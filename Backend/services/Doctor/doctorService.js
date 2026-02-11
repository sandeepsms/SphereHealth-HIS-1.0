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

  async updateConsultationFee(id, opdFee, emergencyFee) {
    if (mongoose.Types.ObjectId.isValid(id)) {
      const doctor = await Doctor.findByIdAndUpdate(
        id,
        {
          "consultationFee.opd": opdFee,
          "consultationFee.emergency": emergencyFee,
        },
        { new: true },
      ).populate("department");
      if (doctor) return doctor;
    }

    return await Doctor.findOneAndUpdate(
      { doctorId: id },
      {
        "consultationFee.opd": opdFee,
        "consultationFee.emergency": emergencyFee,
      },
      { new: true },
    ).populate("department");
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
