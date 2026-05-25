const doctorService = require("../../services/Doctor/doctorService");

/* ---------------------------------- */
/* Duplicate Key Error Handler */
/* ---------------------------------- */

const handleDuplicateKeyError = (error) => {
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern)[0];
    const value = error.keyValue[field];

    const fieldNames = {
      doctorId: "Doctor ID",
      "professional.registrationNumber": "Registration Number",
      "contact.email": "Email Address",
      "contact.mobileNumber": "Mobile Number",
    };

    const friendlyField = fieldNames[field] || field;

    return `${friendlyField} "${value}" is already registered. Please use a different ${friendlyField.toLowerCase()}.`;
  }

  return error.message;
};

/* ---------------------------------- */
/* Create Doctor */
/* ---------------------------------- */

exports.createDoctor = async (req, res) => {
  try {
    const doctor = await doctorService.createDoctor(req.body);

    res.status(201).json({
      success: true,
      message: "Doctor registered successfully",
      data: doctor,
    });
  } catch (error) {
    console.error("Error creating doctor:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: handleDuplicateKeyError(error),
      });
    }

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);

      return res.status(400).json({
        success: false,
        message: "Validation failed. Please check all required fields.",
        errors,
      });
    }

    res.status(400).json({
      success: false,
      message: error.message || "Failed to create doctor",
    });
  }
};

/* ---------------------------------- */
/* Get All Doctors */
/* ---------------------------------- */

