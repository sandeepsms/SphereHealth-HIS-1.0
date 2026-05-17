const PrescriptionService = require("../../services/Doctor/PrescriptionService");
const Prescription = require("../../models/Doctor/prescription");

// ── CREATE / UPDATE (upsert by UHID) ─────────────────────────
exports.createPrescription = async (req, res) => {
  try {
    const { uhid } = req.params;
    if (!uhid)
      return res
        .status(400)
        .json({ success: false, message: "UHID required in params" });

    const data = req.body;
    if (!data.patient || !data.doctor || !data.provisionalDiagnosis) {
      return res
        .status(400)
        .json({
          success: false,
          message: "patient, doctor, provisionalDiagnosis are required",
        });
    }

    const existing = await Prescription.findOne({ UHID: uhid });

    if (existing?.status === "FINAL") {
      return res
        .status(400)
        .json({
          success: false,
          status: "FINAL",
          message: "Prescription is locked",
        });
    }

    const payload = {
      patient: data.patient,
      UHID: uhid,
      patientName: data.patientName || "",
      age: data.age,
      gender: data.gender || "",
      contactNumber: data.contactNumber || "",
      fatherName: data.fatherName || "",
      department: data.department || "",
      doctor: data.doctor,
      doctorName: data.doctorName || "",
      referredBy: data.referredBy || "",
      registrationType: data.registrationType || "OPD",
      clinicalDetails: data.clinicalDetails || {},
      vitals: data.vitals || {},
      provisionalDiagnosis: data.provisionalDiagnosis,
      medicines: data.medicines || [],
      investigations: data.investigations || [],
      selectedServices: data.selectedServices || [],
      advice: data.advice || "",
    };

    if (!existing) {
      const prescription = await PrescriptionService.createPrescription({
        ...payload,
        status: "CREATED",
      });
      return res
        .status(201)
        .json({
          success: true,
          status: "CREATED",
          message: "Prescription created",
          data: prescription,
        });
    }

    // Plumb actor so the service writes a PatientActivityLog row with
    // who-what-when on every prescription edit (audit A-11).
    const updated = await PrescriptionService.updatePrescriptionByUHID(
      uhid,
      {
        ...payload,
        actor: {
          id:   req.user?.id   || req.user?._id   || null,
          name: req.user?.name || req.user?.fullName || null,
          role: req.user?.role || null,
        },
      },
    );
    return res
      .status(200)
      .json({
        success: true,
        status: "UPDATED",
        message: "Prescription updated",
        data: updated,
      });
  } catch (error) {
    console.error("createPrescription error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── CHECK CREATE OR UPDATE ────────────────────────────────────
exports.checkCreateOrUpdate = async (req, res) => {
  try {
    const { uhid } = req.params;
    if (!uhid)
      return res
        .status(200)
        .json({ success: true, mode: "CREATE", data: null });

    const existing = await Prescription.findOne({ UHID: uhid }).populate(
      "investigations.investigationId",
      "investigationName investigationCode defaultPrice",
    );

    if (existing)
      return res
        .status(200)
        .json({ success: true, mode: "UPDATE", data: existing });
    return res.status(200).json({ success: true, mode: "CREATE", data: null });
  } catch (error) {
    console.error("checkCreateOrUpdate error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET ALL ───────────────────────────────────────────────────
exports.getAllPrescriptions = async (req, res) => {
  try {
    const data = await PrescriptionService.getAllPrescriptions(req.query);
    res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET BY ID ─────────────────────────────────────────────────
exports.getPrescriptionById = async (req, res) => {
  try {
    const data = await PrescriptionService.getPrescriptionById(req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res
      .status(error.message === "Prescription not found" ? 404 : 500)
      .json({ success: false, message: error.message });
  }
};

// ── GET BY UHID ───────────────────────────────────────────────
exports.getPrescriptionByUHID = async (req, res) => {
  try {
    const data = await PrescriptionService.getPrescriptionByUHID(
      req.params.uhid,
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res
      .status(error.message === "Prescription not found" ? 404 : 500)
      .json({ success: false, message: error.message });
  }
};

// ── GET BY PATIENT ────────────────────────────────────────────
exports.getPrescriptionsByPatient = async (req, res) => {
  try {
    const data = await PrescriptionService.getPrescriptionsByPatient(
      req.params.patientIdentifier,
    );
    res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET BY DOCTOR ─────────────────────────────────────────────
exports.getPrescriptionsByDoctor = async (req, res) => {
  try {
    const data = await PrescriptionService.getPrescriptionsByDoctor(
      req.params.doctorId,
    );
    res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── UPDATE ────────────────────────────────────────────────────
exports.updatePrescription = async (req, res) => {
  try {
    const data = await PrescriptionService.updatePrescription(
      req.params.id,
      req.body,
    );
    res.status(200).json({ success: true, message: "Updated", data });
  } catch (error) {
    res
      .status(error.message === "Prescription not found" ? 404 : 400)
      .json({ success: false, message: error.message });
  }
};

// ── DELETE ────────────────────────────────────────────────────
exports.deletePrescription = async (req, res) => {
  try {
    // Plumb actor for audit-log (R9 re-audit follow-up A-11).
    await PrescriptionService.deletePrescription(req.params.id, {
      id:   req.user?.id   || req.user?._id   || null,
      name: req.user?.name || req.user?.fullName || null,
      role: req.user?.role || null,
    });
    res.status(200).json({ success: true, message: "Deleted" });
  } catch (error) {
    res
      .status(error.message === "Prescription not found" ? 404 : 500)
      .json({ success: false, message: error.message });
  }
};

// ── UPDATE STATUS ─────────────────────────────────────────────
exports.updatePrescriptionStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status)
      return res
        .status(400)
        .json({ success: false, message: "Status required" });
    const data = await PrescriptionService.updatePrescriptionStatus(
      req.params.id,
      status,
      {
        id:   req.user?.id   || req.user?._id   || null,
        name: req.user?.name || req.user?.fullName || null,
        role: req.user?.role || null,
      },
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    res
      .status(error.message === "Prescription not found" ? 404 : 400)
      .json({ success: false, message: error.message });
  }
};

// ── STATS ─────────────────────────────────────────────────────
exports.getPrescriptionStats = async (req, res) => {
  try {
    const data = await PrescriptionService.getPrescriptionStats(req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;
