// // Add new patient
// exports.addPatient = async (req, res) => {
//   // hamne addpatient naam ka ek function banaya hai aur hum ise exports ke madad se bhara bhej rahe hai taki hum routes file mai use kr sake
//   console.log(req);
//   try {
//     const patient = new Patient(req.body); // Yahan humne ek (new Patient) object banaya jo req.body se data le raha hai.req.body = jo user frontend ke form me fill karke bhejta hai.

//     //     const { name, age, gender, email, phone } = req.body;

//     // if (!name || !age || !gender || !email || !phone) {
//     //   return res.status(201).json({ message: "All fields are required" });
//     // }

//     //  const patientExists = await Patient.findOne({ email });
//     // if (patientExists) {
//     //   return res.status(201).json({ message: "Patient already exists" });
//     // }

//     await patient.save();
//     res.status(201).json({
//       success: true,
//       message: "Patient registered successfully",
//       data: patient,
//     });
//   } catch (error) {
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// exports.getPatient = async (req, res) => {
//   try {
//     const patients = await Patient.find();
//     res.json(patients); // frontend ko data bhej diya
//   } catch (err) {
//     res.status(500).json({ error: err });
//   }
// };

const Doctor = require("../models/DoctorModels");

exports.doctorinfo = async (req, res) => {
  console.log(req);
  try {
    const doctordata = new Doctor(req.body);
    console.log("backend data",doctordata);
    

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
    console.log(UHID);
    

    if (!UHID) {
      return res.status(400).json({ success: false, msg: "UHID is required" });
    }

    const patient= await Doctor.findOne({ UHID: new RegExp(`^${UHID}$`, "i") });


    if (!patient) {
      return res.status(404).json({ success: false, msg: "Patient not founds bhai" });
    }

    res.status(200).json({ success: true, data: patient });

  } catch (err) {
    console.error("Error fetching patient:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};
