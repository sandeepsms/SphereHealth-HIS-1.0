const express = require("express");
const router = express.Router();


const {OPDform} = require("../controllers/OpdR");

router.post("/Registraiondata", OPDform);



     

module.exports = router; 