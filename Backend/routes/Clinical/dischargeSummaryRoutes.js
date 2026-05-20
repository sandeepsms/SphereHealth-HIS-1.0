const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/dischargeSummaryController");
// R7n: Apply action gates to every write. Discharge summary is a NABH
// MOI.1 clinical-legal record — only Admin / Doctor can create, edit,
// or finalize. Reads remain open to authenticated clinical staff.
const { requireAction } = require("../../middleware/auth");

router.get("/uhid/:uhid", ctrl.getByUHID);
router.get("/admission/:admissionId", ctrl.getByAdmission);
router.get("/", ctrl.getAll);
router.post("/",            requireAction("ipd.discharge-summary"), ctrl.create);
router.get("/:id", ctrl.getById);
router.put("/:id",          requireAction("ipd.discharge-summary"), ctrl.update);
router.patch("/:id/finalize", requireAction("ipd.discharge-summary"), ctrl.finalize);
router.delete("/:id",       requireAction("ipd.discharge-summary"), ctrl.delete);

module.exports = router;
