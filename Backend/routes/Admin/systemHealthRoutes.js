/**
 * systemHealthRoutes.js — R7bz System Health admin dashboard
 *
 *   GET /api/admin/system-health
 *
 * Single read-only diagnostics endpoint that backs the new admin-only
 * "System Health" page (Frontend/src/pages/admin/SystemHealthPage.jsx).
 * Returns the JSON envelope `{ ok, generatedAt, data: { db, crons,
 * errors, activity, integrity, server } }` — see
 * controllers/Admin/systemHealthController.js for the per-section shape.
 *
 * Gate: `authenticate` + `requireAction("users.read")`.
 *   We deliberately re-use an existing permission instead of inventing a
 *   new `system.health.read` — this matches the convention from
 *   adminDashboardRoutes.js, where the Mission Control overview is also
 *   `users.read`-gated. Accountant has users.read=false in
 *   config/permissions, so today only Admin can hit this endpoint.
 *
 * IMPORTANT: the controller is strictly READ-ONLY. No mutations, no
 * cleanup side-effects, no "fix it" actions. If a future change wants
 * to add an action (e.g. "kick a cron"), it MUST live on a separate
 * route with its own write-permission gate — never bolted on to this
 * diagnostic endpoint.
 *
 * NOTE TO MAINTAINER:
 *   Mount this router in Backend/index.js as:
 *     app.use('/api/admin', require('./routes/Admin/systemHealthRoutes'));
 *   A sibling agent owns the actual edit to index.js in this R7bz
 *   cycle; please coordinate before adding the mount in a separate
 *   commit. The resulting full URL is `/api/admin/system-health`.
 */
"use strict";

const express = require("express");
const router  = express.Router();

const { authenticate, requireAction } = require("../../middleware/auth");
const { getSystemHealth } = require("../../controllers/Admin/systemHealthController");

// Auth applies to the whole router so we don't have to repeat it on
// every route added here in the future.  Same pattern as
// adminDashboardRoutes.js.
router.use(authenticate);

// users.read keeps this admin-only.  See header for rationale.
router.get("/system-health", requireAction("users.read"), getSystemHealth);

module.exports = router;
