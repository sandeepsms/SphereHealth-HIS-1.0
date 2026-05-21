const express = require("express");
const router = express.Router();
const BedController = require("../../controllers/bedMgmt/bedController");
const { requireAction } = require("../../middleware/auth");

// Bed master CRUD — Admin only (configures hospital topology).
router.post("/",      requireAction("departments.write"), BedController.createBeds);
router.get("/", BedController.getAllBeds);
router.get("/available", BedController.getAvailableBeds);
router.get("/:id", BedController.getBedById);
router.put("/:id",    requireAction("departments.write"), BedController.updateBed);
router.delete("/:id", requireAction("departments.write"), BedController.deleteBed);

router.get("/:id/pricing", BedController.getBedPricing);
// Bed booking / discharge — Reception, Doctor, Admin (per ipd.assign-bed).
router.post("/:id/book",      requireAction("ipd.assign-bed"), BedController.bookBed);
router.post("/:id/discharge", requireAction("ipd.discharge"),  BedController.dischargeBed);
router.get("/:id/estimate", BedController.estimateCharges);
router.patch("/:id/status",   requireAction("ipd.assign-bed"), BedController.updateBedStatus);

router.get("/room/:roomId/capacity", BedController.checkRoomCapacity);
router.get("/ward/:wardId/capacity", BedController.checkWardCapacity);

// Housekeeping queue + state transitions — Housekeeping/WardBoy/Admin/Nurse.
// R7az-A/D8-HIGH-3: pre-R7az both endpoints accepted any authenticated
// role. Gated on ipd.assign-bed (Admin/Receptionist/Doctor) since they
// directly flip bed occupancy state.
router.get  ("/housekeeping/queue", requireAction("ipd.assign-bed"), BedController.getHousekeepingQueue);
router.patch("/:id/housekeeping",   requireAction("ipd.assign-bed"), BedController.updateHousekeeping);

// Reservation auto-expiry — Admin only (semi-cron operation).
router.post("/reservations/expire-stale", requireAction("departments.write"), BedController.expireStaleReservations);

// Predictive LOS (rule-based stub for now)
router.get("/predict/los", BedController.predictLOS);

// Real-time event stream (Server-Sent Events) — used by Live Bed Map
// and Dashboard for instant refresh on bed mutations.
// R7az-A/D8-HIGH-4: SSE was ungated pre-R7az; any logged-in role could
// subscribe to the bed-mutation firehose (room numbers + patient
// movement = PHI). Gated on ipd.assign-bed.
router.get("/events", requireAction("ipd.assign-bed"), BedController.streamBedEvents);

// NABH MOI.2 monthly bed-utilization report (P3 #16)
const BedReport = require("../../controllers/bedMgmt/bedReportController");
router.get("/reports/monthly", BedReport.getMonthlyReport);

module.exports = router;
