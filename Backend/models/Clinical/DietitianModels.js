/**
 * DietitianModels.js — Dietician module data layer.
 *
 * Two models living in one file because they're tightly coupled:
 *
 *   1. DietPlanTemplate  — catalog of reusable plans (Diabetic, Renal,
 *                          Cardiac, Lactation, etc.) seeded from the
 *                          17 docx templates the hospital provided.
 *                          Can also be created/edited in-app by Dieticians
 *                          and Admins.
 *
 *   2. PatientDietPlan   — per-patient assessment + assigned plan. A
 *                          patient can have several over time
 *                          (admission-wise / OPD visit-wise).
 *                          The assessment fields capture height/weight/BMI,
 *                          comorbidities, allergies, food prefs; the plan
 *                          fields capture which template was used (snapshot)
 *                          + per-meal customisations, start/end dates,
 *                          follow-up notes.
 *
 * Loose / flexible schema design — meals are stored as a Mixed array so
 * the structure can accommodate both simple daily plans and weekly
 * (Mon–Sun) plans (Weight Loss template is weekly) without schema
 * migration.
 */
const mongoose = require("mongoose");

/* ── DietPlanTemplate ───────────────────────────────────────── */
const MealItemSchema = new mongoose.Schema({
  en:        { type: String, default: "" },   // English text
  hi:        { type: String, default: "" },   // Hindi text (optional)
  day:       { type: String, default: "" },   // for weekly plans: "Monday" .. "Sunday"
  calories:  { type: Number, default: null },
  protein:   { type: Number, default: null },
  notes:     { type: String, default: "" },
}, { _id: false });

const MealSchema = new mongoose.Schema({
  time:      { type: String, required: true }, // "Early Morning", "Breakfast", "Lunch" …
  timeHi:    { type: String, default: "" },
  items:     { type: [MealItemSchema], default: [] },
}, { _id: false });

