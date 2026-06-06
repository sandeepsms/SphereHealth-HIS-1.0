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
      enum: ["Antibiotic","Antiviral","Antifungal","Antiparasitic",
             "Analgesic","Antipyretic","Antihypertensive","Antidiabetic",
             "Cardiac","Respiratory","Neuro","Gastro","Steroid","Vitamin","Insulin",
             "IV Fluid","Hematology","Anesthesia","Emergency","Oncology",
             "Hormone","Ophthalmic","ENT","Topical","Surgical","Consumable","Other"],
      default: "Other",
      index: true,
    },
    schedule:     { type: String, enum: ["G","H","H1","X","OTC",""], default: "" },   // narcotic schedule

    // Tax & GST
    hsnCode:      { type: String, default: "" },
    // R7hr-12-S3 (D1-08): constrain gstRate to the legal Indian GST slabs at
    // the drug-master step (defence-in-depth — mirrors PharmacySaleModel.items
    // .gstRate). Pre-R7hr-12 the master accepted any Number, so an admin
    // editing /api/pharmacy/drugs/:id with a decimal typo (180 instead of 18)
    // would silently land and the failure surfaced only at the next sale —
    // a cryptic ValidationError at dispense time instead of at the source
    // of the bad data. Slab list matches PharmacySaleModel.items.gstRate
    // (0.25% covers rough/sketched diamonds in DGFT; harmless for symmetry).
    gstRate:      {
      type: Number,
      default: 12,
      enum: {
        values: [0, 0.25, 3, 5, 12, 18, 28],
        message: "gstRate {VALUE} is not a valid GST slab (0, 0.25, 3, 5, 12, 18, 28)",
      },
    },        // %

    // Stock policy
    reorderLevel: { type: Number, default: 10 },        // alert threshold (units)
    defaultSalePrice: { type: Number, default: 0 },     // fallback if batch has no price

    // R7hr-50 — Purchase-rate sync from GRN. Pre-R7hr-50 each batch carried
    // its own purchaseRate but the Drug master had no aggregate view, so a
    // pharmacist couldn't see "what did this drug cost me last time" or
    // "what's my running average" without scanning every batch. recordGRN
    // now writes lastPurchaseRate from the most recent GRN line and
    // recomputes wac (weighted-average cost) across active batches with
    // remaining > 0. Both are inclusive-of-GST when batch.purchaseRate is
    // captured pre-GST and gstRate is on the batch (matches Indian costing
    // convention; toggle via report header if hospital wants net-of-GST).
    lastPurchaseRate: { type: Number, default: 0 },     // ₹ per unit, last GRN
    lastGRNDate:      { type: Date,   default: null },  // when lastPurchaseRate was set
    wac:              { type: Number, default: 0 },     // weighted-average cost (active batches)

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

// R7bh-F4 / R7bg-9-CRIT-1: text index for `searchDrugs` perf.
// Pre-R7bh the search endpoint did a regex scan over name/genericName/brandName
// without a backing index — on a 5k-drug master that's a full collection scan
// per keystroke. Weighted text index lets Mongo use the inverted index +
// $text $search for any query ≥ 2 chars. The controller still falls back to
// exact-shape lookup for 1-char queries so the user sees something while typing.
DrugSchema.index(
  { name: "text", genericName: "text", brandName: "text" },
  { weights: { name: 10, genericName: 8, brandName: 5 }, name: "drug_text_search" }
);

// R7hr-50 — HSN → GST anti-drift hook. Single source of truth for "HSN
// 30049011 = 12% GST" is HSNMasterModel. When a Drug is saved with an
// hsnCode that exists in the master, this hook FORCES gstRate to the
// canonical value, regardless of what the API caller passed. Closes the
// pre-R7hr-50 loophole where admin/pharmacist could type any HSN + any
// rate combination (e.g., Paracetamol HSN 30049011 saved at 18% GST).
//
// Bypass: caller may set `doc.overrideGstRate = true` (transient, not
// persisted) when GST genuinely diverges from master — e.g., a temporary
// CBIC notification. The override is auditable via updatedBy + a logged
// warning so any divergence shows up in audit reports.
DrugSchema.pre("save", async function applyHSNCanonicalGST(next) {
  if (!this.hsnCode) return next();
  if (this.overrideGstRate === true) {
    console.warn(`[DrugModel] HSN-GST override: drug=${this._id} hsn=${this.hsnCode} gst=${this.gstRate}% updatedBy=${this.updatedBy || "?"}`);
    return next();
  }
  try {
    const HSNMaster = mongoose.model("PharmacyHSNMaster");
    const master = await HSNMaster.findOne({ code: this.hsnCode, isActive: true }).lean();
    if (master && master.gstRate != null && master.gstRate !== this.gstRate) {
      this.gstRate = master.gstRate;
    }
    return next();
  } catch (err) {
    // Master may not exist yet on a fresh install — log + continue with
    // whatever gstRate the caller passed (still validated by enum above).
    if (err.name !== "MissingSchemaError") console.warn("[DrugModel] HSN lookup failed:", err.message);
    return next();
  }
});

// Mirror the same hook on findOneAndUpdate so /api/pharmacy/drugs/:id PUT
// flows through the same canonicalisation. Mongoose splits .save() from
// .findOneAndUpdate() into different middleware classes — without this
// twin hook, admin PUT-editing a drug bypasses the GST enforcement.
DrugSchema.pre("findOneAndUpdate", async function applyHSNOnUpdate(next) {
  const upd = this.getUpdate() || {};
  const $set = upd.$set || upd;
  const hsn  = $set.hsnCode;
  if (!hsn) return next();
  if (upd.overrideGstRate === true || $set.overrideGstRate === true) return next();
  try {
    const HSNMaster = mongoose.model("PharmacyHSNMaster");
    const master = await HSNMaster.findOne({ code: hsn, isActive: true }).lean();
    if (master && master.gstRate != null) {
      if (upd.$set) upd.$set.gstRate = master.gstRate;
      else upd.gstRate = master.gstRate;
      this.setUpdate(upd);
    }
    return next();
  } catch (err) {
    if (err.name !== "MissingSchemaError") console.warn("[DrugModel] HSN lookup failed (update):", err.message);
    return next();
  }
});

module.exports = mongoose.model("PharmacyDrug", DrugSchema);
