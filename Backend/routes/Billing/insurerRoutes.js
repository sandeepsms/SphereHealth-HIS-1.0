// routes/Billing/insurerRoutes.js
// R7hr(CLAIM-P4.1) — read-only list of the insurer registry for dropdowns
// (registration insurer picker, claim-form insurer selector). Config-backed,
// no DB. Mounted under /api/insurers below the global authenticate gate, so
// any logged-in staff member can read it; there is nothing sensitive here.
const express = require("express");
const router = express.Router();
const { listInsurers, getInsurer } = require("../../config/insurers");

// GET /api/insurers  → [{ code, name, type, typeLabel }]
router.get("/", (req, res) => {
  res.json({ success: true, data: listInsurers() });
});

// GET /api/insurers/:code → full registry record (submission address, portal…)
router.get("/:code", (req, res) => {
  const rec = getInsurer(req.params.code);
  res.json({ success: true, data: rec });
});

module.exports = router;
