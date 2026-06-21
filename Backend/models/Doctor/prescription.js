const mongoose = require("mongoose");

const prescriptionSchema = new mongoose.Schema(
  {
    // ── Patient ───────────────────────────────────────────────
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    UHID: { type: String, required: true, uppercase: true },
    patientName: String,
    // Patient-safety audit A-06: bounded age (0–150 mirrors patientModel)
    // and gender enum keep paediatric-dosing logic and pregnancy-flag
    // workflows reliable. "Other" is included so non-binary patients
    // and missing data flow through without throwing.
    age: { type: Number, min: 0, max: 150 },
    gender: { type: String, enum: ["Male", "Female", "Other", ""], default: "" },
    contactNumber: String,
    fatherName: String,
    department: String,
    date: { type: Date, default: Date.now },

    // ── Doctor ────────────────────────────────────────────────
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },
    doctorName: String,
    referredBy: String,

    registrationType: {
      type: String,
      enum: ["OPD", "IPD", "Emergency", "Daycare"],
      default: "OPD",
    },

    // ── Clinical ──────────────────────────────────────────────
    clinicalDetails: {
      historyOfAllergy: String,
      historyOfPresentIllness: String,
      physicalExamination: String,
    },

    // Patient-safety bounds — same envelope as NurseVitalsSchema so
    // OPD-side and IPD-side share the same definition of "physiologically
    // possible". Patient-safety audit 2026-05-17 A-02.
    vitals: {
      weight:          { type: Number, min: 0,   max: 500 },
      temperature:     { type: Number, min: 25,  max: 45 },
      bloodPressure:   { type: String, match: /^\d{2,3}\/\d{2,3}$/ },
      pulse:           { type: Number, min: 0,   max: 300 },
      respiratoryRate: { type: Number, min: 0,   max: 80 },
      spo2:            { type: Number, min: 0,   max: 100 },
    },

    provisionalDiagnosis: { type: String, required: true },

    // ── Medicines ─────────────────────────────────────────────
    medicines: [
      {
        medicineName: { type: String, required: true, trim: true, minlength: 1 },
        schedule: String,
        instruction: String,
        // Enum-constrained route so a typo like "Orall" or freeform text
        // can't poison MAR / pharmacy downstream. Patient-safety audit A-07.
        route: {
          type: String,
          // R7hr-252 (audit: route vocabulary mismatch) — widened to also accept
          // the prescription picker's full-word routes so a valid selection can't
          // fail validation / silently default to "Oral".
          enum: ["Oral", "IV", "IM", "SC", "SL", "PR", "PV", "Topical", "Inhalation", "Nebulisation", "Ophthalmic", "Otic", "Nasal", "Rectal", "Transdermal", "Sublingual", "Buccal", "NG Tube", "PEG Tube", "Per Rectum", "Intradermal", "Intra-articular", "Eye Drops", "Ear Drops", "Intranasal", "Subcutaneous", "Intramuscular", "Intravenous"],
          default: "Oral",
        },
        days: { type: String, default: "1" },
      },
    ],

    // ── Services (ref: ServiceMaster) ─────────────────────────
    // Doctor selects service name only — billing handled by backend
    selectedServices: [
      {
        serviceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ServiceMaster",
          default: null,
        },
        serviceName: { type: String, default: "" },
        serviceCode: { type: String },
      },
    ],

    // ── Investigations (ref: InvestigationMaster) ─────────────
    investigations: [
      {
        investigationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "InvestigationMaster",
          default: null,
        },
        investigationName: { type: String, default: "" },
        investigationCode: { type: String },
        chargedPrice: { type: Number, default: 0 },
        tariffType: {
          type: String,
          enum: ["CASH", "TPA", "CORPORATE"],
          default: "CASH",
        },
      },
    ],

    advice: String,

    prescriptionDate: { type: Date, default: Date.now },

    status: {
      type: String,
      enum: ["Active", "Completed", "Cancelled", "CREATED", "FINAL"],
      default: "Active",
    },

    isActive: { type: Boolean, default: true },

    // ── Lab Orders auto-created when investigations present ────
    labOrderIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "InvestigationOrder",
      },
    ],

    // Override flag for the F-08 drug-allergy gate. Must be declared on
    // the schema — otherwise Mongoose's default `strict: true` silently
    // strips it before the pre-save hook runs, breaking the clinician's
    // documented bypass path (re-audit R11 follow-up). The reason is
    // persisted with the prescription so a NABH reviewer can see why a
    // drug was prescribed against a known allergy.
    _allergyOverrideReason: { type: String, default: "" },

    // R7bh-F1 / R7bg-7-CRIT-2: PrintAudit infrastructure $incs this
    // on every prescription print/reprint. Pre-R7bh Prescription had
    // no printCount field, so $inc no-op'd → no DUPLICATE watermark
    // on reprinted Rx (D&C / NMC reprint trail gap).
    printCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

prescriptionSchema.index({ patient: 1, createdAt: -1 });
prescriptionSchema.index({ UHID: 1 });
prescriptionSchema.index({ doctor: 1 });
prescriptionSchema.index({ prescriptionDate: -1 });

// ── Post-init snapshot for post-dispense edit lock (audit F-07) ──
// Snap the status + medicines hash at load time so the next pre-save
// can refuse edits to medicines[] once the Rx hits a terminal state.
prescriptionSchema.post("init", function () {
  this._priorStatus = this.status;
  this._priorMedicinesHash = JSON.stringify(this.medicines || []);
});

