// Backend/routes/Pharmacy/coldChainRoutes.js
// R7bh-F5: routes for cold-chain log.

const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Pharmacy/coldChainController");

let requireAction;
try { ({ requireAction } = require("../../middleware/permissions")); }
catch (_) { requireAction = () => (req, res, next) => next(); }

let validateObjectIdParam;
try { ({ validateObjectIdParam } = require("../../middleware/objectIdGuard")); }
catch (_) {
  try { validateObjectIdParam = require("../../middleware/validateObjectIdParam"); }
  catch (_2) { validateObjectIdParam = () => (req, res, next) => next(); }
}

router.post("/log", requireAction("pharmacy.cold-chain.write"), ctrl.logReading);
router.put("/breach/:id/acknowledge", requireAction("pharmacy.cold-chain.write"), validateObjectIdParam("id"), ctrl.acknowledgeBreach);
router.get("/fridge/:fridgeId", requireAction("pharmacy.cold-chain.read"), ctrl.getForFridge);
router.get("/breaches", requireAction("pharmacy.cold-chain.read"), ctrl.listBreaches);

module.exports = router;
