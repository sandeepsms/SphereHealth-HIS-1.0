/**
 * NursingConsumableItem — master catalogue of chargeable nursing equipment/consumables.
 * Admins populate this list once; nurses pick from it each shift.
 *
 * Fields:
 *  name         - display name (e.g. "Oxygen Mask")
 *  category     - grouping for the UI
 *  unitPrice    - charge per use (INR)
 *  chargeOncePerDay - if true, auto-dedup: patient charged max once per calendar day
 *  isActive     - soft-delete toggle
 */

const mongoose = require("mongoose");

const NursingConsumableItemSchema = new mongoose.Schema(
  {
    name:             { type: String, required: true, trim: true },
    category:         {
      type: String,
      enum: ["Oxygen & Respiratory", "IV & Lines", "Monitoring", "Wound & Skin",
             "Urinary", "Feeding", "Disposables", "Other"],
      default: "Other",
    },
    unitPrice:        { type: Number, required: true, min: 0 },
    chargeOncePerDay: { type: Boolean, default: true },
    isActive:         { type: Boolean, default: true },
    description:      { type: String, default: "" },
  },
  { timestamps: true }
);

NursingConsumableItemSchema.index({ category: 1, isActive: 1 });

module.exports =
  mongoose.models.NursingConsumableItem ||
  mongoose.model("NursingConsumableItem", NursingConsumableItemSchema);
