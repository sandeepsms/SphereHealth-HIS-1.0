const Form = require("../models/OpdrModel");

// Minimum fields the OPD intake form needs to be persistable. Anything
// beyond this is optional and just gets stored as-given.
const REQUIRED_FIELDS = ["UHID", "fullName", "contactNumber", "gender"];

exports.OPDform = async (req, res) => {
  try {
    const body = req.body || {};
    const missing = REQUIRED_FIELDS.filter((k) => !body[k] || String(body[k]).trim() === "");
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Missing required field(s): ${missing.join(", ")}`,
      });
    }

    const Registrationform = new Form(body);
    await Registrationform.save();
    res.status(201).json({
      success: true,
      message: "Form Submitted",
      data: Registrationform,
    });
  } catch (error) {
    // Mongoose validation failures → 400, anything else → 500.
    const status = error?.name === "ValidationError" ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
};

exports.getPreceptionreport = async (req, res) => {
  try {
    const Preceptionreport = await Form.findOne({ UHID: req.params.UHID }); 

    if (!Preceptionreport) {
      // ✅ Agar UHID se koi record nahi mila
      return res.status(404).json({ message: "No report found for this UHID" });
    }

    // ✅ Data frontend ko bhej diya
    res.json(Preceptionreport);
  } catch (err) {
    console.error(err); // Debug ke liye
    res.status(500).json({ error: "Server error", details: err.message });
  }
};
