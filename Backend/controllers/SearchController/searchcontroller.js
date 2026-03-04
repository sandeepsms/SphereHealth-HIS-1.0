const SearchPatientBYUhid = require("../../services/Patient/patientService");

// exports.SearchPatientByUHID = async (req, res) => {
//   try {
//     const patient = await SearchPatientBYUhid.getPatientByUHID(req.params.uhid);

//     res.status(200).json({
//       success: true,
//       data: patient,
//     });
//   } catch (error) {
//     const statusCode = error.message === "Patient not found" ? 404 : 500;
//     res.status(statusCode).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };





exports.SearchPatientByUHID = async (req, res) => {
  try {
    const { uhid } = req.params;   // destructure properly

    if (!uhid ) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const patient = await SearchPatientBYUhid.getRegistrationPatientSerachByUHID(uhid);

    res.status(200).json({
      success: true,
      data: patient || [],
    });

  } catch (error) {
    console.error("Search Error:", error);

    res.status(500).json({
      success: false,
      message: error.message || "Server Error",
    });
  }
};