const Form = require("../models/OpdrModel");

exports.OPDform = async (req, res) => {
  console.log(req);
  try {
    const Registrationform = new Form(req.body);
    console.log("backend data", Registrationform);

    await Registrationform.save();
    res.status(201).json({
      success: true,
      message: "Form Submitted",
      data: Registrationform,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
