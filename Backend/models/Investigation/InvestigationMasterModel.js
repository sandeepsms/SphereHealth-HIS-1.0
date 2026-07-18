const mongoose = require("mongoose");

// ── NABL 5.4 — age/sex-stratified reference range ──────────────────
// One biological reference interval, scoped to a sex + age band. A single
// parameter (e.g. Haemoglobin) carries several of these (adult male, adult
// female, neonate, …). `resolveReferenceRange` picks the best match for a
// given patient. All bounds optional so qualitative params (e.g. "Negative")
// can carry just `text`.
const ReferenceRangeSchema = new mongoose.Schema(
  {
    _id: false,
    sex: { type: String, enum: ["M", "F", "ANY"], default: "ANY" },
    ageMinYears: { type: Number, default: 0 },      // inclusive lower bound (years)
    ageMaxYears: { type: Number, default: 200 },     // inclusive upper bound (years)
    low: { type: Number, default: null },
    high: { type: Number, default: null },
    criticalLow: { type: Number, default: null },
    criticalHigh: { type: Number, default: null },
    text: { type: String, default: "" },             // qualitative / free-text interval
  },
);

// ── A reportable parameter within a test (CBC → Hb, WBC, Platelets…) ─
const InvestigationParameterSchema = new mongoose.Schema(
  {
    _id: false,
    name: { type: String, trim: true, required: true },   // "Haemoglobin"
    unit: { type: String, trim: true, default: "" },       // "g/dL"
    loincCode: { type: String, trim: true, default: "" },
    method: { type: String, trim: true, default: "" },
    displayOrder: { type: Number, default: 999 },
    referenceRanges: { type: [ReferenceRangeSchema], default: [] },
  },
);

