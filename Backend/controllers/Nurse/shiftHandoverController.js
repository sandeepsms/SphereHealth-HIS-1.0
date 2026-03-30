// controllers/shiftHandoverController.js

const service = require("../../services/Nurse/shiftHandoverService");

exports.createHandover = async (req, res) => {
  try {
    const data = await service.createHandover(req.body);
    res.status(201).json({ success: true, message: "Handover saved", data });
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({
        success: false,
        message: "Handover already exists for this shift",
      });
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getByAdmission = async (req, res) => {
  try {
    const data = await service.getHandoversByAdmission(req.query.admissionId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getLatest = async (req, res) => {
  try {
    const data = await service.getLatestHandover(req.query.uhid);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.verifyHandover = async (req, res) => {
  try {
    const data = await service.verifyHandover(req.params.id, req.body);
    res.json({ success: true, message: "Handover verified", data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
