
const express = require("express");
const router = express.Router();


const { doctorinfo,getdoctorPatientbyID } = require("../controllers/Doctorcontroller");

router.post("/doctoradd", doctorinfo);


router.get("/getdoctorPatientsbyID/:UHID", getdoctorPatientbyID);
     

module.exports = router; 
