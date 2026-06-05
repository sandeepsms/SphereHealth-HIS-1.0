/**
 * HSNMasterModel.js  —  R7hr-50
 *
 * Canonical HSN → GST registry. Single source of truth for "HSN 30049011
 * carries 12% GST" relationships. Pre-R7hr-50 the Drug master stored
 * `hsnCode` and `gstRate` as two independent fields with no validation tie,
 * so a pharmacist could record HSN 30049011 (Paracetamol) at 18% GST on
 * one drug and 12% on another without detection. GSTR-1 line 12 + CBIC
 * audit guidance both require HSN-to-GST consistency; this collection
 * makes the relationship enforceable and auditable.
 *
 * Population: seeded by `Backend/scripts/seedHSNMaster.js`. Admin can
 * extend via /api/pharmacy/hsn POST when a new HSN appears (requires
 * pharmacy.settings action).
 *
 * Drug pre-save hook (R7hr-50) consults this table — if `Drug.hsnCode`
 * matches an HSNMaster entry, `Drug.gstRate` is FORCED to the canonical
 * rate. Override is only possible via explicit `overrideGstRate: true`
 * + auditable reason (anti-pattern; reserved for one-off DGFT cases).
 */
const mongoose = require("mongoose");

const HSNMasterSchema = new mongoose.Schema(
  {
    // CBIC HSN code as a string — leading zeros + 6-/8-digit variants matter.
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      unique: true,
      index: true,
    },

    // Short human-readable label shown in autocomplete hints.
    // Example: "Medicaments containing antibiotics — Paracetamol formulations"
    description: { type: String, default: "" },

    // Canonical GST rate per CBIC notification. Mirrors the slab enum on
    // DrugModel so a row here can never be unreachable from the drug side.
    gstRate: {
      type: Number,
      required: true,
      enum: {
        values: [0, 0.25, 3, 5, 12, 18, 28],
        message: "gstRate {VALUE} is not a valid GST slab",
      },
    },

    // Optional broad category for grouped browsing in the picker UI.
    // "Medicines" / "Surgical" / "Consumable" / "Equipment" / "Other".
    category: {
      type: String,
      enum: ["Medicines", "Surgical", "Consumable", "Equipment", "Diagnostic", "Other"],
      default: "Medicines",
      index: true,
    },

    // Audit fields — who seeded / last edited this row.
    createdBy: { type: String, default: "seed" },
    updatedBy: { type: String, default: "" },
    isActive:  { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

// Fast prefix lookup for typeahead — pharmacist types "3004" and we surface
// every medicaments code without a full collection scan.
HSNMasterSchema.index({ code: 1, isActive: 1 });

module.exports = mongoose.model("PharmacyHSNMaster", HSNMasterSchema);
