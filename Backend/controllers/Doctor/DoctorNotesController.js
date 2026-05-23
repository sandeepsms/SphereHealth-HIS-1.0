// controllers/Doctor/doctorNotesController.js
const doctorNotesService = require("../../services/Doctor/doctorNotesService");

const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    return result;
  } catch (err) {
    const status =
      err.statusCode || (err.message?.includes("not found") ? 404 : 400);
    return res.status(status).json({ success: false, message: err.message });
  }
};

class DoctorNotesController {
  // POST /api/doctor-notes
  createNote = handle(async (req, res) => {
    // ✅ doctorId: body se lo, ya header se, ya req.user se
    // R7g-FIX: when no doctorId is sent in body/header, fall back to the
    // authenticated user's id — NOT the whole `req.user` object (which is
    // the JWT-decoded blob including role, jti, iat, exp). Casting the
    // full object to ObjectId fails with BSONError, which is why
    // `Sign & Submit` was silently failing 400.
    const doctorUserId =
      req.body.doctorId || req.body.doctor || req.headers["x-user-id"] || req.user?.id;
    if (!doctorUserId)
      return res
        .status(400)
        .json({
          success: false,
          message: "doctorId is required (send in body or X-User-Id header)",
        });

    const note = await doctorNotesService.createDoctorNote(
      req.body,
      doctorUserId,
    );
    // ── Auto-billing hook ──────────────────────────────────────
    try {
      const { logErr } = require("../../utils/logErr");
      const autoBilling = require("../../services/Billing/autoBillingService");
      autoBilling.onDoctorNoteSaved(note).catch(logErr("autoBilling", `onDoctorNoteSaved ${note?._id}`));
    } catch (e) {
      const { logErr } = require("../../utils/logErr");
      logErr("autoBilling", "load failure on doctor-note save")(e);
    }

    // R7bn-1 / D9-fix: ClinicalAudit emit on doctor-note create (NABH
    // AAC.7). 3y retention for drafts; the SIGNED event later in the
    // lifecycle upgrades to 7y.
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      emitClinicalAudit({
        req,
        event: note.status === "signed" ? "DOCTOR_NOTE_SIGNED" : "DOCTOR_NOTE_CREATED",
        UHID: note.patientUHID || note.UHID,
        admissionId: note.admissionId,
        patientId: note.patientId,
        patientName: note.patientName,
        targetType: "DoctorNote",
        targetId: note._id,
        after: { noteType: note.noteType, status: note.status },
      });
    } catch (_) { /* silent */ }

    return res.status(201).json({ success: true, data: note });
  });

  // GET /api/doctor-notes/patient/:patientId
  getNotesByPatient = handle(async (req, res) => {
    const result = await doctorNotesService.getNotesByPatient(
      req.params.patientId,
      req.query,
    );
    return res.json({ success: true, ...result });
  });

  // GET /api/doctor-notes/ipd/:ipdNo
  getNotesByIPD = handle(async (req, res) => {
    const notes = await doctorNotesService.getNotesByIPD(req.params.ipdNo);
    return res.json({ success: true, data: notes, count: notes.length });
  });

  // GET /api/doctor-notes/pending-orders/:ipdNo
  getPendingOrders = handle(async (req, res) => {
    const orders = await doctorNotesService.getPendingOrders(req.params.ipdNo);
    return res.json({ success: true, data: orders });
  });

  // GET /api/doctor-notes/:id
  getNoteById = handle(async (req, res) => {
    const note = await doctorNotesService.getNoteById(req.params.id);
    return res.json({ success: true, data: note });
  });

  // PUT /api/doctor-notes/:id
  updateNote = handle(async (req, res) => {
    // R7g-FIX: when no doctorId is sent in body/header, fall back to the
    // authenticated user's id — NOT the whole `req.user` object (which is
    // the JWT-decoded blob including role, jti, iat, exp). Casting the
    // full object to ObjectId fails with BSONError, which is why
    // `Sign & Submit` was silently failing 400.
    const doctorUserId =
      req.body.doctorId || req.body.doctor || req.headers["x-user-id"] || req.user?.id;
    const note = await doctorNotesService.updateDoctorNote(
      req.params.id,
      req.body,
      doctorUserId,
    );
    return res.json({ success: true, data: note });
  });

  // PATCH /api/doctor-notes/:id/sign
  signNote = handle(async (req, res) => {
    // R7g-FIX: when no doctorId is sent in body/header, fall back to the
    // authenticated user's id — NOT the whole `req.user` object (which is
    // the JWT-decoded blob including role, jti, iat, exp). Casting the
    // full object to ObjectId fails with BSONError, which is why
    // `Sign & Submit` was silently failing 400.
    const doctorUserId =
      req.body.doctorId || req.body.doctor || req.headers["x-user-id"] || req.user?.id;
    // Allow the frontend signature pad to push a base64 PNG + display name
    // through at sign-time so we can stamp it on the note.
    const { signature, signedByName, signedByReg } = req.body || {};
    const note = await doctorNotesService.signDoctorNote(
      req.params.id,
      doctorUserId,
      { signature, signedByName, signedByReg },
      req, // R7bn — pass req so signDoctorNote can emit ClinicalAudit with actor/ip/ua
    );
    return res.json({ success: true, message: "Note signed", data: note });
  });

  // PATCH /api/doctor-notes/:id/diagnosis
  updateDiagnosis = handle(async (req, res) => {
    // R7bo-LIVE-fix: pass a properly-shaped actor object so the service
    // can populate updatedBy without casting an empty literal to ObjectId.
    const actor = {
      id: req.user?.id || req.user?._id || null,
      name: req.user?.fullName
        || [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ").trim()
        || "",
      role: req.user?.role || "",
    };
    const note = await doctorNotesService.updateDiagnosis(req.params.id, req.body, actor);
    return res.json({ success: true, message: "Diagnosis updated", data: note });
  });

  // DELETE /api/doctor-notes/:id
  deleteNote = handle(async (req, res) => {
    // R7g-FIX: when no doctorId is sent in body/header, fall back to the
    // authenticated user's id — NOT the whole `req.user` object (which is
    // the JWT-decoded blob including role, jti, iat, exp). Casting the
    // full object to ObjectId fails with BSONError, which is why
    // `Sign & Submit` was silently failing 400.
    const doctorUserId =
      req.body.doctorId || req.body.doctor || req.headers["x-user-id"] || req.user?.id;
    await doctorNotesService.deleteDoctorNote(req.params.id, doctorUserId);
    return res.json({ success: true, message: "Note deleted" });
  });
}

module.exports = new DoctorNotesController();
