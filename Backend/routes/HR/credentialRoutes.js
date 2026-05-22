/**
 * credentialRoutes.js  (R7bf-G / A5-CRIT-6 / NABH HRD.3)
 *
 * Routes mounted at /api/credentials. There is no dedicated "HR" role
 * in the User enum today; Admin handles all HR functions. Writes gated
 * on `hr.credential.write` (Admin only). Doctors get read access so
 * they can audit their own credentials list.
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/HR/credentialController");
const { requireAction } = require("../../middleware/auth");

router.get("/",            requireAction("hr.credential.read"),  ctrl.list);
router.get("/:id",         requireAction("hr.credential.read"),  ctrl.getOne);

router.post("/",           requireAction("hr.credential.write"), ctrl.create);
router.put("/:id",         requireAction("hr.credential.write"), ctrl.update);
router.put("/:id/verify",  requireAction("hr.credential.write"), ctrl.verify);
router.put("/:id/revoke",  requireAction("hr.credential.write"), ctrl.revoke);

module.exports = router;
