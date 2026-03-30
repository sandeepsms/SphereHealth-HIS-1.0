// controllers/Patient/patientController.js
const patientService = require("../../services/Patient/patientService");

exports.createPatient = async (req, res) => {
  try {
    const patient = await patientService.createPatient(req.body);
    res
      .status(201)
      .json({
        success: true,
        message: "Patient registered successfully",
        data: patient,
      });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Patient with this contact number already exists",
        });
    }
    const statusCode = error.message.includes("not found") ? 404 : 400;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

exports.getAllPatients = async (req, res) => {
  try {
    const result = await patientService.getAllPatients(req.query);
    res.status(200).json({
      success: true,
      data: result.patients,
      totalPages: result.totalPages,
      currentPage: result.currentPage,
      totalPatients: result.totalPatients,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ NEW: Search patients endpoint
// GET /api/patients/search?q=rahul&limit=10
exports.searchPatients = async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search term must be at least 2 characters",
        data: [],
      });
    }

    const patients = await patientService.searchPatients(q.trim(), limit);

    // Frontend ke liye clean format
    // const formatted = patients.map((p) => ({
    //   _id: p._id,
    //   UHID: p.UHID,
    //   title:p.title,
    //   fullName: p.fullName,
    //   contactNumber: p.contactNumber,
    //   email: p.email || "",
    //   gender: p.gender,
    //   dateOfBirth: p.dateOfBirth,
    //   bloodGroup: p.bloodGroup,
    //   department: p.department,
    //   doctor: p.doctor,
    //   tpa: p.tpa,
    //   registrationType: p.registrationType,
    //   address: p.address,
    //   // Dropdown ke liye label/value
    //   label: `${p.fullName} | ${p.UHID} | ${p.contactNumber}`,
    //   value: p._id,
    // }));


    const formatted = patients.map((p) => ({
  _id: p._id,
  UHID: p.UHID,

  // Basic Info
  registrationType: p.registrationType || "OPD",
  title: p.title ?? "",
  fullName: p.fullName || "",
  gender: p.gender || "",
  dateOfBirth: p.dateOfBirth || null,
  maritalStatus: p.maritalStatus || "",

  // Contact
  contactNumber: p.contactNumber || "",
  email: p.email || "",

  // Age (agar backend nahi de raha)
  age: p.age || "",

  // Address (safe nested)
  address: {
    completeAddress: p.address?.completeAddress || "",
    pincode: p.address?.pincode || "",
    city: p.address?.city || "",
    state: p.address?.state || "",
    district: p.address?.district || "",
  },

  // Medical
  bloodGroup: p.bloodGroup || "",
  knownAllergies: p.knownAllergies || "",

  // Hospital Info
  tpa: p.tpa || null,
  department: p.department || "",
  doctor: p.doctor || "",

  // MLC
  isMLC: p.isMLC || false,
  mlcNumber: p.mlcNumber || "",

  // Companion
  companionName: p.companionName || "",
  companionRelationship: p.companionRelationship || "",
  companionContact: p.companionContact || "",

  // Appointment
  hasAppointment: p.hasAppointment || false,
  appointmentDate: p.appointmentDate || null,
  appointmentTime: p.appointmentTime || null,

  // Dropdown ke liye
  label: `${p.fullName} | ${p.UHID} | ${p.contactNumber}`,
  value: p._id,
}));
console.log("FORMATTED", JSON.stringify(formatted, null, 2));

    res.status(200).json({
      success: true,
      data: formatted,
      count: formatted.length,
      
    });
    console.log("dddddddddddddd",data);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message, data: [] });
  }
};

exports.getPatientById = async (req, res) => {
  try {
    const patient = await patientService.getPatientById(req.params.id);
    res.status(200).json({ success: true, data: patient });
  } catch (error) {
    const statusCode = error.message === "Patient not found" ? 404 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

exports.getPatientByUHID = async (req, res) => {
  try {
    const patient = await patientService.getPatientByUHID(req.params.uhid);
    res.status(200).json({ success: true, data: patient });
  } catch (error) {
    const statusCode = error.message === "Patient not found" ? 404 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

exports.updatePatient = async (req, res) => {
  try {
    const patient = await patientService.updatePatient(req.params.id, req.body);
    res
      .status(200)
      .json({
        success: true,
        message: "Patient updated successfully",
        data: patient,
      });
  } catch (error) {
    const statusCode = error.message === "Patient not found" ? 404 : 400;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

exports.deletePatient = async (req, res) => {
  try {
    await patientService.deletePatient(req.params.id);
    res
      .status(200)
      .json({ success: true, message: "Patient deleted successfully" });
  } catch (error) {
    const statusCode = error.message === "Patient not found" ? 404 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

exports.getPatientStats = async (req, res) => {
  try {
    const stats = await patientService.getPatientStats();
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPatientsByTPA = async (req, res) => {
  try {
    const result = await patientService.getPatientsByTPA(
      req.params.tpaId,
      req.query,
    );
    res.status(200).json({
      success: true,
      data: result.patients,
      totalPages: result.totalPages,
      currentPage: result.currentPage,
      totalPatients: result.totalPatients,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
