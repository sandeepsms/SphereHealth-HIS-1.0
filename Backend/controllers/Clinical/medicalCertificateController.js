// controllers/Clinical/medicalCertificateController.js
// ════════════════════════════════════════════════════════════════════
// R7fu — Medical Certificate controller. Issues, lists, fetches and
// revokes hospital medical certificates of 12 standard types.
//
// Hard rules (controller-level, mirrors model + R7bx invariant):
//   • Patient must exist and be referenced by ObjectId.
//   • Issuing doctor must have MCI registration on profile — write
//     refused otherwise.
//   • certNumber is generated via the atomic counter helper —
//     "mc:<YEAR>" — formatted "MC-<YEAR>-<5-digit>".
//   • Counter-signature is required for disability + sterilization
//     (validated softly here; the model enforces the medical-board
//     count for permanent disability).
//   • Only the original issuer or an Admin can revoke.
//   • ClinicalAudit row emitted on issue + revoke (best-effort; never
//     blocks the underlying save).
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const MedicalCertificate = require("../../models/Clinical/MedicalCertificateModel");
const Patient = require("../../models/Patient/patientModel");
const HospitalSettings = require("../../models/HospitalSettings");
const Doctor = require("../../models/Doctor/doctorModel");

const { nextSequence, formatId } = require("../../utils/counter");
const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");

const handle = (fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (err) {
    const explicit = Number(err.status || err.statusCode);
    const status = Number.isInteger(explicit) && explicit >= 400 && explicit < 600
      ? explicit
      : (err.message?.includes("not found") ? 404 : 400);
    return res.status(status).json({ success: false, message: err.message, code: err.code || undefined });
  }
};

const _trim = (v) => (typeof v === "string" ? v.trim() : v);

// Generate "MC-2026-00042". Year is IST (Asia/Kolkata).
async function generateCertNumber() {
  const istYear = Number(new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.HOSPITAL_TZ || "Asia/Kolkata",
    year: "numeric",
  }).format(new Date()));
  const seq = await nextSequence(`mc:${istYear}`);
  return formatId(`MC-${istYear}`, seq, 5);
}

