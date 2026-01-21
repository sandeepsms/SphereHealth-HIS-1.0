const express = require("express");
const router = express.Router();

const { OPDform, getPreceptionreport } = require("../../controllers/OpdR");

router.post("/Registraiondata", OPDform);

router.get("/RegistrationOPD/getPreceptionreport/:UHID", getPreceptionreport);



module.exports = router;
