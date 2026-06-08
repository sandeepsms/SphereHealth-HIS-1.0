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
    // nurseId comes ONLY from JWT — body/header overrides are forbidden
    const nurseUserId = req.user?.id || req.user?._id;
    if (!nurseUserId) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Authenticated nurse identity required",
      });
    }

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
    const nurseUserId = req.user?.id || req.user?._id;
    if (!nurseUserId) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Authenticated nurse identity required",
      });
    }
    const note = await nurseNotesService.updateNurseNote(
      req.params.id,
      req.body,
      nurseUserId,
    );
    return res.json({ success: true, data: note });
  });

  // PATCH /api/nurse-notes/:id/confirm-order
  confirmOrder = handle(async (req, res) => {
    const nurseUserId = req.user?.id || req.user?._id;
    if (!nurseUserId) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Authenticated nurse identity required",
      });
    }
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

  // R7hr-156 — getPatientReport handler removed. The parallel
  // /nurse-notes/report/:ipdNo endpoint it backed (used only by the
  // retired Nursing Notes "Print / PDF Report" tile) is gone. Insurance
  // / NABH audit print needs are now served exclusively by the Patient
  // File / Complete File print pipeline, which already groups by day and
  // renders every nurse note through the shared per-type card builder.

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

  // POST /api/nurse-notes/:id/amend
  // R7hr-72-A2 — append-only post-submission amendment (NABH HIC.7).
  // Guard: only SUBMITTED or already-AMENDED notes are amendable; draft
  // notes mutate in place via PUT. Each call pushes one entry onto
  // amendments[] (before/after snapshot + reason + actor), applies a
  // whitelisted field set, flips status → "amended", emits
  // NURSE_NOTE_AMENDED on ClinicalAudit. Optimistic concurrency via
  // If-Match → __v gate inside the service.
  amendNote = handle(async (req, res) => {
    const nurseUserId = req.user?.id || req.user?._id;
    if (!nurseUserId) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Authenticated nurse identity required",
      });
    }
    const ifMatch = req.get("If-Match");
    const expectedVersion = ifMatch != null && ifMatch !== ""
      ? Number(String(ifMatch).replace(/^"|"$/g, ""))
      : (req.body?.__v != null ? Number(req.body.__v) : undefined);
    const note = await nurseNotesService.amendNurseNote(
      req.params.id,
      req.body || {},
      { id: nurseUserId, name: req.user?.name, role: req.user?.role },
      expectedVersion,
    );
    return res.json({ success: true, data: note });
  });

  // DELETE /api/nurse-notes/:id
  deleteNote = handle(async (req, res) => {
    const nurseUserId = req.user?.id || req.user?._id;
    if (!nurseUserId) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Authenticated nurse identity required",
      });
    }
    await nurseNotesService.deleteNurseNote(req.params.id, nurseUserId);
    return res.json({ success: true, message: "Note deleted" });
  });
}

module.exports = new NurseNotesController();
