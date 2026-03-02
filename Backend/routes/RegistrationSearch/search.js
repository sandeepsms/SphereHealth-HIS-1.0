const express=require("express");
const router=express.Router();
const RegistrationSearchController=require("../../controllers/SearchController/searchcontroller");

router.get("/search/:uhid",RegistrationSearchController.SearchPatientByUHID)

module.exports = router;