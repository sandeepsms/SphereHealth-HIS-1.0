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

// Housekeeping queue + state transitions
router.get("/housekeeping/queue",    BedController.getHousekeepingQueue);
router.patch("/:id/housekeeping",    BedController.updateHousekeeping);

// Reservation auto-expiry (callable on-demand; cron-friendly)
router.post("/reservations/expire-stale", BedController.expireStaleReservations);

// Predictive LOS (rule-based stub for now)
router.get("/predict/los", BedController.predictLOS);

module.exports = router;
