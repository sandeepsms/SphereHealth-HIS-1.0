const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/dischargeSummaryController");
// R7n + R7az-A/D9: every endpoint action-gated.
//   reads  → `discharge-summary.read`  (Admin/Doctor/Nurse/MRD)
//   writes → `discharge-summary.write` (Admin/Doctor) — clinician-only
// Discharge summary is a NABH MOI.1 clinical-legal record; only Admin /
// Doctor can create, edit, or finalize. Reads stay open to clinical
// staff + MRD (read-only). Pre-R7az reads were entirely ungated and
// writes shared ipd.discharge-summary which still belongs on Admin/Doctor
// — kept as a synonym below to preserve any in-flight callers.
const { requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.get("/uhid/:uhid",       requireAction("discharge-summary.read"),  ctrl.getByUHID);
router.get("/admission/:admissionId", requireAction("discharge-summary.read"),  ctrl.getByAdmission);
router.get("/",                 requireAction("discharge-summary.read"),  ctrl.getAll);
router.post("/",                requireAction("discharge-summary.write"), ctrl.create);
router.get("/:id",              validateObjectIdParam("id"), requireAction("discharge-summary.read"),  ctrl.getById);
router.put("/:id",              validateObjectIdParam("id"), requireAction("discharge-summary.write"), ctrl.update);
router.patch("/:id/finalize",   validateObjectIdParam("id"), requireAction("discharge-summary.write"), ctrl.finalize);
router.delete("/:id",           validateObjectIdParam("id"), requireAction("discharge-summary.write"), ctrl.delete);

module.exports = router;
