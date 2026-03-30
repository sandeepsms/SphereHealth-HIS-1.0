const VitalSheet = require("../../models/vital/vital");

exports.saveVitalSheet = async (req, res) => {
  try {
    let { uhid, date, patientInfo, activeVitals, tableData } = req.body;

    const formattedDate = (() => {
      const d = new Date(date);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${mm}-${dd}-${yyyy}`;
    })();

    const record = await VitalSheet.findOneAndUpdate(
      { uhid, date: formattedDate },
      { patientInfo, activeVitals, tableData },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, message: "Vital sheet stored successfully", data: record });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};
// Get all vitals for a patient (NEW)
exports.getVitalSheet = async (req, res) => {
  try {
    const { uhid } = req.query;
    if (!uhid) return res.status(400).json({ success: false, message: "uhid is required" });

    const records = await VitalSheet.find({ uhid }, "-__v -createdAt -updatedAt").lean();

    res.json({
      success: true,
      exists: records.length > 0,
      data: records || []
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

exports.updateVitalSheet = async (req, res) => {
  try {
    let { uhid, date, patientInfo, activeVitals, tableData } = req.body;

    if (!uhid || !date) {
      return res.status(400).json({
        success: false,
        message: "uhid and date are required"
      });
    }

    // Format date same way as save API
    const formattedDate = (() => {
      const d = new Date(date);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${mm}-${dd}-${yyyy}`;
    })();

    const updatedRecord = await VitalSheet.findOneAndUpdate(
      { uhid, date: formattedDate },    // match condition
      { patientInfo, activeVitals, tableData },  // update fields
      { new: true }                    // return updated document
    );

    if (!updatedRecord) {
      return res.status(404).json({
        success: false,
        message: "Record not found for this UHID & date"
      });
    }

    res.json({
      success: true,
      message: "Vital sheet updated successfully",
      data: updatedRecord
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
};


exports.deleteVitalSheet = async (req, res) => {
  try {
    const { uhid, date } = req.body;

    if (!uhid || !date) {
      return res.status(400).json({ success: false, message: "uhid and date are required" });
    }

    const formattedDate = (() => {
      const d = new Date(date);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${mm}-${dd}-${yyyy}`;
    })();

    const deleted = await VitalSheet.findOneAndDelete({ uhid, date: formattedDate });

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Record not found" });
    }

    res.json({
      success: true,
      message: "Vital sheet deleted successfully"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};
