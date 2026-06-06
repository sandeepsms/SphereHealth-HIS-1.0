// controllers/Doctor/doctorNotesController.js
const doctorNotesService = require("../../services/Doctor/doctorNotesService");

const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    return result;
  } catch (err) {
    const status =
      err.statusCode || (err.message?.includes("not found") ? 404 : 400);
    // R7bx item 8 — surface err.code (e.g. MCI_REG_NO_MISSING) so the
    // frontend can switch on a stable identifier rather than parsing
    // the human-readable message.
    return res.status(status).json({
      success: false,
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
};

class DoctorNotesController {
  // POST /api/doctor-notes
  createNote = handle(async (req, res) => {
    // B1-T01 (security): the signer/actor identity MUST come from the
    // JWT-authenticated user. Never trust req.body.doctorId or the
    // X-User-Id header — a malicious client could otherwise impersonate
    // any clinician for legal-grade entries.
    const doctorUserId = req.user?.id;
    if (!doctorUserId) {
      return res.status(401).json({ success: false, code: "AUTH_REQUIRED", message: "Authenticated doctor identity required" });
    }

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
    // B1-T01 (security): actor identity comes only from the JWT — never
    // from the request body / X-User-Id header.
    const doctorUserId = req.user?.id;
    if (!doctorUserId) {
      return res.status(401).json({ success: false, code: "AUTH_REQUIRED", message: "Authenticated doctor identity required" });
    }
    const note = await doctorNotesService.updateDoctorNote(
      req.params.id,
      req.body,
      doctorUserId,
    );
    return res.json({ success: true, data: note });
  });

  // PATCH /api/doctor-notes/:id/sign
  signNote = handle(async (req, res) => {
    // B1-T01 (security): the signer's identity is the JWT-authenticated
    // user — never overridable via req.body.doctorId or X-User-Id. The
    // service's handover-sign branch records the original author
    // separately when a different user attests a colleague's draft.
    const doctorUserId = req.user?.id;
    if (!doctorUserId) {
      return res.status(401).json({ success: false, code: "AUTH_REQUIRED", message: "Authenticated doctor identity required" });
    }
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

  // POST /api/doctor-notes/:id/amend
  // Post-sign amendment of a SIGNED (or already-amended) note. The
  // legal attestation chain (signedAt / signedByName) is preserved; the
  // mutation is captured as a tracked entry on note.amendments[] and
  // mirrored to ClinicalAudit (DOCTOR_NOTE_AMENDED, 7y floor).
  amendNote = handle(async (req, res) => {
    // B1-T01 (security): actor identity comes only from the JWT.
    const doctorUserId = req.user?.id || req.user?._id;
    if (!doctorUserId) {
      return res.status(401).json({ success: false, code: "AUTH_REQUIRED", message: "Authenticated doctor identity required" });
    }
    const note = await doctorNotesService.amendDoctorNote(
      req.params.id,
      req.body,
      req.user,
      req,
    );
    return res.json({ success: true, message: "Note amended", data: note });
  });

  // DELETE /api/doctor-notes/:id
  deleteNote = handle(async (req, res) => {
    // B1-T01 (security): actor identity must come from the JWT.
    const doctorUserId = req.user?.id;
    if (!doctorUserId) {
      return res.status(401).json({ success: false, code: "AUTH_REQUIRED", message: "Authenticated doctor identity required" });
    }
    await doctorNotesService.deleteDoctorNote(req.params.id, doctorUserId, { req, reason: req.body?.reason });
    return res.json({ success: true, message: "Note deleted" });
  });
}

module.exports = new DoctorNotesController();