const DietPlanTemplateSchema = new mongoose.Schema({
  name:               { type: String, required: true, trim: true },
  code:               { type: String, required: true, unique: true, trim: true, uppercase: true },
  category:           {
    type: String,
    enum: [
      "weight-loss", "cardiac", "renal", "diabetic", "diabetic-cardiac",
      "lactation", "neutropenic", "low-fiber", "low-salt", "gluten-free",
      "rt-feed", "soft", "high-protein", "normal", "fat-free",
      "vitamin-k-reference", "taste-testing", "other",
    ],
    required: true,
  },
  description:        { type: String, default: "" },
  calories:           { type: Number, default: null },     // total kcal/day if known
  protein:            { type: Number, default: null },     // total protein g/day
  durationType:       { type: String, enum: ["daily", "weekly"], default: "daily" },
  contraindications:  { type: [String], default: [] },
  indicatedFor:       { type: [String], default: [] },     // conditions this is suitable for
  meals:              { type: [MealSchema], default: [] },
  generalInstructions:{ type: [String], default: [] },
  source:             { type: String, default: "" },       // "seed" | "manual" | "imported"
  active:             { type: Boolean, default: true },
  createdBy:          { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy:          { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

DietPlanTemplateSchema.index({ category: 1, active: 1 });
DietPlanTemplateSchema.index({ name: "text", description: "text" });

/* ── PatientDietPlan ─────────────────────────────────────────
   Per-patient assessment + assigned plan. */
const PatientDietPlanSchema = new mongoose.Schema({
  // Patient identity
  UHID:               { type: String, required: true, index: true },
  patientName:        { type: String, default: "" },
  patientId:          { type: mongoose.Schema.Types.ObjectId, ref: "Patient" },
  admissionId:        { type: mongoose.Schema.Types.ObjectId, ref: "Admission" },     // null for OPD
  visitType:          { type: String, enum: ["IPD", "OPD", "ER", "DC"], default: "IPD" },

  // ── Nutritional assessment ────────────────────────────────
  assessment: {
    height:           { type: Number, default: null },   // cm
    weight:           { type: Number, default: null },   // kg
    bmi:              { type: Number, default: null },   // auto
    idealWeight:      { type: Number, default: null },
    waist:            { type: Number, default: null },
    hip:              { type: Number, default: null },

    // Vitals + labs snapshot
    bp:               { type: String, default: "" },     // "120/80"
    bloodSugarFasting:{ type: Number, default: null },
    bloodSugarPP:     { type: Number, default: null },
    hba1c:            { type: Number, default: null },
    hemoglobin:       { type: Number, default: null },
    cholesterol:      { type: Number, default: null },
    triglycerides:    { type: Number, default: null },
    creatinine:       { type: Number, default: null },
    urea:             { type: Number, default: null },
    potassium:        { type: Number, default: null },
    sodium:           { type: Number, default: null },
    albumin:          { type: Number, default: null },

    // Conditions / clinical
    conditions:       { type: [String], default: [] },   // ["diabetic", "hypertensive", "ckd-3"]
    allergies:        { type: [String], default: [] },   // ["dairy", "nuts"] — free-text food category
    // R7bb-FIX-E-9 / D6-CRIT-6: structured food-allergen list. The kitchen
    // indent endpoint copies this into KitchenIndent.allergens so the cook
    // checks against a curated enum (peanut/tree-nut/dairy/gluten/etc.)
    // rather than free-text. Falls back to `allergies[]` if the dietitian
    // doesn't populate it.
    allergens:        { type: [String], default: [] },   // ["peanut","tree-nut","dairy","egg","gluten","soy","shellfish","fish","sesame"]
    medications:      { type: [String], default: [] },   // notable drug interactions (warfarin → vit K)

    // Dietary habits
    foodPreference:   { type: String, enum: ["vegetarian", "non-vegetarian", "eggetarian", "vegan", "jain"], default: "vegetarian" },
    religiousRestrictions: { type: String, default: "" },
    dietaryHabits:    { type: String, default: "" },     // "3 meals + 2 snacks"
    appetite:         { type: String, enum: ["good", "fair", "poor", ""], default: "" },
    bowelHabits:      { type: String, default: "" },
    fluidIntake:      { type: Number, default: null },   // L/day
    swallowing:       { type: String, enum: ["normal", "difficulty", "tube-fed", ""], default: "normal" },

    // Lifestyle
    alcohol:          { type: Boolean, default: false },
    smoking:          { type: Boolean, default: false },
    physicalActivity: { type: String, default: "" },
    recentWeightChange: { type: Number, default: null }, // kg in last 3 months (negative = loss)

    notes:            { type: String, default: "" },
    assessedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assessedAt:       { type: Date, default: Date.now },
  },

  // ── Assigned plan ─────────────────────────────────────────
  plan: {
    templateId:       { type: mongoose.Schema.Types.ObjectId, ref: "DietPlanTemplate" },
    templateCode:     { type: String, default: "" },
    templateName:     { type: String, default: "" },
    meals:            { type: [MealSchema], default: [] },   // snapshot — copied from template at assignment time
    customisations:   { type: String, default: "" },          // free-text overrides
    targetCalories:   { type: Number, default: null },
    targetProtein:    { type: Number, default: null },
    fluidRestriction: { type: Number, default: null },        // ml/day
    saltRestriction:  { type: Number, default: null },        // g/day
    notes:            { type: String, default: "" },
    instructions:     { type: [String], default: [] },
  },

  // Lifecycle
  status:             { type: String, enum: ["draft", "active", "completed", "cancelled"], default: "draft", index: true },
  startDate:          { type: Date, default: Date.now },
  endDate:            { type: Date, default: null },
  followUpAt:         { type: Date, default: null },
  followUpNotes:      { type: String, default: "" },

  // Audit
  assignedBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  assignedAt:         { type: Date, default: Date.now },
  updatedBy:          { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

// Auto-calc BMI before save if height + weight present.
PatientDietPlanSchema.pre("save", function (next) {
  const a = this.assessment || {};
  if (a.height && a.weight && !a.bmi) {
    const m = Number(a.height) / 100;
    if (m > 0) this.assessment.bmi = Number((Number(a.weight) / (m * m)).toFixed(1));
  }
  next();
});

PatientDietPlanSchema.index({ UHID: 1, status: 1, createdAt: -1 });
PatientDietPlanSchema.index({ admissionId: 1, status: 1 });

module.exports = {
  DietPlanTemplate: mongoose.model("DietPlanTemplate", DietPlanTemplateSchema),
  PatientDietPlan:  mongoose.model("PatientDietPlan",  PatientDietPlanSchema),
};
