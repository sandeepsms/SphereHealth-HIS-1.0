const express = require("express");
const router = express.Router();
const WardController = require("../../controllers/bedMgmt/wardController");
const { requireAction } = require("../../middleware/auth");
// R7bn-P1: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Ward master — Admin-only writes.
// R7bb-B/D4-MED-S1: reads now gated on `ipd.read`.
router.get("/",            requireAction("ipd.read"), WardController.getAllWards);
router.get("/details/:id", validateObjectIdParam("id"), requireAction("ipd.read"), WardController.getWardDetails);
router.get("/:id",         validateObjectIdParam("id"), requireAction("ipd.read"), WardController.getWardById);
router.post("/",     requireAction("departments.write"), WardController.createWard);
router.put("/:id",   validateObjectIdParam("id"), requireAction("departments.write"), WardController.updateWard);
router.delete("/:id",validateObjectIdParam("id"), requireAction("departments.write"), WardController.deleteWard);

module.exports = router;
