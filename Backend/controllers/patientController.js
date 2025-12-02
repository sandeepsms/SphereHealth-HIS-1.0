const Patient = require("../models/patientModel");

// Add new patient
exports.addPatient = async (req, res) => {
  // hamne addpatient naam ka ek function banaya hai aur hum ise exports ke madad se bhara bhej rahe hai taki hum routes file mai use kr sake
  console.log(req);
  try {
    const patient = new Patient(req.body); 
    // Yahan humne ek (new Patient) object banaya jo req.body se data le raha hai.req.body = jo user frontend ke form me fill karke bhejta hai.
    //     const { name, age, gender, email, phone } = req.body;

    // if (!name || !age || !gender || !email || !phone) {
    //   return res.status(201).json({ message: "All fields are required" });
    // }

    //  const patientExists = await Patient.findOne({ email });
    // if (patientExists) {
    //   return res.status(201).json({ message: "Patient already exists" });
    // }


    // Generate Random UHID..............................................
 const firstname = patient.name.split(" ")[0]; // first word
    const RandomNumber = Math.floor(1000 + Math.random() * 9000);
    const newUHID = firstname.toUpperCase() + RandomNumber;
  patient.UHID=newUHID;

//.......................................................................


    await patient.save();
    res.status(201).json({
      success: true,
      message: "Patient registered successfully",
      data: patient,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPatient = async (req, res) => {  
  try {
    const patients = await Patient.find();
    res.json(patients); // frontend ko data bhej diya
  } catch (err) {
    res.status(500).json({ error: err });
  }
};


exports.getPatientbyID = async (req, res) => {
   try {
     const patient = await Patient.findOne({ UHID: req.params.UHID });
     if (!patient) return res.status(404).json({ msg: "Patient not found" });
     res.json(patient);
   } catch (err) {
     res.status(500).json({ error: err.message });
   }
};


