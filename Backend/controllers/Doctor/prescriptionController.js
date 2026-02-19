const PrescriptionService = require("../../services/Doctor/PrescriptionService");
const Prescription = require("../../models/Doctor/prescription");
// exports.createPrescription = async (req, res) => {
//   try {
//     const prescription = await PrescriptionService.createPrescription(req.body);

//     res.status(201).json({
//       success: true,
//       message: "Prescription created successfully",
//       data: prescription,
//     });
//   } catch (error) {
//     console.error("Error creating prescription:", error);
//     res.status(400).json({
//       success: false,
//       message: error.message,
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
        status: "CREATED",
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





exports.checkCreateOrUpdate = async (req, res) => {
  try {
    const { uhid } = req.params;

    // 🔹 Case 1: UHID hi nahi aaya → CREATE
    if (!uhid) {
      return res.status(200).json({
        success: true,
        status: "OK",
        mode: "CREATE",
        data: null,
        message: "UHID not provided, create new prescription",
      });
    }

    // 🔹 Case 2: UHID aaya → DB check
    const existingPrescription = await Prescription.findOne({ UHID: uhid });

    // 🔹 Case 2a: Prescription already exists → UPDATE
    if (existingPrescription) {
      return res.status(200).json({
        success: true,
        status: "OK",
        mode: "UPDATE",
        data: existingPrescription,
        message: "Prescription found, update mode",
      });
    }

    // 🔹 Case 2b: Prescription nahi mila → CREATE
    return res.status(200).json({
      success: true,
      status: "OK",
      mode: "CREATE",
      data: null,
      message: "No prescription found, create new",
    });

  } catch (error) {
    console.error("❌ checkCreateOrUpdate error:", error);
    return res.status(500).json({
      success: false,
      status: "ERROR",
      message: error.message,
    });
  }
};



// Get All Prescriptions
exports.getAllPrescriptions = async (req, res) => {
  try {
    const prescriptions = await PrescriptionService.getAllPrescriptions(
      req.query,
    );

    res.status(200).json({
      success: true,
      count: prescriptions.length,
      data: prescriptions,
    });
  } catch (error) {
    console.error("Error fetching prescriptions:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get Prescription by ID
exports.getPrescriptionById = async (req, res) => {
  try {
    const prescription = await PrescriptionService.getPrescriptionById(
      req.params.id,
    );

    res.status(200).json({
      success: true,
      data: prescription,
    });
  } catch (error) {
    console.error("Error fetching prescription:", error);
    res.status(error.message === "Prescription not found" ? 404 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getPrescriptionByUHID = async (req, res) => {
  try {
    const prescription = await PrescriptionService.getPrescriptionByUHID(
      req.params.uhid,
    );

    res.status(200).json({
      success: true,
      data: prescription,
    });
  } catch (error) {
    console.error("Error fetching prescription:", error);
    res.status(error.message === "Prescription not found" ? 404 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get Prescriptions by Patient (UHID or ID)
exports.getPrescriptionsByPatient = async (req, res) => {
  try {
    const prescriptions = await PrescriptionService.getPrescriptionsByPatient(
      req.params.patientIdentifier,
    );

    res.status(200).json({
      success: true,
      count: prescriptions.length,
      data: prescriptions,
    });
  } catch (error) {
    console.error("Error fetching patient prescriptions:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get Prescriptions by Doctor
exports.getPrescriptionsByDoctor = async (req, res) => {
  try {
    const prescriptions = await PrescriptionService.getPrescriptionsByDoctor(
      req.params.doctorId,
    );

    res.status(200).json({
      success: true,
      count: prescriptions.length,
      data: prescriptions,
    });
  } catch (error) {
    console.error("Error fetching doctor prescriptions:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Update Prescription
exports.updatePrescription = async (req, res) => {
  try {
    const prescription = await PrescriptionService.updatePrescription(
      req.params.id,
      req.body,
    );

    res.status(200).json({
      success: true,
      message: "Prescription updated successfully",
      data: prescription,
    });
  } catch (error) {
    console.error("Error updating prescription:", error);
    res.status(error.message === "Prescription not found" ? 404 : 400).json({
      success: false,
      message: error.message,
    });
  }
};

// Delete Prescription
exports.deletePrescription = async (req, res) => {
  try {
    await PrescriptionService.deletePrescription(req.params.id);

    res.status(200).json({
      success: true,
      message: "Prescription deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting prescription:", error);
    res.status(error.message === "Prescription not found" ? 404 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

// Update Prescription Status
exports.updatePrescriptionStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const prescription = await PrescriptionService.updatePrescriptionStatus(
      req.params.id,
      status,
    );

    res.status(200).json({
      success: true,
      message: "Prescription status updated successfully",
      data: prescription,
    });
  } catch (error) {
    console.error("Error updating prescription status:", error);
    res.status(error.message === "Prescription not found" ? 404 : 400).json({
      success: false,
      message: error.message,
    });
  }
};

// Get Prescription Statistics
exports.getPrescriptionStats = async (req, res) => {
  try {
    const stats = await PrescriptionService.getPrescriptionStats(req.query);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching prescription stats:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = exports;