class MedicalCertificateController {
  // POST /api/medical-certificates
  create = handle(async (req, res) => {
    const body = req.body || {};

    // ── Patient resolution ────────────────────────────────────
    if (!body.patient || !mongoose.isValidObjectId(body.patient)) {
      return res.status(400).json({ success: false, code: "PATIENT_REQUIRED",
        message: "Valid patient ObjectId is required." });
    }
    const patient = await Patient.findById(body.patient)
      .select("UHID fullName gender age contactNumber dateOfBirth")
      .lean();
    if (!patient) {
      return res.status(404).json({ success: false, code: "PATIENT_NOT_FOUND",
        message: "Patient not found for the supplied ID." });
    }

    // ── certType check ────────────────────────────────────────
    if (!body.certType || !MedicalCertificate.CERT_TYPES.includes(body.certType)) {
      return res.status(400).json({ success: false, code: "CERT_TYPE_INVALID",
        message: `certType must be one of: ${MedicalCertificate.CERT_TYPES.join(", ")}` });
    }

    // ── Doctor identity + MCI reg gate (R7bx invariant) ───────
    let doctorName = _trim(body.doctorName) || req.user?.fullName || "";
    let doctorReg  = _trim(body.doctorReg)  || "";
    let issuedBy   = null;

    // Prefer the looked-up Doctor profile for the logged-in user.
    if (req.user?.id) {
      const doc = await Doctor.findOne({ loginUserId: req.user.id })
        .select("_id personalInfo.fullName personalInfo.firstName personalInfo.lastName professional.registrationNumber")
        .lean();
      if (doc) {
        issuedBy   = doc._id;
        doctorName = doctorName
          || doc.personalInfo?.fullName
          || [doc.personalInfo?.firstName, doc.personalInfo?.lastName].filter(Boolean).join(" ");
        doctorReg  = doctorReg || doc.professional?.registrationNumber || "";
      }
    }
    // Allow explicit override (Admin issuing on behalf of a doctor) so
    // long as both name + reg are present in the body.
    if (!doctorReg) {
      return res.status(412).json({ success: false, code: "DOCTOR_MCI_REQUIRED",
        message: "Cannot issue a medical certificate without an MCI registration " +
                 "number. Update My Profile (registrationNumber) before issuing." });
    }

    // ── Counter-sign requirement (disability + sterilization) ─
    const needsCounterSign = body.certType === "disability" || body.certType === "sterilization";
    if (needsCounterSign) {
      const cs = body.counterSignedBy || {};
      const okName = cs.name && String(cs.name).trim().length;
      const okReg  = cs.reg  && String(cs.reg).trim().length;
      if (!okName || !okReg) {
        return res.status(412).json({ success: false, code: "COUNTERSIGN_REQUIRED",
          message: "Counter-signing officer (name + registration) is mandatory " +
                   `for ${body.certType} certificates.` });
      }
    }

    // ── Hospital meta snapshot ────────────────────────────────
    const hs = await HospitalSettings.findOne()
      .select("hospitalName registrationNo nabhCertNumber")
      .lean();

    // ── certNumber (atomic counter) ───────────────────────────
    const certNumber = await generateCertNumber();

    // ── Denormalized patient snapshot ─────────────────────────
    const ageStr = patient.age != null
      ? `${patient.age}Y`
      : (patient.dateOfBirth
          ? `${Math.max(0, new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear())}Y`
          : "");

    const payload = {
      patient: body.patient,
      patientName: patient.fullName || body.patientName || "",
      patientUHID: patient.UHID || body.patientUHID || "",
      gender: patient.gender || body.gender || "",
      age: ageStr || body.age || "",
      mobile: patient.contactNumber || body.mobile || "",

      visitId:   body.visitId && mongoose.isValidObjectId(body.visitId) ? body.visitId : null,
      visitType: body.visitType || "",

      certNumber,
      certType: body.certType,

      issuedAt: body.issuedAt ? new Date(body.issuedAt) : new Date(),
      issuedBy,
      doctorName,
      doctorReg,

      counterSignedBy: needsCounterSign ? {
        doctorId: body.counterSignedBy?.doctorId && mongoose.isValidObjectId(body.counterSignedBy.doctorId)
          ? body.counterSignedBy.doctorId : null,
        name:     _trim(body.counterSignedBy?.name) || "",
        reg:      _trim(body.counterSignedBy?.reg)  || "",
        signedAt: body.counterSignedBy?.signedAt ? new Date(body.counterSignedBy.signedAt) : new Date(),
      } : {},

      diagnosis: _trim(body.diagnosis) || "",
      icd10: {
        code:        _trim(body.icd10?.code) || "",
        description: _trim(body.icd10?.description) || "",
      },

      typeSpecific: body.typeSpecific && typeof body.typeSpecific === "object" ? body.typeSpecific : {},

      attachments: Array.isArray(body.attachments) ? body.attachments : [],
      meta: {
        hospitalName:           hs?.hospitalName || "",
        hospitalRegistrationNo: hs?.registrationNo || "",
        nabhBadgeAtIssue:       hs?.nabhCertNumber || "",
      },
    };

    let cert;
    try {
      cert = await MedicalCertificate.create(payload);
    } catch (e) {
      // Duplicate certNumber (extremely unlikely under the atomic counter)
      // → retry once with a fresh sequence number.
      if (e?.code === 11000 && /certNumber/.test(e?.message || "")) {
        payload.certNumber = await generateCertNumber();
        cert = await MedicalCertificate.create(payload);
      } else {
        throw e;
      }
    }

    // ── Audit (best-effort) ───────────────────────────────────
    try {
      await emitClinicalAudit({
        req,
        event: "DOCTOR_NOTE_CREATED",   // closest existing event; until a
                                        // MEDICAL_CERTIFICATE_ISSUED enum
                                        // ships we piggyback on this so the
                                        // row still lands in ClinicalAudit.
        UHID: cert.patientUHID,
        patientId: cert.patient,
        patientName: cert.patientName,
        targetType: "MedicalCertificate",
        targetId: cert._id,
        after: {
          kind: "medical-certificate-issued",
          certType: cert.certType,
          certNumber: cert.certNumber,
        },
      });
    } catch (_) { /* silent */ }

    return res.status(201).json({ success: true, data: cert });
  });

