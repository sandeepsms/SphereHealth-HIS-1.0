/**
 * medicationSafetyRoutes — NABH MOM.4 / MOM.5
 *
 * Point-of-order medication-safety screen. The prescriber's order form (and
 * the pharmacy dispense screen) POST the drug + sig here to get live
 * Do-Not-Use abbreviation + LASA collision warnings BEFORE the order is
 * committed. Read-only + advisory — no data is written, so any authenticated
 * clinician may call it (mounted below the global `authenticate` wall).
 *
 * Mounted at /api/medication-safety.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { screenMedication } = require("../../services/Clinical/medicationSafety");

// POST /screen — body: { medicineName, genericName, dose, frequency, route, instructions }
router.post("/screen", (req, res) => {
  try {
    const b = req.body || {};
    const result = screenMedication({
      medicineName: b.medicineName || b.drugName || "",
      genericName:  b.genericName || "",
      dose:         b.dose || "",
      frequency:    b.frequency || "",
      route:        b.route || "",
      instructions: b.instructions || b.notes || "",
    });
    return res.json({ success: true, data: result });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[medicationSafety] screen failed:", e.message);
    return res.status(500).json({ success: false, message: e.message || "Screen failed" });
  }
});

module.exports = router;
