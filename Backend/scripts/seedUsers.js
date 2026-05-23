/**
 * seedUsers.js — DEPRECATED (R7br).
 *
 * Pre-R7br this script seeded 8 default users with passwords DIFFERENT
 * from the canonical seedRoleUsers.js, producing the "password worked
 * yesterday but not today" failure mode. Running this script after
 * seedRoleUsers.js was the #1 cause of recurrent admin login problems.
 *
 * Canonical seed: Backend/scripts/seedRoleUsers.js (Welcome@123 for every
 * staff role + doctor-link wiring for OPD/IPD/ER scope filtering).
 * Forgot the password? Backend/scripts/unblockAdminPassword.js resets
 * admin@spherehealth.com to Welcome@123 idempotently.
 *
 * R7br invariant R21: ONE seed script per user collection. Conflicting
 * password sources MUST be removed at the source — not survived via
 * "run them in the right order".
 *
 * If you genuinely need the legacy user shape this script created, copy
 * the SEED_USERS payload from the R7bp commit and merge into
 * seedRoleUsers.js. Do not re-create competing scripts.
 */
"use strict";
console.error(
  "[seedUsers] DEPRECATED — this script conflicted with seedRoleUsers.js " +
  "and caused recurrent admin login failures. Use seedRoleUsers.js instead.",
);
console.error(
  "  Admin reset:   node Backend/scripts/unblockAdminPassword.js",
  "\n  Role seeds:    node Backend/scripts/seedRoleUsers.js",
);
process.exit(2);
