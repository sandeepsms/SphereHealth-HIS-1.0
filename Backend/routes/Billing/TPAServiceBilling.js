const express = require("express");
const router = express.Router();

const {
  Servicebillfun,
  TestName,
  getOPDPrice,
  getTpaId,
} = require("../../controllers/tpa/TPAServicebillcontroller");

router.post("/addbill", Servicebillfun);

router.get("/getAllTestNames", TestName);

router.get("/getOPDPrice", getOPDPrice);

router.get("/getTpaId/:TpaId", getTpaId);

// router.get("/getallservicefromregistrationtpaName",RegistrationTpaService)

module.exports = router;




// http://localhost:5000/api/servicebilldata/getAllTestNames


// http://localhost:5000/api/servicebilldata/getTpaId/6970a1824eac0c5744d5dcba