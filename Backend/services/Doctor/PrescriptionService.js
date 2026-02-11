// services/prescription/prescriptionService.js

const Prescription = require("../../models/Doctor/prescription");
const Patient = require("../../models/Patient/patientModel");
const Doctor = require("../../models/Doctor/doctorModel");
const mongoose = require("mongoose");

class PrescriptionService {
  // Create Prescription
  static async createPrescription(data) {
    const { patient, UHID, doctor, ...otherData } = data;

    // Validate and fetch patient details
    let patientData;
    if (patient) {
      patientData = await Patient.findById(patient);
      if (!patientData) {
        throw new Error("Patient not found");
      }
    } else if (UHID) {
      patientData = await Patient.findOne({ UHID: UHID.toUpperCase() });
      if (!patientData) {
        throw new Error("Patient not found with this UHID");
      }
    } else {
      throw new Error("Either patient ID or UHID is required");
    }

    // Validate and fetch doctor details
    const doctorData = await Doctor.findById(doctor);
    if (!doctorData) {
      throw new Error("Doctor not found");
    }

    // Create prescription with auto-populated patient and doctor details
    const prescription = new Prescription({
      patient: patientData._id,
      UHID: patientData.UHID,
      patientName: patientData.name,
      age: patientData.age,
      gender: patientData.gender,
      contactNumber: patientData.contactNumber,
      fatherName: patientData.fatherName,
      doctor: doctorData._id,
      doctorName: doctorData.name,
      ...otherData,
    });

    const saved = await prescription.save();
    return saved.populate([
      { path: "patient", select: "name UHID age gender contactNumber" },
      { path: "doctor", select: "name specialization department" },
    ]);
  }

  // Get All Prescriptions
  static async getAllPrescriptions(filters = {}) {
    const query = { isActive: true };

    if (filters.patient) {
      query.patient = filters.patient;
    }
    if (filters.UHID) {
      query.UHID = filters.UHID.toUpperCase();
    }
    if (filters.doctor) {
      query.doctor = filters.doctor;
    }
    if (filters.registrationType) {
      query.registrationType = filters.registrationType;
    }
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.fromDate || filters.toDate) {
      query.prescriptionDate = {};
      if (filters.fromDate) {
        query.prescriptionDate.$gte = new Date(filters.fromDate);
      }
      if (filters.toDate) {
        query.prescriptionDate.$lte = new Date(filters.toDate);
      }
    }

    return Prescription.find(query)
      .populate("patient", "name UHID age gender contactNumber")
      .populate("doctor", "name specialization department")
      .sort({ prescriptionDate: -1 });
  }

  // Get Prescription by ID
  static async getPrescriptionById(id) {
    const prescription = await Prescription.findById(id)
      .populate("patient")
      .populate("doctor");

    if (!prescription || !prescription.isActive) {
      throw new Error("Prescription not found");
    }

    return prescription;
  }

  // Get Prescriptions by Patient (UHID or ID)
  static async getPrescriptionsByPatient(patientIdentifier) {
    let query = { isActive: true };

    // Check if it's an ObjectId or UHID
    if (mongoose.Types.ObjectId.isValid(patientIdentifier)) {
      query.patient = patientIdentifier;
    } else {
      query.UHID = patientIdentifier.toUpperCase();
    }

    return Prescription.find(query)
      .populate("patient", "name UHID age gender")
      .populate("doctor", "name specialization")
      .sort({ prescriptionDate: -1 });
  }

  // Get Prescriptions by Doctor
  static async getPrescriptionsByDoctor(doctorId) {
    return Prescription.find({ doctor: doctorId, isActive: true })
      .populate("patient", "name UHID age gender")
      .sort({ prescriptionDate: -1 });
  }

  // Update Prescription
  static async updatePrescription(id, data) {
    const prescription = await Prescription.findOne({
      _id: id,
      isActive: true,
    });

    if (!prescription) {
      throw new Error("Prescription not found");
    }

    // Don't allow updating patient or doctor
    delete data.patient;
    delete data.doctor;
    delete data.UHID;

    const updated = await Prescription.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    })
      .populate("patient", "name UHID age gender")
      .populate("doctor", "name specialization");

    return updated;
  }

  // Delete Prescription (Soft delete)
  static async deletePrescription(id) {
    const prescription = await Prescription.findByIdAndUpdate(
      id,
      { isActive: false, status: "Cancelled" },
      { new: true },
    );

    if (!prescription) {
      throw new Error("Prescription not found");
    }

    return prescription;
  }

  // Update Prescription Status
  static async updatePrescriptionStatus(id, status) {
    const validStatuses = ["Active", "Completed", "Cancelled"];
    if (!validStatuses.includes(status)) {
      throw new Error("Invalid status");
    }

    const prescription = await Prescription.findByIdAndUpdate(
      id,
      { status },
      { new: true },
    )
      .populate("patient", "name UHID")
      .populate("doctor", "name");

    if (!prescription) {
      throw new Error("Prescription not found");
    }

    return prescription;
  }

  // Get Prescription Statistics
  static async getPrescriptionStats(filters = {}) {
    const matchQuery = { isActive: true };

    if (filters.doctor) {
      matchQuery.doctor = mongoose.Types.ObjectId(filters.doctor);
    }
    if (filters.fromDate || filters.toDate) {
      matchQuery.prescriptionDate = {};
      if (filters.fromDate) {
        matchQuery.prescriptionDate.$gte = new Date(filters.fromDate);
      }
      if (filters.toDate) {
        matchQuery.prescriptionDate.$lte = new Date(filters.toDate);
      }
    }

    const stats = await Prescription.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalPrescriptions: { $sum: 1 },
          totalServicesAmount: { $sum: "$totalServicesAmount" },
          opdCount: {
            $sum: { $cond: [{ $eq: ["$registrationType", "OPD"] }, 1, 0] },
          },
          ipdCount: {
            $sum: { $cond: [{ $eq: ["$registrationType", "IPD"] }, 1, 0] },
          },
          emergencyCount: {
            $sum: {
              $cond: [{ $eq: ["$registrationType", "Emergency"] }, 1, 0],
            },
          },
        },
      },
    ]);

    return (
      stats[0] || {
        totalPrescriptions: 0,
        totalServicesAmount: 0,
        opdCount: 0,
        ipdCount: 0,
        emergencyCount: 0,
      }
    );
  }
}

module.exports = PrescriptionService;
