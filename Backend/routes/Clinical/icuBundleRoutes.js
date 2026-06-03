// routes/Clinical/icuBundleRoutes.js — R7eg
//
// ICU Bundles of Care (VAP / CAUTI / CLABSI / DVT / Sepsis / SUP).
// Reads under `mar.read` (Admin / Doctor / Nurse / MRD) so the IC
// officer + on-call doc can pull bundles during rounds.
//
// R7ei — writes promoted to a dedicated `icu-bundle.write` action
// (Admin / Doctor / Nurse). Intensivists need to chart bundles too,
// but `mar.write` is the medication-administration ACL (Admin/Nurse
// only by design). Splitting the action keeps both ACLs clean.
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Clinical/icuBundleController");
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Reads
// admission/:admissionId — full bundle history for an admission (no
// 30-day window), used by the Patient File + Treatment Chart prints.
// Mounted BEFORE the wildcard /:uhid route so "admission" isn't
// captured as a UHID.
router.get("/admission/:admissionId",         validateObjectIdParam("admissionId"), requireAction("mar.read"), ctrl.listByAdmission);
router.get("/:uhid",                          requireAction("mar.read"),  ctrl.listByUhid);
router.get("/:uhid/:date/:shift",             requireAction("mar.read"),  ctrl.getByDateShift);

// Upsert (admissionId + date + shift)
router.post("/",                              requireAction("icu-bundle.write"), ctrl.upsertSheet);

// Per-item toggle — cheap PATCH that mutates one checkbox without
// re-sending the whole sheet. validateObjectIdParam blocks malformed
// :id before it CastErrors into a 500.
router.patch("/:id/:bundleKey/:itemKey",      validateObjectIdParam("id"), requireAction("icu-bundle.write"), ctrl.toggleItem);

// Finalize the shift — locks the sheet, emits audit + non-compliance
// signals for the NABH IC register.
router.post("/:id/finalize",                  validateObjectIdParam("id"), requireAction("icu-bundle.write"), ctrl.finalize);

module.exports = router;
