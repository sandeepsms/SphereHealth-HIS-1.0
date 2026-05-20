// R7au-FIX-12/D3-CRIT: every TPA service-bill write/read gated. Pre-
// R7au the `POST /addbill` endpoint could be hit by any authenticated
// role (pharmacist, ward boy, dietician) and create a TPA service
// bill — financial blast radius. Now write requires `billing.write`,
// reads stay on `billing.read`.
const express = require("express");
const router = express.Router();

const {
  Servicebillfun,
  TestName,
  getOPDPrice,
  getTpaId,
} = require("../../controllers/tpa/TPAServicebillcontroller");
const { requireAction } = require("../../middleware/auth");

router.post("/addbill",                  requireAction("billing.write"), Servicebillfun);

router.get("/getAllTestNames",           requireAction("billing.read"),  TestName);

router.get("/getOPDPrice",               requireAction("billing.read"),  getOPDPrice);

router.get("/getTpaId/:TpaId",           requireAction("billing.read"),  getTpaId);

module.exports = router;
