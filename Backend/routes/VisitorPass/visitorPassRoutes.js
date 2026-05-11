const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/VisitorPass/visitorPassController");

router.post("/",                  ctrl.issuePass);
router.get ("/",                  ctrl.listPasses);
router.get ("/active-count",      ctrl.activeCount);
router.post("/:id/return",        ctrl.returnPass);
router.post("/:id/revoke",        ctrl.revokePass);

module.exports = router;
