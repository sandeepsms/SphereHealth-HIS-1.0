const express = require("express");
const router = express.Router();
const BedController = require("../../controllers/bedMgmt/bedController");

router.post("/", BedController.createBeds);
router.get("/", BedController.getAllBeds);
router.get("/available", BedController.getAvailableBeds);
router.get("/:id", BedController.getBedById);
router.put("/:id", BedController.updateBed);
router.delete("/:id", BedController.deleteBed);

router.get("/:id/pricing", BedController.getBedPricing);
router.post("/:id/book", BedController.bookBed);
router.post("/:id/discharge", BedController.dischargeBed);
router.get("/:id/estimate", BedController.estimateCharges);
router.patch("/:id/status", BedController.updateBedStatus);

router.get("/room/:roomId/capacity", BedController.checkRoomCapacity);
router.get("/ward/:wardId/capacity", BedController.checkWardCapacity);

module.exports = router;
