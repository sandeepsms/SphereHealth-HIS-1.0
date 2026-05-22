const express = require("express");
const router = express.Router();
const WardController = require("../../controllers/bedMgmt/wardController");
const { requireAction } = require("../../middleware/auth");

// Ward master — Admin-only writes.
// R7bb-B/D4-MED-S1: reads now gated on `ipd.read`.
router.get("/",            requireAction("ipd.read"), WardController.getAllWards);
router.get("/details/:id", requireAction("ipd.read"), WardController.getWardDetails);
router.get("/:id",         requireAction("ipd.read"), WardController.getWardById);
router.post("/",     requireAction("departments.write"), WardController.createWard);
router.put("/:id",   requireAction("departments.write"), WardController.updateWard);
router.delete("/:id",requireAction("departments.write"), WardController.deleteWard);

module.exports = router;