prescriptionSchema.pre("save", function (next) {
  if (this.isNew || !this._priorStatus) return next();
  const terminal = new Set(["Completed", "Cancelled", "FINAL"]);
  if (terminal.has(this._priorStatus)) {
    // The only legal write on a terminal Rx is the status field
    // itself (e.g. someone re-opening — which the existing F-06
    // pattern already discourages) and metadata like updatedAt.
    // Medicines / investigations / advice are frozen.
    const currentHash = JSON.stringify(this.medicines || []);
    if (currentHash !== this._priorMedicinesHash) {
      return next(new Error(
        `Cannot edit medicines on a ${this._priorStatus} prescription — ` +
        `pharmacy may have already dispensed. Create a new prescription instead.`,
      ));
    }
  }
  next();
});

// ── Drug-allergy gate (patient-safety audit F-08) ─────────────────
// Cross-reference the medicines[] array against the patient's recorded
// allergies (Patient.knownAllergies + clinicalDetails.historyOfAllergy)
// at save time. Substring match (case-insensitive) — if the medicine
// name OR generic name on the prescription contains an allergen string,
// we throw. Doctor can suppress with the per-document override flag
// `_allergyOverrideReason` (audited via the existing activity-log path),
// which lets a senior clinician knowingly prescribe a drug a patient is
// allergic to (e.g. desensitisation, ICU rescue). Without the override
// the schema refuses the save.
//
// Cheap (one regex per medicine × allergies), runs on every save +
// findOneAndUpdate with runValidators. False positives are possible
// (e.g. "lactose" in an excipient) — clinicians can override with a
// documented reason. False negatives (e.g. an unlisted brand name)
// remain a feature, not a bug — this is a safety net, not a substitute
// for clinical judgment.
prescriptionSchema.pre("save", async function (next) {
  // R7hr-12-S3 (D1-10): Skip the allergy gate when this is an existing
  // doc whose medicines[] is unchanged — metadata-only saves (status
  // flip, printCount $inc, etc.) shouldn't pay the Patient.findById
  // lookup tax or risk re-throwing on an unchanged set. New docs and
  // any save that touches medicines[] still run the full check.
  if (!this.isNew && !this.isModified("medicines")) return next();
  if (!Array.isArray(this.medicines) || this.medicines.length === 0) return next();

  // Gather allergy strings from the prescription's own clinicalDetails
  // (set by the doctor on this very form) AND from the Patient master
  // record (the canonical "knownAllergies"). Either source is enough
  // to raise the alert.
  const allergyStrings = [];
  const local = (this.clinicalDetails && this.clinicalDetails.historyOfAllergy) || "";
  if (local && local.trim() && !/^none|^nil|^nka|^no known/i.test(local.trim())) {
    allergyStrings.push(...local.split(/[,;\n]/));
  }
  try {
    if (this.patient) {
      const Patient = mongoose.model("Patient");
      const pat = await Patient.findById(this.patient).select("knownAllergies").lean();
      const remote = (pat && pat.knownAllergies) || "";
      if (remote && remote.trim() && !/^none|^nil|^nka|^no known/i.test(remote.trim())) {
        allergyStrings.push(...remote.split(/[,;\n]/));
      }
    }
  } catch (e) {
    // R7hr-12-S3 (D1-10): FAIL-CLOSED on Patient lookup failure. This
    // is a clinical safety gate — silently bypassing it on an infra
    // hiccup is the wrong default (fail-open hides Mongo outages from
    // the prescriber and lets an allergic prescription land in MAR).
    // Surface the error so the operator can resolve and retry; the
    // override flag (_allergyOverrideReason) remains the documented
    // escape hatch — if the clinician has already set it, honour the
    // override even on infra failure (the audit trail is preserved).
    console.error("[Prescription] allergy patient lookup failed:", e.message);
    if (this._allergyOverrideReason) {
      console.warn(
        `[Prescription] OVERRIDE: patient ${this.UHID} prescribed with allergy override (Patient lookup failed) — reason: ${this._allergyOverrideReason}`,
      );
      return next();
    }
    return next(new Error(
      `Allergy gate unavailable — patient allergy lookup failed (${e.message}). ` +
      `Retry the save, or set _allergyOverrideReason with a documented clinical reason to proceed.`,
    ));
  }
  const allergens = [...new Set(allergyStrings.map((s) => s.trim()).filter(Boolean))];

  if (allergens.length === 0) return next();
  if (this._allergyOverrideReason) {
    console.warn(
      `[Prescription] OVERRIDE: patient ${this.UHID} prescribed with allergy override — reason: ${this._allergyOverrideReason}`,
    );
    return next();
  }

  const hits = [];
  for (const med of this.medicines) {
    const probe = String((med && (med.medicineName || med.genericName || "")) || "").toLowerCase();
    if (!probe) continue;
    for (const allergen of allergens) {
      const a = allergen.toLowerCase();
      if (a.length < 3) continue; // ignore noise like "no"
      if (probe.includes(a)) {
        hits.push(`${med.medicineName} vs "${allergen}"`);
      }
    }
  }
  if (hits.length) {
    return next(new Error(
      `Allergy alert — possible match(es): ${hits.join("; ")}. ` +
      `Set _allergyOverrideReason on the document with a documented clinical reason to proceed.`,
    ));
  }
  next();
});

module.exports = mongoose.model("Prescription", prescriptionSchema);
