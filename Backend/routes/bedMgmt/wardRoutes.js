const express = require("express");
const router = express.Router();
const WardController = require("../../controllers/bedMgmt/wardController");

router.post("/", WardController.createWard);
router.get("/", WardController.getAllWards);
router.get("/details/:id", WardController.getWardDetails);
router.get("/:id", WardController.getWardById);
router.put("/:id", WardController.updateWard);
router.delete("/:id", WardController.deleteWard);

module.exports = router;
