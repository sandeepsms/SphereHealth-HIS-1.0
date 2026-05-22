/**
 * DrugModel.js
 * Pharmacy drug master — one row per SKU (not per batch).
 * Batches with their own expiry / quantity / rate live in DrugBatch.
 */
const mongoose = require("mongoose");

const DrugSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true, trim: true, index: true },
    genericName:  { type: String, default: "", trim: true, index: true },
    brandName:    { type: String, default: "", trim: true },
    manufacturer: { type: String, default: "", trim: true },

    form: {
      type: String,
      // Drug dosage forms + non-drug item forms. The four trailing values
      // (Device, Disposable, Dressing, Pack) cover non-pharmaceutical
      // pharmacy stock so surgical items + ward consumables can live in
      // the same DrugMaster collection (one inventory + one batch ledger
      // + one FIFO/expiry pipeline for everything).
      enum: ["Tablet","Capsule","Syrup","Injection","Drops","Cream","Ointment","Inhaler","Patch","Powder","Suppository","Device","Disposable","Dressing","Pack","Other"],
      default: "Tablet",
    },
    strength:     { type: String, default: "" },        // "500 mg" / "5 mg/5 mL"
    pack:         { type: String, default: "" },        // "10 tabs/strip" / "60 mL bottle"

    category: {
      type: String,
      // Pharmaceutical categories + non-drug categories. "Surgical" covers
      // OT-specific items (blades, sutures, drapes, sterile gowns, etc.);
      // "Consumable" covers daily ward use (syringes, gauze, gloves,
      // masks, catheters, IV sets, electrodes, etc.). Keeping both in the
      // same collection lets the pharmacist run a single dispense flow
      // for any item — drug or device — without a second app.
      enum: ["Antibiotic","Analgesic","Antipyretic","Antihypertensive","Antidiabetic",
             "Cardiac","Respiratory","Neuro","Gastro","Steroid","Vitamin","Insulin",
             "IV Fluid","Topical","Surgical","Consumable","Other"],
      default: "Other",
      index: true,
    },
    schedule:     { type: String, enum: ["G","H","H1","X","OTC",""], default: "" },   // narcotic schedule

    // Tax & GST
    hsnCode:      { type: String, default: "" },
    gstRate:      { type: Number, default: 12 },        // %

    // Stock policy
    reorderLevel: { type: Number, default: 10 },        // alert threshold (units)
    defaultSalePrice: { type: Number, default: 0 },     // fallback if batch has no price

    // Flags
    // R7bb-FIX-E-19/D3-HIGH-4: isHighAlert is the canonical HAM
    // (High-Alert Medication) flag — when true, MAR.recordAdministration
    // demands TWO different nurse signatures (independent double-check
    // per ISMP guidance) before the dose can be recorded as GIVEN.
    // Pre-R7bb the flag existed but MAR didn't enforce dual-witness.
    isHighAlert:  { type: Boolean, default: false },    // insulin, opioids, anti-coagulants
    isLASA:       { type: Boolean, default: false },    // look-alike-sound-alike
    isNarcotic:   { type: Boolean, default: false },
    // R7az-MED-1 (D7-MED-1): cold-chain flag. Vaccines, insulin, biologics,
    // and certain antibiotics must stay at 2–8 °C end-to-end. Pre-R7az
    // pharmacy had no way to flag this, so a nurse could legitimately
    // requisition rapid-acting insulin in a Routine indent that would
    // sit unrefrigerated for hours before delivery. Frontend / indent
    // queue will surface a "❄ Cold-chain" badge and force-promote the
    // urgency to at least Urgent on display when this is true.
    requiresRefrigeration: { type: Boolean, default: false, index: true },
    isActive:     { type: Boolean, default: true, index: true },

    createdBy:    { type: String, default: "" },
    updatedBy:    { type: String, default: "" },
  },
  { timestamps: true }
);

DrugSchema.index({ name: 1, strength: 1, manufacturer: 1 });

module.exports = mongoose.model("PharmacyDrug", DrugSchema);
