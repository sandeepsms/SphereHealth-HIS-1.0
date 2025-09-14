const express = require("express");
const router = express.Router();   //Express ke andar ek Router system hota hai.Router ka kaam hai alag alag routes ko manage karna.
                                   // Jaise ek hospital app me tumhare pass alag routes ho sakte hai:/patients/doctors/appointments

const { addPatient,getPatient,getPatientbyID } = require("../controllers/patientController");  //Yaha humne apna controller function import kiya hai.
                                                       //Controller me likha hota hai business logic (kaam kya karna hai).
                                                       // Jaise patient add karna, patient fetch karna, update karna, delete karna.
                                                       // Yaha tumne patientController.js file ke andar ek function banaya tha: like 👉 exports.addPatient = async (req, res) => { ... }

router.post("/add", addPatient); //post ka matlab hai ki ye route sirf POST request accept karega (GET, PUT, DELETE nahi
                      //Agar tum Postman ya frontend (React form) se POST request bhejte ho http://localhost:5000/add pe, toh ye wala route chalega.
      // addPatient Ye ek function hai jo controller file me likha hua hai. Is function ka kaam hai:Request ka data lena (req.body)se aur.
      // Us data ko database me save karna.Response bhejna (success ya error).


router.get("/getAllPatients", getPatient);

router.get("/getPatientsbyID/:UHID", getPatientbyID);


module.exports = router;  //"Is file ka jo router hai use bahar bhej do, taki dusri file (jaise server.js ya app.js) me use kiya ja sake."