const InvestigationMasterSchema = new mongoose.Schema(
  {
    // Auto-generated: PATH-001, RAD-001, CARD-001
    investigationCode: {
      type: String,
      unique: true,
      uppercase: true,
      trim: true,
    },

    investigationName: {
      type: String,
      required: [true, "Investigation name is required"],
      trim: true,
    },

    shortName: {
      type: String,
      trim: true,
    },

    category: {
      type: String,
      required: true,
      enum: [
        "PATHOLOGY",
        "RADIOLOGY",
        "CARDIOLOGY",
        "MICROBIOLOGY",
        "BIOCHEMISTRY",
        "ENDOSCOPY",
        "ULTRASONOGRAPHY",
        "OTHER",
      ],
      default: "PATHOLOGY",
    },

    subCategory: {
      type: String,
      trim: true,
    },

    // INTERNAL  → hospital lab only
    // EXTERNAL  → always referred outside
    // BOTH      → either option
    performedAt: {
      type: String,
      enum: ["INTERNAL", "EXTERNAL", "BOTH"],
      default: "INTERNAL",
    },

    defaultPrice: {
      type: Number,
      required: [true, "Default price is required"],
      min: 0,
      default: 0,
    },

    sampleType: {
      type: String,
      trim: true,
    },

    tatHours: {
      type: Number,
      default: 24,
    },

    isPackage: { type: Boolean, default: false },
    packageTests: [
      {
        investigationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "InvestigationMaster",
        },
        investigationName: String,
        investigationCode: String,
      },
    ],

    isTaxable: { type: Boolean, default: false },
    taxPercentage: { type: Number, default: 0, min: 0, max: 28 },
    availableForTPA: { type: Boolean, default: true },
    requiresDoctorOrder: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 999 },
    isActive: { type: Boolean, default: true },
    description: { type: String, trim: true },

    // NABL 5.4 — reportable parameters + their age/sex-stratified reference
    // ranges. Optional (radiology / qualitative tests carry none). When
    // present, result entry resolves the interval per patient age+sex and
    // stamps the H/L/critical flag from the master instead of hand-typed
    // bounds. See InvestigationMaster.resolveReferenceRange.
    parameters: { type: [InvestigationParameterSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ── Auto-generate investigationCode before save ────────────────
// Format: PATH-001, RAD-001, CARD-001, MICRO-001 etc.
const CATEGORY_PREFIX = {
  PATHOLOGY: "PATH",
  RADIOLOGY: "RAD",
  CARDIOLOGY: "CARD",
  MICROBIOLOGY: "MICRO",
  BIOCHEMISTRY: "BIO",
  ENDOSCOPY: "ENDO",
  ULTRASONOGRAPHY: "USG",
  OTHER: "OTH",
};

InvestigationMasterSchema.pre("save", async function (next) {
  if (!this.investigationCode) {
    const prefix = CATEGORY_PREFIX[this.category] || "INV";
    // R7au-FIX-2/D1-CRIT-C3: atomic counter (same pattern as User
    // employeeId + Patient UHID). Pre-R7au the `countDocuments({regex}) + 1`
    // pattern raced under concurrent bulk-import — second insert hit
    // E11000 on unique investigationCode. Counter is per-prefix so
    // PATH/RAD/CARD series stay independent.
    const { nextSequence } = require("../../utils/counter");
    const seed = await mongoose.model("InvestigationMaster").countDocuments({
      investigationCode: { $regex: `^${prefix}-` },
    });
    const seq = await nextSequence(`invmaster:${prefix}`, seed);
    this.investigationCode = `${prefix}-${String(seq).padStart(3, "0")}`;
  }
  next();
});

// ── NABL 5.4 — resolve the reference interval for a patient ────────
// Given a parameter name + patient age (years) + sex, pick the best-matching
// ReferenceRange from the master. Preference: an age-band that contains the
// patient AND a sex-specific row beats a sex="ANY" row; among equals the
// narrowest age band wins. Returns null when the test carries no parameters
// (radiology / legacy) or nothing matches — callers then fall back to any
// hand-entered bounds. Static so services can call without a document.
//   InvestigationMaster.resolveReferenceRange(masterDoc, "Haemoglobin", 34, "F")
InvestigationMasterSchema.statics.resolveReferenceRange = function (master, parameterName, ageYears, sex) {
  const params = (master && Array.isArray(master.parameters)) ? master.parameters : [];
  if (!params.length || !parameterName) return null;
  // R9-FIX(R9-045): match parameter names normalisation- AND spelling-variant-
  // aware, not by strict equality. A tech typing "Hemoglobin" must still resolve
  // against a seeded "Haemoglobin" (and "Total WBC Count" vs "total wbc count",
  // "Leukocyte" vs "Leucocyte"), otherwise the seeded critical ranges — and thus
  // the panic-value auto-alert — silently never bind. Fold British→American
  // "ae"→"e" and strip non-alphanumerics.
  const fold = (s) => String(s || "").trim().toLowerCase().replace(/ae/g, "e").replace(/[^a-z0-9]+/g, "");
  const pkey = fold(parameterName);
  const param = params.find((p) => fold(p.name) === pkey);
  if (!param || !Array.isArray(param.referenceRanges) || !param.referenceRanges.length) return null;

  const age = Number.isFinite(Number(ageYears)) ? Number(ageYears) : null;
  const S = String(sex || "").trim().toUpperCase();
  const sexKey = S === "M" || S === "MALE" ? "M" : (S === "F" || S === "FEMALE" ? "F" : "ANY");

  const inAge = (r) => age == null || (age >= (r.ageMinYears ?? 0) && age <= (r.ageMaxYears ?? 200));
  const candidates = param.referenceRanges.filter(inAge);
  if (!candidates.length) return null;

  // Rank: sex-specific match first, then narrowest age band.
  candidates.sort((a, b) => {
    const aSex = a.sex === sexKey ? 0 : (a.sex === "ANY" ? 1 : 2);
    const bSex = b.sex === sexKey ? 0 : (b.sex === "ANY" ? 1 : 2);
    if (aSex !== bSex) return aSex - bSex;
    const aSpan = (a.ageMaxYears ?? 200) - (a.ageMinYears ?? 0);
    const bSpan = (b.ageMaxYears ?? 200) - (b.ageMinYears ?? 0);
    return aSpan - bSpan;
  });
  // Drop rows for the *other* sex entirely (M patient must not get an F row).
  const best = candidates.find((r) => r.sex === sexKey || r.sex === "ANY");
  if (!best) return null;
  return {
    parameter: param.name,
    unit: param.unit || "",
    method: param.method || "",
    low: best.low, high: best.high,
    criticalLow: best.criticalLow, criticalHigh: best.criticalHigh,
    text: best.text || "",
    sex: best.sex, ageMinYears: best.ageMinYears, ageMaxYears: best.ageMaxYears,
  };
};

InvestigationMasterSchema.index({ category: 1 });
InvestigationMasterSchema.index({ performedAt: 1 });
InvestigationMasterSchema.index({ isActive: 1 });
InvestigationMasterSchema.index({
  investigationName: "text",
  investigationCode: "text",
  shortName: "text",
});

module.exports =
  mongoose.models.InvestigationMaster ||
  mongoose.model("InvestigationMaster", InvestigationMasterSchema);
