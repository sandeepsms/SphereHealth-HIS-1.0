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
    const doctorUserId =
      req.body.doctorId || req.headers["x-user-id"] || req.user;
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
      const autoBilling = require("../../services/billing/autoBillingService");
      autoBilling.onDoctorNoteSaved(note).catch(() => {});
    } catch {}
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
    const doctorUserId =
      req.body.doctorId || req.headers["x-user-id"] || req.user;
    const note = await doctorNotesService.updateDoctorNote(
      req.params.id,
      req.body,
      doctorUserId,
    );
    return res.json({ success: true, data: note });
  });

  // PATCH /api/doctor-notes/:id/sign
  signNote = handle(async (req, res) => {
    const doctorUserId =
      req.body.doctorId || req.headers["x-user-id"] || req.user;
    const note = await doctorNotesService.signDoctorNote(
      req.params.id,
      doctorUserId,
    );
    return res.json({ success: true, message: "Note signed", data: note });
  });

  // DELETE /api/doctor-notes/:id
  deleteNote = handle(async (req, res) => {
    const doctorUserId =
      req.body.doctorId || req.headers["x-user-id"] || req.user;
    await doctorNotesService.deleteDoctorNote(req.params.id, doctorUserId);
    return res.json({ success: true, message: "Note deleted" });
  });
}

module.exports = new DoctorNotesController();
