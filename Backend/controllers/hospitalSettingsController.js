const HospitalSettings = require("../models/HospitalSettings");

/* ── GET /api/hospital-settings ─────────────────────────────────────────── */
exports.getSettings = async (req, res) => {
  try {
    // Singleton — always one doc; create with defaults if first time
    let settings = await HospitalSettings.findOne();
    if (!settings) settings = await HospitalSettings.create({});
    res.json({ success: true, data: settings });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/* ── PUT /api/hospital-settings ─────────────────────────────────────────── */
exports.updateSettings = async (req, res) => {
  try {
    const settings = await HospitalSettings.findOneAndUpdate(
      {},
      { $set: req.body },
      { new: true, upsert: true, runValidators: true }
    );
    res.json({ success: true, data: settings, message: "Settings saved successfully" });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
