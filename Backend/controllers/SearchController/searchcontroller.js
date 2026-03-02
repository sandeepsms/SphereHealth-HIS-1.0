const SearchPatientBYUhid = require("../../services/Patient/patientService");

exports.SearchPatientByUHID = async (req, res) => {
  try {
    const patient = await SearchPatientBYUhid.getPatientByUHID(req.params.uhid);

    res.status(200).json({
      success: true,
      data: patient,
    });
  } catch (error) {
    const statusCode = error.message === "Patient not found" ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};
