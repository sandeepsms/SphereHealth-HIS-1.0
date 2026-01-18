const express = require("express");
const router = express.Router();

const { OPDform, getPreceptionreport } = require("../../controllers/OpdR");

router.post("/Registraiondata", OPDform);

router.get("/getPreceptionreport/:UHID", getPreceptionreport);



module.exports = router;
