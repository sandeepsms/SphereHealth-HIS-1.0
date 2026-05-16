const express = require("express");
const router = express.Router();
const WardController = require("../../controllers/bedMgmt/wardController");
const { requireAction } = require("../../middleware/auth");

// Ward master — Admin only.
router.get("/",            WardController.getAllWards);
router.get("/details/:id", WardController.getWardDetails);
router.get("/:id",         WardController.getWardById);
router.post("/",     requireAction("departments.write"), WardController.createWard);
router.put("/:id",   requireAction("departments.write"), WardController.updateWard);
router.delete("/:id",requireAction("departments.write"), WardController.deleteWard);

module.exports = router;
