const Prescription = require("../../models/Doctor/prescription");
const Patient = require("../../models/Patient/patientModel");
const Doctor = require("../../models/Doctor/doctorModel");

// exports.createPrescription = async (req, res) => {
//   try {
//     const data = req.body;

//     // 🔍 Validate patient
//     const patient = await Patient.findById(data.patient);
//     if (!patient) {
//       return res.status(404).json({
//         success: false,
//         message: "Patient not found",
//       });
//     }

//     // 🔥 Build clean prescription object
//     const prescriptionPayload = {
//       // IDs
//       patient: patient._id,
//       UHID: patient.UHID,

//       // AUTO patient info
//       patientName: patient.fullName,
//       age: patient.age,
//       gender: patient.gender,
//       contactNumber: patient.contactNumber,
//       fatherName: patient.fatherName || "",
//       department: patient.department?.departmentName || "",

//       // doctor
//       doctor: data.doctor,
//       referredBy: data.referredBy || "",

//       registrationType: data.registrationType || "OPD",

//       clinicalDetails: data.clinicalDetails,
//       vitals: data.vitals,
//       provisionalDiagnosis: data.provisionalDiagnosis,

//       medicines: data.medicines || [],
//       investigations: data.investigations || [],
//       advice: data.advice || "",
//     };

//     // 💾 Save
//     const prescription = await Prescription.create(prescriptionPayload);

//     // 📦 Populate for response only
//     await prescription.populate([
//       { path: "patient", select: "fullName UHID gender age" },
//       {
//         path: "doctor",
//         select:
//           "personalInfo.firstName personalInfo.lastName professional.specialization",
//       },
//       { path: "investigations", select: "Name" },
//     ]);

//     res.status(201).json({
//       success: true,
//       message: "Prescription created successfully",
//       data: prescription,
//     });
//   } catch (error) {
//     console.error("Create prescription error:", error);
//     res.status(500).json({
//       success: false,
//       message: error.message || "Failed to create prescription",
//     });
//   }
// };

exports.createPrescription = async (req, res) => {
  try {
    const { uhid } = req.params;

    if (!uhid) {
      return res.status(400).json({
        success: false,
        status: "ERROR",
        message: "UHID is required in params",
      });
    }

    const data = req.body;

    // 🔴 Required fields check (minimum)
    if (!data.patient || !data.doctor || !data.provisionalDiagnosis) {
      return res.status(400).json({
        success: false,
        status: "ERROR",
        message: "Required fields missing",
      });
    }

    // 🔍 Check existing prescription by UHID
    const existingPrescription = await Prescription.findOne({ UHID: uhid });

    // 🔒 FINAL lock check
    if (existingPrescription && existingPrescription.status === "FINAL") {
      return res.status(400).json({
        success: false,
        status: "FINAL",
        message: "Prescription already printed and locked",
      });
    }

    // 🧾 Common payload (schema aligned)
    const prescriptionPayload = {
      // IDs
      patient: data.patient,
      UHID: uhid,

      // AUTO patient info
      patientName: data.patientName,
      age: data.age,
      gender: data.gender,
      contactNumber: data.contactNumber,
      fatherName: data.fatherName || "",
      department: data.department || "",

      // doctor
      doctor: data.doctor,
      referredBy: data.referredBy || "",

      registrationType: data.registrationType || "OPD",

      clinicalDetails: data.clinicalDetails,
      vitals: data.vitals,
      provisionalDiagnosis: data.provisionalDiagnosis,

      medicines: data.medicines || [],
      investigations: data.investigations || [],
      advice: data.advice || "",

      updatedAt: new Date(),
    };

    // 🆕 CREATE
    if (!existingPrescription) {
      await Prescription.create({
        ...prescriptionPayload,
        status: "DRAFT",
      });

      return res.status(201).json({
        success: true,
        status: "CREATED",
        message: "Prescription created successfully",
      });
    }

    // ✏️ UPDATE
    await Prescription.findOneAndUpdate({ UHID: uhid }, prescriptionPayload, {
      new: true,
    });

    return res.status(200).json({
      success: true,
      status: "UPDATED",
      message: "Prescription updated successfully",
    });
  } catch (error) {
    console.error("❌ upsertPrescription error:", error);

    res.status(500).json({
      success: false,
      status: "ERROR",
      message: error.message,
    });
  }
};

exports.getAllPrescriptions = async (req, res) => {
  try {
    const { patient, doctor, registrationType, startDate, endDate } = req.query;

    const filter = {};
    if (patient) filter.patient = patient;
    if (doctor) filter.doctor = doctor;
    if (registrationType) filter.registrationType = registrationType;
    if (startDate && endDate) {
      filter.prescriptionDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const prescriptions = await Prescription.find(filter)
      .populate("patient", "fullName UHID gender age")
      .populate(
        "doctor",
        "personalInfo.firstName personalInfo.lastName professional.specialization",
      )
      .populate("investigations", "Name")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: prescriptions,
      count: prescriptions.length,
    });
  } catch (error) {
    console.error("Get prescriptions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch prescriptions",
    });
  }
};

exports.getPrescriptionById = async (req, res) => {
  try {
    const prescription = await Prescription.findById(req.params.id)
      .populate("patient")
      .populate("doctor")
      .populate("investigations");

    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: "Prescription not found",
      });
    }

    res.status(200).json({
      success: true,
      data: prescription,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch prescription",
    });
  }
};

exports.getPrescriptionsByUHID = async (req, res) => {
  try {
    const { uhid } = req.params;

    const prescriptions = await Prescription.find({ UHID: uhid })
      .populate(
        "doctor",
        "personalInfo.firstName personalInfo.lastName professional.specialization",
      )
      .populate("investigations", "Name")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: prescriptions,
      count: prescriptions.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch prescriptions",
    });
  }
};

exports.updatePrescription = async (req, res) => {
  try {
    const prescription = await Prescription.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true },
    ).populate(["patient", "doctor", "investigations"]);

    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: "Prescription not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Prescription updated successfully",
      data: prescription,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update prescription",
    });
  }
};

exports.deletePrescription = async (req, res) => {
  try {
    const prescription = await Prescription.findByIdAndDelete(req.params.id);

    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: "Prescription not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Prescription deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete prescription",
    });
  }
};
