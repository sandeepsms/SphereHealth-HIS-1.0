/**
 * seedDoctorNotesAllTypes.js — seed 5 doctor notes of EVERY note type for one
 * patient, each populated with type-appropriate content so the card builders
 * (buildDoctorNoteCardHtml TYPE_BUILDERS) render fully — no empty cards.
 *
 * Types (the DoctorNotes "Add a Note" picker set): initial, daily, general,
 * icu, procedure, consultation, preop, postop, discharge, death.
 *
 *   Run: node Backend/scripts/seedDoctorNotesAllTypes.js            (UH01)
 *        node Backend/scripts/seedDoctorNotesAllTypes.js UH07 3     (UH07, 3 each)
 *
 * Idempotent: rows carry `_demoSeed:true` + `_demoBatch:"allTypes"`; a re-run
 * deletes the prior batch first. Raw insert bypasses Mongoose validators
 * (demo data for print/preview, not a clinical write path).
 *
 * NOTE: 5× death/discharge/initial per patient is clinically unreal — this is
 * a TEMPLATE showcase so every note type's rendering can be seen at volume.
 */
"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");

if (!process.env.MONGO_URI) { console.error("FATAL: MONGO_URI missing"); process.exit(1); }
const UHID  = (process.argv[2] || "UH01").toUpperCase();
const COUNT = Math.max(1, Math.min(parseInt(process.argv[3], 10) || 5, 20));

const now = new Date();
let admit = new Date(now.getTime() - 14 * 86400000);   // fallback; re-anchored to the real admission date in main()
const at = (dayOffset, h = 10, min = 0) => {
  const d = new Date(admit.getTime() + dayOffset * 86400000);
  d.setHours(h, min, 0, 0); return d;
};

const DR = "Dr. Sandeep Kumar";
const yn = (i) => (i % 5 === 3 ? "No" : "Yes");   // occasional "No" for realism