exports.getAllDoctors = async (req, res) => {
  try {
    const { page = 1, limit = 10, ...filters } = req.query;

    const result = await doctorService.getAllDoctors(
      parseInt(page),
      parseInt(limit),
      filters,
    );

    res.status(200).json({
      success: true,
      data: result.doctors,
      pagination: result.pagination,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ---------------------------------- */
/* ---------------------------------- */
/* GET /api/doctors/me — Doctor profile for the logged-in user */
/* ---------------------------------- */
exports.getMyDoctorProfile = async (req, res) => {
  try {
    // R7br: defensive null-check — authenticate() guarantees req.user; if it's
    // missing the bug is upstream. 500 (not 401) so frontend doesn't logout.
    if (!req.user?.id) return res.status(500).json({ success: false, code: "INTERNAL_NO_USER", message: "Internal error — req.user not set" });
    if (req.user.role !== "Doctor")
      return res.status(403).json({ success: false, message: "Only doctor users have a doctor profile" });

    const Doctor = require("../../models/Doctor/doctorModel");
    const doctor = await Doctor.findOne({ loginUserId: req.user.id })
      .populate("department", "departmentName departmentCode")
      .lean();
    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "No linked Doctor record for this user. Ask admin to run seedRoleUsers.",
      });
    }
    return res.json({ success: true, data: doctor });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

/* Get Doctor By ID */
/* ---------------------------------- */

exports.getDoctorById = async (req, res) => {
  try {
    const doctor = await doctorService.getDoctorById(req.params.doctorId);

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    res.status(200).json({
      success: true,
      data: doctor,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ---------------------------------- */
/* Update Doctor */
/* ---------------------------------- */

exports.updateDoctor = async (req, res) => {
  try {
    const doctor = await doctorService.updateDoctor(
      req.params.doctorId,
      req.body,
    );

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Doctor updated successfully",
      data: doctor,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: handleDuplicateKeyError(error),
      });
    }

    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/* ---------------------------------- */
/* Delete Doctor */
/* ---------------------------------- */

exports.deleteDoctor = async (req, res) => {
  try {
    const doctor = await doctorService.deleteDoctor(req.params.doctorId);

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Doctor deactivated successfully",
      data: doctor,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/* ---------------------------------- */
/* Remaining Methods */
/* ---------------------------------- */

exports.getActiveDoctors = async (req, res) => {
  try {
    const doctors = await doctorService.getActiveDoctors();
    res.status(200).json({ success: true, data: doctors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.searchDoctors = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "Search term is required",
      });
    }

    const doctors = await doctorService.searchDoctors(q);

    res.status(200).json({
      success: true,
      data: doctors,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDoctorsByDepartment = async (req, res) => {
  try {
    const doctors = await doctorService.getDoctorsByDepartment(
      req.params.department,
    );

    res.status(200).json({ success: true, data: doctors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDoctorsBySpecialization = async (req, res) => {
  try {
    const doctors = await doctorService.getDoctorsBySpecialization(
      req.params.specialization,
    );

    res.status(200).json({ success: true, data: doctors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDoctorsByExperience = async (req, res) => {
  try {
    const { minExperience = 0 } = req.query;

    const doctors = await doctorService.getDoctorsByExperience(
      parseInt(minExperience),
    );

    res.status(200).json({ success: true, data: doctors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateConsultationFee = async (req, res) => {
  try {
    // R7dp — Accept any subset of opd/opdFirst/opdFollowup/emergency/mlc/ipdCrossConsult
    // in the body. The service validates each key and only updates the
    // ones present, so the receptionist UI can save a single field at a
    // time without nuking the others.
    const doctor = await doctorService.updateConsultationFee(req.params.doctorId, req.body || {});

    res.status(200).json({
      success: true,
      message: "Consultation fee updated successfully",
      data: doctor,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// R7dp — First-visit detection for receptionist OPD billing.
// Receptionist picks a doctor → we tell them whether this patient has
// EVER seen this specific doctor before, and return the right fee.
// Business rule (per user): patient ↔ doctor relationship is the key,
// not patient ↔ department. If they've seen Dr Sandeep before, next
// visit is followup. If they want a different doctor (same or other
// dept), that's a first visit with the new doctor.
exports.getFirstVisitStatus = async (req, res) => {
  try {
    const { doctorId, patientId } = req.params;
    if (!doctorId || !patientId) {
      return res.status(400).json({ success: false, message: "doctorId and patientId required" });
    }
    const Doctor = require("../../models/Doctor/doctorModel");
    // OPDModels.js exports the model directly (default export)
    const OPDRegistration = require("../../models/Patient/OPDModels");
    // Load doctor + fee schedule.
    const doctor = await Doctor.findById(doctorId).select("consultationFee personalInfo.firstName personalInfo.lastName").lean();
    if (!doctor) return res.status(404).json({ success: false, message: "Doctor not found" });
    // Find any prior OPD visit for THIS patient with THIS doctor.
    // patientId on OPDModels references the Patient master collection.
    const prior = await OPDRegistration.findOne({
      doctorId,
      patientId,
    }).sort({ visitDate: -1, createdAt: -1 }).select("visitDate createdAt").lean();

    const fees = doctor.consultationFee || {};
    const isFirst = !prior;
    res.json({
      success: true,
      data: {
        isFirstVisit: isFirst,
        hasMetThisDoctor: !!prior,
        lastVisitWithThisDoctor: prior ? (prior.visitDate || prior.createdAt) : null,
        suggestedFee: isFirst
          ? (Number(fees.opdFirst) || Number(fees.opd) || 0)
          : (Number(fees.opdFollowup) || Number(fees.opd) || 0),
        feeType: isFirst ? "opdFirst" : "opdFollowup",
        // Echo back the full fee sheet so the UI can let the receptionist
        // see all 5 rates if they need to override (e.g. MLC, IPD cross).
        allFees: {
          opdFirst:        Number(fees.opdFirst)        || Number(fees.opd) || 0,
          opdFollowup:     Number(fees.opdFollowup)     || 0,
          emergency:       Number(fees.emergency)       || 0,
          mlc:             Number(fees.mlc)             || 0,
          ipdCrossConsult: Number(fees.ipdCrossConsult) || 0,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDoctorStats = async (req, res) => {
  try {
    const stats = await doctorService.getDoctorStats(req.params.doctorId);

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/* ─────────────────────────────────────────────────────────────
   DOCTOR AVAILABILITY — set / get / increment-now-serving
───────────────────────────────────────────────────────────── */

const Doctor = require("../../models/Doctor/doctorModel");
const OPDRegistration = require("../../models/Patient/OPDModels");

// PATCH /api/doctors/:doctorId/availability
// Body: { status: "Available"|"InConsultation"|"OnBreak"|"OnLeave"|"Offline", note: "..." }
exports.setAvailability = async (req, res) => {
  try {
    const { status, note } = req.body;
    const valid = ["Available", "InConsultation", "OnBreak", "OnLeave", "Offline"];
    if (status && !valid.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const doctor = await Doctor.findById(req.params.doctorId);
    if (!doctor) return res.status(404).json({ success: false, message: "Doctor not found" });
    if (!doctor.availability) doctor.availability = {};
    if (status !== undefined) doctor.availability.status = status;
    if (note   !== undefined) doctor.availability.note   = note;
    doctor.availability.updatedAt = new Date();
    await doctor.save();
    res.json({ success: true, data: doctor.availability });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// POST /api/doctors/:doctorId/serve-next
// Increment currentlyServing token (called when doctor clicks "Next patient")
exports.serveNextToken = async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.params.doctorId);
    if (!doctor) return res.status(404).json({ success: false, message: "Doctor not found" });
    if (!doctor.availability) doctor.availability = {};
    doctor.availability.currentlyServing = (doctor.availability.currentlyServing || 0) + 1;
    doctor.availability.status = "InConsultation";
    doctor.availability.updatedAt = new Date();
    await doctor.save();
    res.json({ success: true, data: doctor.availability });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ─────────────────────────────────────────────────────────────
   RECEPTION DASHBOARD — live doctor strip
   Returns each active doctor with their queue stats for today.
───────────────────────────────────────────────────────────── */
// GET /api/doctors/dashboard/queues
exports.getDashboardQueues = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const doctors = await Doctor.find({ isActive: true })
      .populate("department", "departmentName departmentCode")
      .lean();

    // Aggregate today's tokens per doctor
    const Mongoose = require("mongoose");
    const tokenCounts = await OPDRegistration.aggregate([
      { $match: { visitDate: { $gte: today, $lt: tomorrow }, doctorId: { $exists: true, $ne: null } } },
      { $group: {
          _id: "$doctorId",
          totalTokens: { $sum: 1 },
          maxToken:    { $max: "$tokenNumber" },
      } },
    ]);
    const byDoctor = {};
    tokenCounts.forEach(t => { byDoctor[String(t._id)] = t; });

    const rows = doctors.map(d => {
      const stats = byDoctor[String(d._id)] || { totalTokens: 0, maxToken: 0 };
      const serving = d.availability?.currentlyServing || 0;
      const waiting = Math.max(stats.totalTokens - serving, 0);
      return {
        _id:               d._id,
        doctorId:          d.doctorId,
        fullName:          d.personalInfo?.fullName,
        specialization:    d.professional?.specialization,
        department:        d.department?.departmentName,
        availability:      d.availability || { status: "Offline", note: "", currentlyServing: 0 },
        todayTokensIssued: stats.totalTokens,
        currentlyServing:  serving,
        waiting,
        nextToken:         stats.maxToken + 1,
      };
    });

    res.json({ success: true, date: today.toISOString().slice(0, 10), data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
