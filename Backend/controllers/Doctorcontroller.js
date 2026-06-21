n;
const Doctor = require("../models/DoctorModels");

exports.doctorinfo = async (req, res) => {
  console.log(req);
  try {
    const doctordata = new Doctor(req.body);
    console.log("backend data", doctordata);

    await doctordata.save();
    res.status(201).json({
      success: true,
      message: "Form Submitted",
      data: doctordata,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// exports.getdoctorPatientbyID = async (req, res) => {
//    try {
//      const patient = await Doctor.findOne({ UHID: req.params.UHID });
//      if (!patient) return res.status(404).json({ msg: "Patient not foundssssssssssssssssss" });
//      res.json(patient);
//    } catch (err) {
//      res.status(500).json({ error: err.message });
//    }
// };

exports.getdoctorPatientbyID = async (req, res) => {
  try {
    const { UHID } = req.params;
    // PII removed from logs (security audit 2026-05-17, finding G-03).
    // UHIDs in stdout get scraped into log aggregators and shared dev
    // terminals — DPDP §8 considers that a disclosure.

    if (!UHID) {
      return res.status(400).json({ success: false, msg: "UHID is required" });
    }

    const patient = await Doctor.findOne({
      UHID: new RegExp(`^${UHID}$`, "i"),
    });

    if (!patient) {
      return res
        .status(404)
        .json({ success: false, msg: "Patient not founds bhai" });
    }

    res.status(200).json({ success: true, data: patient });
  } catch (err) {
    console.error("Error fetching patient:", err);
    // R7hr-252 (audit: raw error leaked in prod) — generic message in prod.
    res.status(500).json({ success: false, error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message });
  }
};
