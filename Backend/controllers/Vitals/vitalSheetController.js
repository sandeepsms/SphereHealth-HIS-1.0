// controllers/Vitals/vitalSheetController.js

const vitalSheetService = require("../../services/Vitals/vitalSheetService");

const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    return result;
  } catch (err) {
    const status = err.message?.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message: err.message });
  }
};

// POST /api/vital-sheets
exports.saveVitalSheet = handle(async (req, res) => {
  const data = await vitalSheetService.saveVitalSheet(req.body);
  return res.status(200).json({ success: true, data });
});

// GET /api/vital-sheets?uhid=UH00000001&date=2026-03-24
exports.getVitalSheet = handle(async (req, res) => {
  const { uhid, date } = req.query;
  const data = await vitalSheetService.getVitalSheet(uhid, date);
  return res.json({ success: true, ...data });
});

// PUT /api/vital-sheets/update
exports.updateVitalSheet = handle(async (req, res) => {
  const data = await vitalSheetService.updateVitalSheet(req.body);
  return res.json({ success: true, data });
});

// DELETE /api/vital-sheets/delete
exports.deleteVitalSheet = handle(async (req, res) => {
  const data = await vitalSheetService.deleteVitalSheet(req.body);
  return res.json({ success: true, message: "Vital sheet deleted", data });
});
