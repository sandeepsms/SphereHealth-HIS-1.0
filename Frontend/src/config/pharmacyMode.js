// Frontend/src/config/pharmacyMode.js
// ════════════════════════════════════════════════════════════════════
// R7cs — Pharmacy standalone-deploy mode switch.
//
// Two deployment shapes:
//   • "hospital"   — the default. Pharmacy module is one of many in a full
//                    HIS. Receptionist / Doctor / Nurse / Lab / Billing
//                    all live in the same sidebar. Pharmacy tabs that
//                    consume hospital state (OPD Rx lookup, IPD indents,
//                    kitchen indents, UHID-linked dispense) are visible
//                    and functional.
//   • "standalone" — chemist-shop deployment for a retail pharmacy or
//                    pharmacy chain. The hospital surfaces don't exist
//                    in the backing DB (no Patient / Admission / OPD
//                    collections, or they're empty). Sidebar collapses
//                    to just the Pharmacy module. Hospital-coupled
//                    pharmacy tabs are hidden + their routes 404. UHID
//                    lookup is hidden from Dispense (walk-in only).
//
// Set via Vite env at build time:
//   VITE_PHARMACY_MODE=standalone npm run build
//
// Default = "hospital" so existing HIS deployments are unchanged.
// ════════════════════════════════════════════════════════════════════

const RAW = (import.meta.env.VITE_PHARMACY_MODE || "").trim().toLowerCase();

// Whitelist — anything unrecognised falls back to "hospital" so a typo
// in the .env file can never accidentally hide hospital functionality.
export const PHARMACY_MODE = RAW === "standalone" ? "standalone" : "hospital";

// Convenience predicates — import these instead of comparing strings so
// the gate is consistent and easy to grep for.
export const IS_PHARMACY_STANDALONE = PHARMACY_MODE === "standalone";
export const IS_HOSPITAL_MODE       = PHARMACY_MODE === "hospital";

// Display label for the dashboard / hero banner so the user always
// knows which deployment shape they're using.
export const PHARMACY_MODE_LABEL = IS_PHARMACY_STANDALONE
  ? "Retail Pharmacy"
  : "Hospital Pharmacy";
