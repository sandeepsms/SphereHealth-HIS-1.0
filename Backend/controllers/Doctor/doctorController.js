const doctorService = require("../../services/Doctor/doctorService");
const sendErr = require("../../utils/sendErr");

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

    // R7hr-52 — Compute effectiveStatus per doctor from real-world signals.
    // The receptionist's Live Queue dropdown only sets availability.status to
    // "Available" or "OnLeave" (binary on-duty toggle, R7hr-52). The third
    // surface — "InConsultation" — must be derived because the doctor doesn't
    // touch the dropdown when they start seeing a patient; OPD.status flipping
    // to "In Progress" IS the signal. Priority order:
    //   1. OnLeave  (off-duty wins absolutely)
    //   2. Offline  (legacy/admin off-duty)
    //   3. InConsultation  (any OPD visit today with status="In Progress")
    //   4. Available
    // This is computed at fetch time so the Live Queue always reflects the
    // current consultation state without any stale-flag bug.
    //
    // IMPORTANT: doctorService.getAllDoctors() returns Mongoose documents
    // (not .lean()), and Mongoose silently drops nested-key assignments to
    // sub-paths that aren't in the schema (effectiveStatus is derived, not
    // persisted). We therefore convert each doc to a plain object first,
    // then mutate, then ship that array — guaranteeing JSON includes the
    // derived fields. We do NOT add the field to the schema because it's a
    // runtime view, not stored state.
    let docsOut = result.doctors || [];
    try {
      const OPD = require("../../models/Patient/OPDModels");
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd   = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
      const inProgress = await OPD.aggregate([
        { $match: {
            doctorId: { $in: docsOut.map(d => d._id) },
            visitDate: { $gte: todayStart, $lt: todayEnd },
            status: "In Progress",
        } },
        { $group: { _id: "$doctorId", n: { $sum: 1 } } },
      ]);
      const inProgressMap = new Map(inProgress.map(r => [String(r._id), r.n]));
      docsOut = docsOut.map(d => {
        // toObject if Mongoose doc, else clone — handles both shapes
        const plain = typeof d.toObject === "function" ? d.toObject() : { ...d };
        const stored = plain.availability?.status || "Available";
        let effective;
        if (stored === "OnLeave")            effective = "OnLeave";
        else if (stored === "Offline")       effective = "Offline";
        else if (inProgressMap.has(String(plain._id))) effective = "InConsultation";
        else                                  effective = "Available";
        plain.availability = {
          ...(plain.availability || {}),
          effectiveStatus: effective,
          inProgressCount: inProgressMap.get(String(plain._id)) || 0,
        };
        return plain;
      });
    } catch (e) {
      // Best-effort — never block doctor list rendering on the derivation step
      console.warn("[getAllDoctors] R7hr-52 effectiveStatus derivation failed:", e.message);
    }

    res.status(200).json({
      success: true,
      data: docsOut,
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
    return sendErr(res, e);
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
    // Full enum kept for system writes (serveNextToken sets InConsultation).
    const valid = ["Available", "InConsultation", "OnBreak", "OnLeave", "Offline"];
    if (status && !valid.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    // R7hr-52 — Receptionists may only toggle Available ↔ OnLeave from the
    // Live Queue dropdown. "InConsultation" is auto-derived from in-progress
    // OPD visits at list time (see effectiveStatus in getAllDoctors). The
    // other historical statuses (OnBreak / Offline) are retained at the
    // schema level for legacy / admin use but are NOT user-settable from
    // reception — collapsing the dropdown to two options removes the
    // "what does Offline vs OnBreak vs OnLeave really mean" cognitive cost
    // for front-desk staff and makes the on-duty signal binary.
    if (req.user?.role === "Receptionist" && status && !["Available", "OnLeave"].includes(status)) {
      return res.status(403).json({
        success: false,
        message: `Receptionist may only set Available or OnLeave. "${status}" is auto-derived or admin-only.`,
        code: "RECEPTIONIST_LIMITED_AVAILABILITY",
      });
    }
    // R7hr-215 (RBAC audit) — a Doctor may only set their OWN availability.
    // The route comment promised this ("Doctor can't flip someone else's
    // availability") but the controller never enforced it, so Dr. A could mark
    // Dr. B OnLeave and disrupt their live queue. Admin + Receptionist (already
    // limited to Available/OnLeave above) keep their cross-doctor desk control.
    if (req.user?.role === "Doctor") {
      const meId = req.doctorProfile?._id
        || (await Doctor.findOne({ loginUserId: req.user.id }).select("_id").lean())?._id;
      if (!meId || String(meId) !== String(req.params.doctorId)) {
        return res.status(403).json({ success: false, code: "NOT_OWN_DOCTOR_PROFILE",
          message: "You can only change your own availability." });
      }
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
    sendErr(res, e);
  }
};

// POST /api/doctors/:doctorId/serve-next
// Increment currentlyServing token (called when doctor clicks "Next patient")
exports.serveNextToken = async (req, res) => {
  try {
    // R7hr-215 (RBAC audit) — only the doctor themself (or Admin) may advance
    // their own queue. Without this any Doctor could inflate another doctor's
    // currentlyServing counter and desync their token board.
    if (req.user?.role === "Doctor") {
      const meId = req.doctorProfile?._id
        || (await Doctor.findOne({ loginUserId: req.user.id }).select("_id").lean())?._id;
      if (!meId || String(meId) !== String(req.params.doctorId)) {
        return res.status(403).json({ success: false, code: "NOT_OWN_DOCTOR_PROFILE",
          message: "You can only advance your own queue." });
      }
    }
    const doctor = await Doctor.findById(req.params.doctorId);
    if (!doctor) return res.status(404).json({ success: false, message: "Doctor not found" });
    if (!doctor.availability) doctor.availability = {};
    doctor.availability.currentlyServing = (doctor.availability.currentlyServing || 0) + 1;
    doctor.availability.status = "InConsultation";
    doctor.availability.updatedAt = new Date();
    await doctor.save();
    res.json({ success: true, data: doctor.availability });
  } catch (e) {
    sendErr(res, e);
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
    sendErr(res, e);
  }
};
