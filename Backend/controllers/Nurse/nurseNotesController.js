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
    // nurseId: body se lo, ya header se
    const nurseUserId =
      req.body.nurseId || req.headers["x-user-id"] || req.user;
    if (!nurseUserId)
      return res.status(400).json({
        success: false,
        message: "nurseId is required in request body",
      });

    // nurseId body mein bhi pass karo service ke liye
    const data = { ...req.body, nurseId: nurseUserId };
    const note = await nurseNotesService.createNurseNote(data, nurseUserId);
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

  // DELETE /api/nurse-notes/:id
  deleteNote = handle(async (req, res) => {
    const nurseUserId =
      req.body.nurseId || req.headers["x-user-id"] || req.user;
    await nurseNotesService.deleteNurseNote(req.params.id, nurseUserId);
    return res.json({ success: true, message: "Note deleted" });
  });
}

module.exports = new NurseNotesController();