/* Per-type content generator → { noteDetails, soap }.  i = 1..COUNT */
const CONTENT = {
  initial: (i) => ({
    section: "doctor",
    noteDetails: { doctor: {
      chiefComplaints: `Episode ${i}: fever, right-foot ulcer with discharge, drowsiness.`,
      historyOfPresentingIllness: `Diabetic × 12y; ulcer worsened over ${5 + i} days with high-grade fever and rigors.`,
      pastMedicalHistory: "Type-2 DM × 12y, Hypertension × 6y.",
      familyHistory: "Father — diabetic.", socialHistory: "Non-smoker, occasional alcohol.",
      generalExamination: `Febrile ${38 + (i % 2)}.${i}°C, PR ${100 + i*2}, BP 96/60, GCS E3V4M5; right plantar ulcer 4×3 cm.`,
      systemicExamination: "CVS tachycardia; RS bibasal crepts; CNS drowsy no focal deficit.",
      provisionalDiagnosis: "Septic diabetic foot with sepsis.",
      workingDiagnosis: "Right diabetic foot infection with sepsis.",
      differentialDiagnosis: "Cellulitis of foot; osteomyelitis; necrotising fasciitis (excluded clinically); diabetic ketoacidosis.",
      icd10: "E11.52", icd10Description: "Type-2 diabetes mellitus with diabetic peripheral angiopathy with gangrene",
      patientStatus: "Critical",
      reviewOfSystems: { cvs: "Tachycardia, no murmur", rs: "Bibasal crepts", git: "Soft abdomen, no organomegaly", gut: "Reduced urine output", cns: "Drowsy, GCS 12, no focal deficit", skin: "Right foot ulcer with cellulitis" },
      comorbidities: { diabetes: true, hypertension: true },
      elosDays: "12", goalOfCare: "Curative",
      investigations: "CBC, CRP, procalcitonin, blood & wound cultures, RFT/electrolytes, HbA1c, ABG, X-ray right foot, venous Doppler.",
      treatmentPlan: "IV meropenem + insulin infusion, fluid resuscitation, urgent surgical debridement, daily aseptic dressing, strict glycaemic + sepsis monitoring, physiotherapy referral.",
      dietAdvice: "Diabetic diet, ~1800 kcal, high protein.",
      activityAdvice: "Bed rest with foot elevation; mobilise with physiotherapy as tolerated.",
      prognosis: "Guarded at admission; good with early source control and glycaemic optimisation.",
      functionalEcog: "3 (limited self-care, bed-bound >50% of waking hours)",
      codeStatus: "Full code",
    } },
  }),
  daily: (i) => ({
    soap: {
      subjective: `Day ${i}: ${i > 2 ? "improving, afebrile" : "fever settling"}, mild wound pain.`,
      objective: `PR ${88 + i}, BP 11${i}/70, SpO2 9${6 + (i % 3)}%. Wound ${i > 2 ? "granulating" : "post-debridement clean"}.`,
      assessment: `Diabetic foot infection ${i > 2 ? "recovering; sepsis resolved" : "responding to IV meropenem"}.`,
      plan: `Continue antibiotics, daily dressing, insulin sliding scale${i > 3 ? ", plan discharge" : ", physio referral"}.`,
    },
  }),
  general: (i) => ({
    soap: { subjective: `General note ${i}: Family counselled about diabetic foot care, glycaemic control and follow-up. Patient reassured, queries addressed.` },
  }),
  icu: (i) => ({
    noteDetails: {
      ventilatorStatus: i % 2 ? "SIMV, FiO2 40%, PEEP 5" : "Weaning trial — T-piece",
      vasopressors: i < 2 ? "Noradrenaline 0.08 µg/kg/min" : "Nil (weaned)",
      sedationStatus: "RASS -1, Fentanyl infusion",
      invasiveLines: "Right IJV CVC, Left radial arterial line, Foley",
      goalsOfCare: "Source control + organ support; full escalation.",
      familyMeeting: `Day ${i}: prognosis explained to son; agreeable to plan.`,
      bundleCompliance: {
        vapHobElevated: "Yes", vapOralCare: "Yes", dvtProphylaxis: "Yes",
        stressUlcerProphylaxis: "Yes", glucoseControl: yn(i),
      },
    },
    soap: { assessment: `ICU day ${i}: septic shock ${i > 2 ? "resolving, off pressors" : "on pressors, lactate clearing"}.` },
  }),
  procedure: (i) => ({
    noteDetails: {
      procedureName: i % 2 ? "Wound debridement (right foot)" : "Central line insertion (right IJV)",
      indication: i % 2 ? "Septic diabetic foot — necrotic tissue" : "Vasopressor access + monitoring",
      anatomicalSite: i % 2 ? "Right plantar foot" : "Right internal jugular",
      operator: DR, assistants: "Dr. Verma", consentType: "Written informed consent",
      asepsisMaintained: "Yes — full barrier", timeoutPerformed: "Yes",
      complications: "None", specimens: i % 2 ? "Tissue for C/S" : "Nil",
      postProcedureVitals: "Stable, no bleeding",
    },
    soap: { objective: "Under LA, aseptic technique, procedure uneventful.", assessment: `Procedure ${i} completed successfully; swab/instrument count correct.` },
  }),
  consultation: (i) => ({
    noteDetails: {
      referredBy: DR, referredTo: ["Dr. Rao (Endocrine)", "Dr. Iyer (Vascular)", "Dr. Sethi (Nephro)"][i % 3],
      speciality: ["Endocrinology", "Vascular Surgery", "Nephrology"][i % 3],
      consultReason: `Consult ${i}: ${["glycaemic optimisation", "limb vascularity assessment", "AKI evaluation"][i % 3]}.`,
    },
    soap: {
      subjective: "58M diabetic with septic foot, reviewed at bedside.",
      assessment: ["Uncontrolled DM — start basal-bolus insulin.", "Palpable pulses, limb salvageable.", "Pre-renal AKI, improving with fluids."][i % 3],
      plan: "Recommendations charted; will review in 48h.",
    },
  }),
  preop: (i) => ({
    noteDetails: {
      plannedProcedure: "Wound debridement under regional block", asaClass: `ASA ${2 + (i % 2)}E`,
      nbmStatus: "NBM since 06:00",
      preopChecklist: {
        identityConfirmed: "Yes", consentSigned: "Yes", siteMarked: "Yes",
        allergiesReviewed: "Yes", bloodAvailable: yn(i), imagingAvailable: "Yes", anaesthetistReview: "Yes",
      },
    },
  }),
  postop: (i) => ({
    noteDetails: {
      procedurePerformed: "Wound debridement (right foot)",
      postopVitals: `PR ${86 + i}, BP 118/76, SpO2 98%`, consciousness: "Fully conscious",
      painScore: `${2 + (i % 3)}/10`, complications: "Nil",
      wardTransferTime: at(i, 14, 30).toLocaleString("en-IN"),
    },
  }),
  discharge: (i) => ({
    noteDetails: {
      admissionDate: admit.toLocaleDateString("en-IN"), dischargeDate: at(13, 11).toLocaleDateString("en-IN"),
      lengthOfStay: "14 days", outcome: "Recovered", disposition: "Home — stable, ambulant with footwear",
      dischargeMedications: "Tab Linezolid 600 BD ×7d; Insulin Glargine 18U HS; Tab Amlodipine 5 OD; daily dressing.",
    },
    soap: {
      subjective: `Discharge summary ${i}: admitted with septic diabetic foot, treated with debridement + IV antibiotics.`,
      assessment: "Sepsis resolved, wound granulating, glycaemia controlled.",
      plan: "Foot offloading, daily dressing, review OPD in 7 days, sugar monitoring at home.",
    },
  }),
  death: (i) => ({
    noteDetails: {
      timeOfDeath: at(i, 4, 15).toLocaleString("en-IN"), modeOfDeath: "Cardiorespiratory arrest",
      placeOfDeath: "ICU", certifiedBy: DR, certifiedByReg: "HMC-45821",
      causeDeath1: "Septic shock with multi-organ dysfunction",
      causeDeath2: "Necrotising diabetic foot infection", contributing: "Type-2 DM, Hypertension",
      familyInformed: "Son (Suresh Kumar)", familyInformedBy: DR, familyInformedTime: at(i, 4, 30).toLocaleString("en-IN"),
      mlcRequired: "No", postMortemDone: "No", deathCertificateNumber: `MCCD-2026-${100 + i}`,
      bodyDisposition: "Handed over to family after documentation.",
    },
  }),
};