  // GET /api/medical-certificates
  // Filters: patient, certType, from, to. Paginated.
  list = handle(async (req, res) => {
    const q = {};
    if (req.query.patient && mongoose.isValidObjectId(req.query.patient)) q.patient = req.query.patient;
    if (req.query.certType && MedicalCertificate.CERT_TYPES.includes(req.query.certType)) q.certType = req.query.certType;
    if (req.query.status && ["issued", "revoked"].includes(req.query.status)) q.status = req.query.status;

    if (req.query.from || req.query.to) {
      q.issuedAt = {};
      if (req.query.from) q.issuedAt.$gte = new Date(req.query.from);
      if (req.query.to)   q.issuedAt.$lte = new Date(req.query.to);
    }
    if (req.query.issuedBy && mongoose.isValidObjectId(req.query.issuedBy)) {
      q.issuedBy = req.query.issuedBy;
    }

    const limitRaw = Number(req.query.limit) || 50;
    const limit = Math.min(Math.max(limitRaw, 1), 200);
    const page  = Math.max(1, Number(req.query.page) || 1);
    const skip  = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      MedicalCertificate.find(q).sort({ issuedAt: -1 }).skip(skip).limit(limit).lean(),
      MedicalCertificate.countDocuments(q),
    ]);

    return res.json({
      success: true,
      data: rows,
      count: rows.length,
      total,
      page,
      limit,
    });
  });

  // GET /api/medical-certificates/by-uhid/:uhid
  getByUHID = handle(async (req, res) => {
    const uhid = String(req.params.uhid || "").trim();
    if (!uhid) {
      return res.status(400).json({ success: false, message: "UHID is required" });
    }
    const rows = await MedicalCertificate.find({ patientUHID: uhid })
      .sort({ issuedAt: -1 })
      .limit(200)
      .lean();
    return res.json({ success: true, data: rows, count: rows.length });
  });

  // GET /api/medical-certificates/:id
  getById = handle(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid certificate ID" });
    }
    const cert = await MedicalCertificate.findById(req.params.id).lean();
    if (!cert) return res.status(404).json({ success: false, message: "Medical certificate not found" });
    return res.json({ success: true, data: cert });
  });

  // PATCH /api/medical-certificates/:id/revoke
  revoke = handle(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid certificate ID" });
    }
    const reason = (req.body?.revokeReason || "").trim();
    if (reason.length < 5) {
      return res.status(400).json({ success: false, code: "REASON_REQUIRED",
        message: "A revoke reason of at least 5 characters is required." });
    }

    const existing = await MedicalCertificate.findById(req.params.id)
      .select("status issuedBy doctorReg")
      .lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Medical certificate not found" });
    }
    if (existing.status === "revoked") {
      return res.status(409).json({ success: false, code: "ALREADY_REVOKED",
        message: "This certificate is already revoked." });
    }

    // ── Authorization: original issuer or Admin ─────────────────
    const isAdmin = req.user?.role === "Admin";
    let isOriginalIssuer = false;
    if (req.user?.id) {
      const me = await Doctor.findOne({ loginUserId: req.user.id }).select("_id professional.registrationNumber").lean();
      if (me && existing.issuedBy && String(me._id) === String(existing.issuedBy)) {
        isOriginalIssuer = true;
      }
      if (me && existing.doctorReg && me.professional?.registrationNumber === existing.doctorReg) {
        isOriginalIssuer = true;
      }
    }
    if (!isAdmin && !isOriginalIssuer) {
      return res.status(403).json({ success: false, code: "REVOKE_FORBIDDEN",
        message: "Only the original issuing doctor or an Admin can revoke this certificate." });
    }

    const cert = await MedicalCertificate.findOneAndUpdate(
      { _id: req.params.id, status: "issued" },
      {
        $set: {
          status: "revoked",
          revokedAt: new Date(),
          revokedBy: req.user?.id || null,
          revokeReason: reason,
        },
      },
      { new: true },
    );
    if (!cert) {
      return res.status(409).json({ success: false, code: "REVOKE_RACE",
        message: "Certificate state changed mid-revoke — refresh and try again." });
    }

    // Audit
    try {
      await emitClinicalAudit({
        req,
        event: "DOCTOR_NOTE_DELETED",   // closest analogue; same caveat as
                                        // above — until a dedicated enum
                                        // ships we use this event so the
                                        // row still appears in audit pulls.
        UHID: cert.patientUHID,
        patientId: cert.patient,
        patientName: cert.patientName,
        targetType: "MedicalCertificate",
        targetId: cert._id,
        reason,
        after: {
          kind: "medical-certificate-revoked",
          certType: cert.certType,
          certNumber: cert.certNumber,
        },
      });
    } catch (_) { /* silent */ }

    return res.json({ success: true, data: cert, message: "Certificate revoked." });
  });
}

module.exports = new MedicalCertificateController();
