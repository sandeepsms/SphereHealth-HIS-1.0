// Backend/config/pharmacyMode.js
// ════════════════════════════════════════════════════════════════════
// R7cs — Pharmacy standalone-deploy mode switch (backend mirror).
//
// Set via environment variable at process startup:
//   PHARMACY_MODE=standalone node index.js
//
// Default = "hospital" so existing HIS deployments are unchanged.
//
// Semantics:
//   • "hospital"   — full HIS. All routes mounted. Patient / Admission
//                    / OPD / IPD models populated. Indents + OPD Rx
//                    lookup work normally.
//   • "standalone" — chemist-shop deployment. Hospital-coupled pharmacy
//                    routes 404 even if a leaked token has permission;
//                    defence-in-depth so the frontend gating isn't the
//                    only line of protection. The hospital DB tables
//                    may not even exist in this deployment.
//
// Use the `requireHospitalMode` middleware exported below on any route
// that meaningfully depends on hospital state.
// ════════════════════════════════════════════════════════════════════
"use strict";

const RAW = String(process.env.PHARMACY_MODE || "").trim().toLowerCase();
const PHARMACY_MODE = RAW === "standalone" ? "standalone" : "hospital";

const IS_PHARMACY_STANDALONE = PHARMACY_MODE === "standalone";
const IS_HOSPITAL_MODE       = PHARMACY_MODE === "hospital";

/**
 * Express middleware — 404s a route when the deployment is in
 * standalone mode. Used on routes that depend on the Patient /
 * Admission / OPD / IPD collections (indents, OPD-Rx lookup,
 * kitchen indents, etc.).
 *
 * 404 (not 403) is intentional: in standalone mode the feature
 * doesn't exist, so we don't reveal that it would be permission-
 * gated in another deployment shape.
 */
function requireHospitalMode(req, res, next) {
  if (IS_PHARMACY_STANDALONE) {
    return res.status(404).json({
      success: false,
      code: "NOT_AVAILABLE_IN_STANDALONE",
      message: "This feature is only available in hospital-integrated pharmacy deployments.",
    });
  }
  return next();
}

module.exports = {
  PHARMACY_MODE,
  IS_PHARMACY_STANDALONE,
  IS_HOSPITAL_MODE,
  requireHospitalMode,
};
