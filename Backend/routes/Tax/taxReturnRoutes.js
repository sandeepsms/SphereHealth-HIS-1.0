/**
 * routes/Tax/taxReturnRoutes.js  (R7bh-F6 / R7bg CRIT-A1)
 *
 * Mounted at `/api/tax-returns`. All endpoints behind the global
 * `authenticate` middleware applied in routes/index.js — each gated by
 * `requireAction("tax.returns.read|write")` from
 * Backend/config/permissions.js.
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Tax/taxReturnController");
const { requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

// ── GSTR-1 ──────────────────────────────────────────────────────
router.post("/gstr1/preview", requireAction("tax.returns.read"), ctrl.previewGSTR1);
router.post("/gstr1/generate", requireAction("tax.returns.write"), ctrl.generateGSTR1);

// ── GSTR-3B ─────────────────────────────────────────────────────
router.post("/gstr3b/preview", requireAction("tax.returns.read"), ctrl.previewGSTR3B);
router.post("/gstr3b/generate", requireAction("tax.returns.write"), ctrl.generateGSTR3B);

// ── Lifecycle (apply to either kind) ────────────────────────────
router.put("/:id/finalize", validateObjectIdParam("id"), requireAction("tax.returns.write"), ctrl.finalize);
router.put("/:id/mark-filed", validateObjectIdParam("id"), requireAction("tax.returns.write"), ctrl.markFiled);
// Spec also requests /gstr1/:id/finalize + /gstr1/:id/mark-filed aliases —
// they all map to the same controller methods (id is unambiguous).
router.put("/gstr1/:id/finalize", validateObjectIdParam("id"), requireAction("tax.returns.write"), ctrl.finalize);
router.put("/gstr1/:id/mark-filed", validateObjectIdParam("id"), requireAction("tax.returns.write"), ctrl.markFiled);
router.put("/gstr3b/:id/finalize", validateObjectIdParam("id"), requireAction("tax.returns.write"), ctrl.finalize);
router.put("/gstr3b/:id/mark-filed", validateObjectIdParam("id"), requireAction("tax.returns.write"), ctrl.markFiled);

// ── Read ────────────────────────────────────────────────────────
router.get("/", requireAction("tax.returns.read"), ctrl.list);
router.get("/gstr1", requireAction("tax.returns.read"), (req, res, next) => {
  req.query.returnKind = "GSTR-1";
  return ctrl.list(req, res, next);
});
router.get("/gstr3b", requireAction("tax.returns.read"), (req, res, next) => {
  req.query.returnKind = "GSTR-3B";
  return ctrl.list(req, res, next);
});
router.get("/:id", validateObjectIdParam("id"), requireAction("tax.returns.read"), ctrl.getOne);

module.exports = router;
