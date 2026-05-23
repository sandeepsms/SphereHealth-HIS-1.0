// Backend/models/HospitalModel.js
// ────────────────────────────────────────────────────────────────────
// R7bh-F3 / R7bg-1-CRIT-8: Minimal Hospital stub registration so that
// `ref: "Hospital"` references scattered across schemas (BillingAudit,
// CashierSession, TPA configs, multi-tenant tags, etc.) don't throw
// MissingSchemaError on populate(). The real hospital metadata still
// lives in `Backend/config/*` and `Frontend/src/config/hospital.js`
// for now; this stub is purely a placeholder collection so Mongoose
// populate() resolves cleanly.
//
// When a real Hospital collection is provisioned (multi-tenant rollout),
// this file becomes the canonical schema — fields below are the bare
// minimum for the demographic-printable / GST-eligible shape so future
// migrations don't have to backfill column names.
// ────────────────────────────────────────────────────────────────────
const mongoose = require("mongoose");

const hospitalSchema = new mongoose.Schema(
  {
    code: { type: String, unique: true, sparse: true, trim: true, uppercase: true },
    name: { type: String, trim: true },
    legalName: { type: String, trim: true, default: null },
    address: { type: String, default: null },
    state: { type: String, default: null },
    gstin: { type: String, default: null, trim: true, uppercase: true },
    nabhAccreditation: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "hospitals" }
);

// The guard prevents OverwriteModelError if any boot-order race
// re-registers this model (e.g. if a controller loads it while
// Backend/index.js is mid-require). Same pattern used for
// AutoBilledItems / NursingChargeEntry across the codebase.
module.exports = mongoose.models.Hospital || mongoose.model("Hospital", hospitalSchema);