const TYPE_ORDER = ["initial", "daily", "general", "icu", "procedure", "consultation", "preop", "postop", "discharge", "death"];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Patient = require("../models/Patient/patientModel");
  const Admission = require("../models/Patient/admissionModel");
  const DoctorNotes = require("../models/Doctor/DoctorNotesModel");

  const patient = await Patient.findOne({ UHID }).lean();
  if (!patient) { console.error(`No patient ${UHID}`); process.exit(1); }
  const adm = await Admission.findOne({ UHID }).sort({ admissionDate: -1 }).lean();
  const ipdNo = adm?.admissionNumber || "";
  const admissionId = adm?._id || null;
  if (adm?.admissionDate) admit = new Date(adm.admissionDate);   // anchor note dates to the admission banner (date coherence)
  console.log(`✅ ${UHID} (${patient.fullName || patient.firstName}) · admission ${ipdNo} · ${COUNT} of each type\n`);

  // "initial" is unique-per-admission (uniq_initial_per_admission_section) —
  // NABH allows exactly ONE Initial Assessment per admission, so it's capped
  // at 1 (upserted) while every other type gets COUNT copies.
  const perType = (type) => (type === "initial" ? 1 : COUNT);

  const docs = [];
  TYPE_ORDER.forEach((type, t) => {
    if (type === "initial") return;                          // handled via upsert below
    for (let i = 1; i <= perType(type); i++) {
      const vd = at(i * 2 + (t % 2), 8 + (t % 10), (i * 7) % 60);   // spread across the stay
      const c = CONTENT[type](i);
      docs.push(Object.assign({
        UHID, patientUHID: UHID, ipdNo, admissionId,
        noteType: type, section: c.section || "doctor",
        doctorName: DR, signedByName: DR, doctorRegNo: "HMC-45821",
        status: "signed", signedAt: vd, visitDate: vd, createdAt: vd, updatedAt: now,
        _demoSeed: true, _demoBatch: "allTypes",
      }, c.noteDetails ? { noteDetails: c.noteDetails } : {}, c.soap ? { soap: c.soap } : {}));
    }
  });

  await DoctorNotes.collection.deleteMany({ _demoSeed: true, _demoBatch: "allTypes", UHID });
  const res = await DoctorNotes.collection.insertMany(docs, { ordered: false });
  const inserted = res.insertedCount || docs.length;

  // Initial Assessment — upsert the single allowed row (updates the existing
  // IA if one exists, else creates it) so it never collides with the unique index.
  const iaVd = at(0, 12);
  const iaC = CONTENT.initial(1);
  await DoctorNotes.collection.updateOne(
    { admissionId, noteType: "initial", section: "doctor" },
    { $set: {
        UHID, patientUHID: UHID, ipdNo, admissionId, noteType: "initial", section: "doctor",
        doctorName: DR, signedByName: DR, doctorRegNo: "HMC-45821",
        status: "signed", signedAt: iaVd, visitDate: iaVd, updatedAt: now,
        noteDetails: iaC.noteDetails, _demoSeed: true, _demoBatch: "allTypes",
      }, $setOnInsert: { createdAt: iaVd } },
    { upsert: true },
  );

  // Per-type summary
  TYPE_ORDER.forEach((type) =>
    console.log(`   ✅ ${type.padEnd(14)} +${perType(type)}${type === "initial" ? "  (unique per admission — upserted)" : ""}`));
  console.log(`\n🎉 Seeded ${inserted} + 1 IA = ${inserted + 1} doctor notes across ${TYPE_ORDER.length} types for ${UHID}.`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error("❌ seed failed:", e.stack || e.message); process.exit(1); });
