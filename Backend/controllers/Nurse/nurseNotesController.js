// controllers/Nurse/nurseNotesController.js
const nurseNotesService = require("../../services/Nurse/nurseNotesService");

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

class NurseNotesController {
  // POST /api/nurse-notes
  createNote = handle(async (req, res) => {
    // nurseId: body se lo, ya header se, ya JWT token se
    const nurseUserId =
      req.body.nurseId || req.headers["x-user-id"] ||
      (req.user?._id || req.user?.id || req.user);
    if (!nurseUserId)
      return res.status(400).json({
        success: false,
        message: "nurseId is required (send in body, X-User-Id header, or login token)",
      });

    const data = { ...req.body, nurseId: nurseUserId };
    const note = await nurseNotesService.createNurseNote(data, nurseUserId);
    // ── Auto-billing hook ──────────────────────────────────────
    try {
      const { logErr } = require("../../utils/logErr");
      const autoBilling = require("../../services/Billing/autoBillingService");
      autoBilling.onNurseNoteSaved(note).catch(logErr("autoBilling", `onNurseNoteSaved ${note?._id}`));
    } catch (e) {
      const { logErr } = require("../../utils/logErr");
      logErr("autoBilling", "load failure on nurse-note save")(e);
    }
    return res.status(201).json({ success: true, data: note });
  });

  // GET /api/nurse-notes/patient/:patientId
  getNotesByPatient = handle(async (req, res) => {
    const result = await nurseNotesService.getNotesByPatient(
      req.params.patientId,
      req.query,
    );
    return res.json({ success: true, ...result });
  });

  // GET /api/nurse-notes/ipd/:ipdNo
  getNotesByIPD = handle(async (req, res) => {
    const notes = await nurseNotesService.getNotesByIPD(
      req.params.ipdNo,
      req.query,
    );
    return res.json({ success: true, data: notes, count: notes.length });
  });

  // GET /api/nurse-notes/today/:ipdNo
  getTodayNotes = handle(async (req, res) => {
    const notes = await nurseNotesService.getTodayNotes(req.params.ipdNo);
    return res.json({ success: true, data: notes });
  });

  // GET /api/nurse-notes/:id
  getNoteById = handle(async (req, res) => {
    const note = await nurseNotesService.getNoteById(req.params.id);
    return res.json({ success: true, data: note });
  });

  // PUT /api/nurse-notes/:id
  updateNote = handle(async (req, res) => {
    const nurseUserId =
      req.body.nurseId || req.headers["x-user-id"] || req.user;
    const note = await nurseNotesService.updateNurseNote(
      req.params.id,
      req.body,
      nurseUserId,
    );
    return res.json({ success: true, data: note });
  });

  // PATCH /api/nurse-notes/:id/confirm-order
  confirmOrder = handle(async (req, res) => {
    const nurseUserId =
      req.body.nurseId || req.headers["x-user-id"] || req.user;
    const result = await nurseNotesService.confirmSingleOrder(
      req.body,
      nurseUserId,
    );
    return res.json({ success: true, data: result });
  });

  // GET /api/nurse-notes?ipdNo=XXX  (query-param fallback used by NursingNotesPage)
  getNotesByQuery = handle(async (req, res) => {
    const { ipdNo, patientId } = req.query;
    if (ipdNo) {
      const notes = await nurseNotesService.getNotesByIPD(ipdNo, req.query);
      return res.json({ success: true, data: notes, count: notes.length });
    }
    if (patientId) {
      const result = await nurseNotesService.getNotesByPatient(patientId, req.query);
      return res.json({ success: true, ...result });
    }
    return res.json({ success: true, data: [], count: 0 });
  });

  // GET /api/nurse-notes/report/:ipdNo  — full patient nursing record for print/PDF/insurance
  getPatientReport = handle(async (req, res) => {
    const notes = await nurseNotesService.getNotesByIPD(req.params.ipdNo, {});
    // Group by date and sort
    const grouped = {};
    notes.forEach(n => {
      const day = new Date(n.noteDate || n.createdAt).toISOString().slice(0, 10);
      if (!grouped[day]) grouped[day] = [];
      grouped[day].push(n);
    });
    return res.json({
      success: true,
      ipdNo: req.params.ipdNo,
      totalNotes: notes.length,
      grouped,
      notes,
    });
  });

  // PATCH /api/nurse-notes/:id/blood-monitoring  — add a monitoring entry to an active transfusion
  addBloodMonitoring = handle(async (req, res) => {
    const { entry } = req.body;
    if (!entry || typeof entry !== "object")
      return res.status(400).json({ success: false, message: "entry (object) is required" });
    const note = await nurseNotesService.addBloodMonitoringEntry(req.params.id, entry);
    return res.json({ success: true, data: note });
  });

  // PATCH /api/nurse-notes/:id/blood-status  — complete / stop / react to a transfusion
  updateBloodStatus = handle(async (req, res) => {
    const note = await nurseNotesService.updateBloodTransfusionStatus(req.params.id, req.body);
    return res.json({ success: true, data: note });
  });

  // DELETE /api/nurse-notes/:id
  deleteNote = handle(async (req, res) => {
    const nurseUserId =
      req.body.nurseId || req.headers["x-user-id"] || req.user;
    await nurseNotesService.deleteNurseNote(req.params.id, nurseUserId);
    return res.json({ success: true, message: "Note deleted" });
  });
}

module.exports = new NurseNotesController();
