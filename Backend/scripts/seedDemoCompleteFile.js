/**
 * seedDemoCompleteFile.js — populate ONE patient (UH01) with a realistic,
 * coherent complex-ICU journey so the "Complete Patient File" print shows
 * every full-coverage section filled (physio, med-recon, procedures, ADR,
 * food reaction, PROM/PREM, code-blue, advances, appointment, medical
 * certificate, ER visit) + the patient-linked NABH safety registers.
 *
 *   Scenario: 58M diabetic, brought by ambulance to ER with a septic
 *   diabetic-foot ulcer → ICU → debridement (OT) → complications
 *   (CAUTI, sacral pressure ulcer, agitation/restraint, a near-miss and a
 *   caught med-error, one Code Blue) → physiotherapy → discharged fit.
 *   Mortality / LAMA / sentinel registers are intentionally NOT seeded —
 *   they'd contradict a surviving, normally-discharged patient.
 *
 * Idempotent: every inserted row carries `_demoSeed:true`; a re-run deletes
 * the prior demo rows first. Raw collection inserts bypass Mongoose
 * validators (this is demo data for print, not a clinical write path).
 *
 * Run: node Backend/scripts/seedDemoCompleteFile.js            (UH01)
 *      node Backend/scripts/seedDemoCompleteFile.js UH07        (other UHID)
 */
"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");

if (!process.env.MONGO_URI) { console.error("FATAL: MONGO_URI missing"); process.exit(1); }
const UHID = (process.argv[2] || "UH01").toUpperCase();

// Resolve a model file (direct export / default / named) → mongoose Model.
function resolveModel(p) {
  let m; try { m = require(p); } catch (e) { return null; }
  if (m && m.collection && typeof m.insertMany === "function") return m;
  if (m && m.default && m.default.collection) return m.default;
  for (const v of Object.values(m || {})) {
    if (v && v.collection && typeof v.insertMany === "function") return v;
  }
  return null;
}

const now = new Date();
let admit = new Date(now.getTime() - 14 * 86400000);          // fallback; re-anchored to the real admission date in main()
const day = (n, h = 10, min = 0) => {                          // day n of stay
  const d = new Date(admit.getTime() + n * 86400000);
  d.setHours(h, min, 0, 0); return d;
};
const future = (n) => new Date(now.getTime() + n * 86400000);
// "YYYY-MM-DD" for day n of the stay (VitalSheet keys on a date string, and
// {uhid,date} is unique — so each sheet needs its own local-time date).
const dstr = (n) => { const d = new Date(admit.getTime() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`✅ Mongo connected — seeding demo journey for ${UHID}\n`);

  const Patient   = resolveModel("../models/Patient/patientModel");
  const Admission = resolveModel("../models/Patient/admissionModel");
  const patient = await Patient.findOne({ UHID }).lean();
  if (!patient) { console.error(`No patient ${UHID}`); process.exit(1); }
  const adm = await Admission.findOne({ UHID }).sort({ admissionDate: -1 }).lean();
  const admissionId = adm?._id || null;
  // Anchor the whole seeded journey to the REAL admission date so the printed
  // Complete File's day-wise timeline lines up with the admission banner (no
  // 40-day void). Falls back to the now-14d default if the admission has none.
  if (adm?.admissionDate) admit = new Date(adm.admissionDate);
  console.log(`   patient: ${patient.fullName || patient.firstName} · admission: ${adm?.admissionNumber || "—"}\n`);

  // ── 1. Enrich demographics (previously-dropped registration fields) ──
  await Patient.collection.updateOne({ _id: patient._id }, { $set: {
    companionName: "Suresh Kumar", companionRelationship: "Son", companionContact: "9876543210",
    email: patient.email || "ramesh.family@example.com",
    maritalStatus: patient.maritalStatus || "Married",
    paymentType: "TPA / Cashless", policyNumber: "STAR-HLTH-99887766",
    address: Object.assign({}, patient.address, {
      completeAddress: (patient.address && patient.address.completeAddress) || "H.No 42, Gandhi Colony",
      district: "Sonipat", city: "Sonipat", state: "Haryana", pincode: "131001",
    }),
  } });
  if (admissionId) {
    await Admission.collection.updateOne({ _id: admissionId }, { $set: {
      triageLevel: "Red (Emergent)", erType: "Medical Emergency",
      broughtBy: "Suresh Kumar (son)", modeOfArrival: adm.modeOfArrival || "Ambulance",
      // Full structured Nursing Initial Assessment — the exact shape the
      // NurseInitialAssessmentPage form saves (POST /admissions/:id/nurse-
      // assessment). Populating it here lets the Complete File print the
      // COMPLETE head-to-toe nursing IA, not just a couple of lines.
      nurseInitialAssessment: {
        assessedAt: admit, nurseName: "Sunita Patil", assessedBy: "Sunita Patil",
        signedAt: admit, nurseId: "N-1042", designation: "Staff Nurse",
        ward: "ICU", bedNo: "ICU-3", modeOfAdmit: "Ambulance (via ER)",
        vitals: {
          bpSys: "96", bpDia: "60", pulse: "118", temp: "39.4", spo2: "94", rr: "24",
          weight: "72", height: "168", bmi: "25.5", painScore: "6",
          consciousnessLevel: "Drowsy (GCS 12)", pupils: "Equal & Reacting", gcs: "12", glucometer: "342",
        },
        systemAssessment: {
          neuroStatus: "Drowsy, GCS 12", neuroNotes: "Rousable to voice, no focal deficit",
          respiratoryPattern: "Tachypnoeic", breathSounds: "Bibasal crepts", oxygenSupport: "Yes", oxygenLPM: "4",
          heartSounds: "S1S2 normal, tachycardia", capRefill: "3 sec", peripheralPulse: "Weak",
          abdomen: "Soft", bowelSounds: "Present", nausea: "No", vomiting: "No",
          urinaryPattern: "Catheterised", catheter: "Yes", catheterSite: "Foley 16Fr",
          mobility: "Bed-bound", assistiveDevice: "None",
          skinColor: "Pale", skinTurgor: "Reduced", skinIntact: "No",
          woundPresent: "Yes", woundLocation: "Right plantar foot",
          woundDescription: "4×3 cm ulcer, purulent discharge, surrounding cellulitis", edema: "No",
          ivAccess: "Yes", ivSite: "Right forearm cannula + Right IJV CVC", ivSize: "18G / 7Fr",
        },
        psychosocial: {
          anxietyLevel: "Moderate", emotionalStatus: "Distressed", cooperationLevel: "Cooperative",
          cognitiveStatus: "Drowsy", languageBarrier: "No", language: "Hindi",
          spiritualNeeds: "No", physicalAbuseRisk: "No", socialSupport: "Family present (son)",
        },
        nutritionHydration: {
          dietaryRestrictions: "Diabetic diet", allergies: "Sulfa (rash)", nutritionRisk: "Moderate (MUST 2)",
          hydrationStatus: "Dehydrated", lastMealTime: "Morning", swallowingDifficulty: "No", feedingMethod: "Oral",
        },
        riskAssessments: {
          // Sub-scores included so the Nurse IA form reconstructs the exact
          // Braden/Morse totals on reload (the form derives the total from the
          // per-item scores, not the stored total). Braden 3+2+2+2+3+2 = 14;
          // Morse 0+15+0+20+20+0 = 55.
          bradenScale: {
            sensoryPerception: "3", moisture: "2", activity: "2",
            mobility: "2", nutrition: "3", frictionShear: "2",
            totalScore: 14, riskLevel: "Moderate Risk",
          },
          morseFallScale: {
            fallHistory: "0", secondaryDiagnosis: "15", ambulatoryAid: "0",
            ivAccess: "20", gaitBalance: "20", mentalStatus: "0",
            totalScore: 55, riskLevel: "High Fall Risk",
          },
        },
        dischargePlanning: {
          livesAlone: "No", caregiver: "Son (Suresh Kumar)", homeSupportAvailable: "Yes",
          anticipatedDischargeNeeds: "Wound care, diabetic footwear, insulin teaching",
          educationNeeded: "Foot care, glycaemic control, dressing technique",
          socialWorkReferral: "No",
          dischargePlanNotes: "Anticipated 12-14 day stay; discharge when infection cleared, wound granulating and ambulant with footwear.",
        },
        carePlan: "Sepsis management with source control, glycaemic control and diabetic-foot wound care — hourly monitoring, IV antibiotics as charted, insulin sliding scale, strict intake/output, 2-hrly turning and pressure-area care.",
        homeMedications: [
          { drug: "Metformin 500mg", dose: "1 tab", frequency: "BD" },
          { drug: "Glimepiride 1mg", dose: "1 tab", frequency: "OD" },
          { drug: "Amlodipine 5mg", dose: "1 tab", frequency: "OD" },
        ],
        notes: "Baseline admission assessment — septic diabetic foot, ICU-level care initiated.",
      },
    } });
  }
  console.log("   ✅ demographics + ER context enriched");

  // ── 2. Collection docs (raw). base = UHID + patientUHID + admission + tag ──
  const base = { UHID, patientUHID: UHID, admissionId, _demoSeed: true };
  const B = (extra) => Object.assign({}, base, { createdAt: extra.createdAt || now, updatedAt: now }, extra);

  const ipdNo = adm?.admissionNumber || "";
  const DN = (extra) => Object.assign({}, base, {
    patientUHID: UHID, ipdNo, admissionId,
    createdAt: extra.createdAt || now, updatedAt: now, status: "signed", _demoSeed: true,
  }, extra);

  // Vital Signs sheets (hourly grid) across the stay — a septic-ICU picture on
  // admission (tachycardia, hypotension, fever, low GCS) normalising by
  // discharge. Keyed on lowercase `uhid` + a unique date string per sheet.
  // Column names are chosen so the print's _expandVitalSheets matcher
  // (systol / diastol / pulse / temp / spo / rr / gcs) picks every one up.
  const VITAL_COLS = ["BP Systolic", "BP Diastolic", "Pulse", "Temperature", "SpO2", "Respiratory Rate", "GCS"];
  const VS = (n, slots) => Object.assign({}, base, {
    uhid: UHID, patient: patient._id, patientName: patient.fullName || patient.firstName,
    date: dstr(n), admission: admissionId, ipdNo,
    activeVitals: VITAL_COLS.map((name) => ({ name })),
    tableData: slots.map((s) => ({ time: s.time, nurseName: "Sunita Patil (Nurse)", values: {
      "BP Systolic": { value: s.sys, unit: "mmHg" }, "BP Diastolic": { value: s.dia, unit: "mmHg" },
      "Pulse": { value: s.pr, unit: "bpm" }, "Temperature": { value: s.temp, unit: "°C" },
      "SpO2": { value: s.spo2, unit: "%" }, "Respiratory Rate": { value: s.rr, unit: "breaths/min" },
      "GCS": { value: s.gcs, unit: "/15" },
    } })),
    createdAt: day(n, 6), recordedAt: day(n, 6), updatedAt: now, _demoSeed: true,
  });

  // ── Nursing workflow builders ────────────────────────────────────────
  // These collections were empty, so their Complete-File sections printed
  // blank. Each seeded doc carries BOTH the model's own fields AND the flat
  // fields the print's normaliser reads (shift/handingByName/summary,
  // nursingDiagnosis/goals/interventions, assessmentType/summary) so it
  // renders without touching the normaliser.
  const oid   = () => new mongoose.Types.ObjectId();
  const NURSE = "Sunita Patil (Nurse)";
  const NURSE2 = "Meena Kumari (Nurse)";
  const SHIFT_HR = { morning: 7, evening: 15, night: 22 };
  const SH = (n, fromShift, toShift, handing, receiving, cond, summary) => {
    const t = day(n, SHIFT_HR[fromShift]);
    return Object.assign({}, base, {
      uhid: UHID, admissionId, date: t, fromShift, toShift,
      shift: `${fromShift} → ${toShift}`,                       // print reads h.shift
      handingByName: handing, receivingByName: receiving, summary,
      outgoingNurse: oid(), incomingNurse: oid(),
      patientStatus: { overallCondition: cond, consciousness: n <= 1 ? "drowsy" : "conscious" },
      vitalsSnapshot: { pulse: 118 - n * 4, bp: `${96 + n * 3}/${60 + n}`, spo2: 94 + Math.min(n, 5), temp: Number((39.4 - n * 0.2).toFixed(1)) },
      specialInstructions: summary,
      createdAt: t, updatedAt: now, _demoSeed: true,
    });
  };
  const NCP = (n, diagnosis, goals, interventions, evaluation, dischargeGoals) => Object.assign({}, base, {
    patient: patient._id, patientName: patient.fullName || patient.firstName, ipdNo,
    nursingDiagnosis: diagnosis, goals, interventions, evaluation, nurseName: NURSE,   // print fields
    assessmentDate: day(n, 9),
    nursingProblems: [{ problemStatement: diagnosis, shortTermGoal: goals, interventions: [{ intervention: interventions, frequency: "Per shift", responsible: "Nurse" }], evaluation, priority: "HIGH", status: "ACTIVE" }],
    dischargeGoals, status: "ACTIVE",
    createdAt: day(n, 9), updatedAt: now, _demoSeed: true,
  });
  const NA = (n, type, label, summary) => Object.assign({}, base, {
    patientName: patient.fullName || patient.firstName,
    type, assessmentType: label, summary, nurseName: NURSE,     // print reads assessmentType||type, summary
    data: { note: summary }, assessmentDate: day(n, 11),
    createdAt: day(n, 11), updatedAt: now, _demoSeed: true,
  });
  // One MAR administration line for the demo medication order below: a
  // scheduled HH:MM slot on day n, given (with an accurate time so the print
  // computes on-time / late) or missed.
  const dose = (n, sched, givenH, givenM, status) => {
    const [sh, sm] = sched.split(":").map(Number);
    return {
      scheduledTime: sched, scheduledDate: day(n, sh, sm), status,
      givenAt: status === "given" ? day(n, givenH, givenM) : null,
      givenBy: status === "given" ? "Sunita Patil" : null, givenByRole: "Nurse",
      doseGiven: status === "given" ? "1 g" : "", routeUsed: status === "given" ? "IV" : "",
      fiveRightsChecked: status === "given",
    };
  };

  // R7hr(SEED-GUARD): shared ids for cross-block linkage (validated blocks)
  const demoDoctorId = new mongoose.Types.ObjectId(); // prescription.doctor + Appointment.doctorId are REQUIRED ObjectId refs; no doctor doc guaranteed — validate() only type-checks the id
  const physioPlanId = new mongoose.Types.ObjectId(); // shared: PhysioPlan._id ↔ PhysioSession.planId
  const demoAdrReporterId = new mongoose.Types.ObjectId(); // ADRReport.reportedBy requires an ObjectId ref User; no user doc is loaded in this script — validation only type-checks the id (populate would return null; print uses reportedByName)

  const SETS = {
    // R7hu — a clean demo medication order so the day-wise Treatment Chart
    // showcases the MAR: Meropenem TDS across three days with on-time, late
    // and missed doses (one drug = one row; who / when / timely).
    "../models/Doctor/DoctorOrderModel": [Object.assign({}, base, {
      patientName: patient.fullName || patient.firstName,
      visitType: "IPD", orderType: "Medication", priority: "Routine",
      orderDetails: { medicineName: "Inj Meropenem", dose: "1 g", frequency: "TDS", route: "IV", indication: "Septic diabetic foot — sepsis" },
      orderedBy: "Dr. Sandeep Kumar", orderedByRole: "Doctor", orderedAt: day(0, 11), status: "InProgress",
      administrationRecord: [
        dose(0, "06:00", 6, 10, "given"), dose(0, "14:00", 14, 40, "given"), dose(0, "22:00", 0, 0, "missed"),
        dose(1, "06:00", 6, 5, "given"),  dose(1, "14:00", 14, 10, "given"), dose(1, "22:00", 22, 20, "given"),
        dose(2, "06:00", 6, 15, "given"), dose(2, "14:00", 0, 0, "missed"),  dose(2, "22:00", 22, 5, "given"),
      ],
      createdAt: day(0, 11), updatedAt: now, _demoSeed: true,
    })],
    // Doctor notes — an Initial Assessment (the day-1 note that powers the
    // "Initial Assessment → Doctor" section) + daily progress notes so the
    // day-wise Clinical Journey has doctor entries too.
    "../models/Doctor/DoctorNotesModel": [
      DN({
        createdAt: day(0, 12), visitDate: day(0, 12), noteType: "initial", section: "doctor",
        patient: patient._id, patientName: patient.fullName || patient.firstName,
        doctorName: "Dr. Sandeep Kumar", signedByName: "Dr. Sandeep Kumar", doctorRegNo: "HMC-45821",
        signedAt: day(0, 12),
        lateEntry: true, lateEntryAt: now,
        lateEntryReason: "Retrospective electronic entry — admission-day note documented on paper during ICU resuscitation and transcribed after stabilisation (NABH HIC.6).",
        noteDetails: { doctor: {
          chiefComplaints: "High-grade fever with chills × 4 days; foul-smelling ulcer over right foot; drowsiness × 1 day.",
          historyOfPresentingIllness: "Known type-2 diabetic (12 yrs, on OHA) noticed a small blister over the right sole 10 days ago that rapidly ulcerated with purulent discharge. Fever became high-grade with rigors; family reports altered sensorium since yesterday.",
          pastMedicalHistory: "Type-2 Diabetes Mellitus × 12 yrs. Hypertension × 6 yrs. No IHD/CKD.",
          familyHistory: "Father — diabetic.", socialHistory: "Non-smoker, occasional alcohol.",
          generalExamination: "Ill-looking, febrile (39.4°C), dehydrated. PR 118, BP 96/60, SpO2 94% RA, GCS E3V4M5. Right foot — 4×3 cm plantar ulcer, surrounding cellulitis, foul discharge, crepitus absent.",
          systemicExamination: "CVS: tachycardia, no murmur. RS: bibasal crepts. P/A: soft. CNS: drowsy, no focal deficit.",
          provisionalDiagnosis: "Septic diabetic foot (right) with sepsis; diabetic ketoacidosis to rule out.",
          workingDiagnosis: "Right diabetic foot infection with sepsis + hyperglycaemia.",
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
      DN({
        createdAt: day(2, 9), visitDate: day(2, 9), noteType: "daily", section: "doctor",
        patient: patient._id, patientName: patient.fullName || patient.firstName,
        doctorName: "Dr. Sandeep Kumar", signedByName: "Dr. Sandeep Kumar", signedAt: day(2, 9),
        lateEntry: true, lateEntryAt: now,
        lateEntryReason: "Retrospective electronic entry — ward-round progress note transcribed from the paper record (NABH HIC.6).",
        // buildDoctorNoteCardHtml reads note.soap at top level for progress notes.
        soap: {
          subjective: "Fever settling, more alert. Pain at debridement site.",
          objective: "Afebrile, PR 92, BP 110/70, SpO2 97%. Wound post-debridement — clean margins.",
          assessment: "Diabetic foot infection responding to IV meropenem; glycaemia improving on insulin infusion.",
          plan: "Continue meropenem, daily dressing, insulin sliding scale, physio referral, monitor renal function.",
        },
      }),
      DN({
        createdAt: day(7, 10), visitDate: day(7, 10), noteType: "daily", section: "doctor",
        patient: patient._id, patientName: patient.fullName || patient.firstName,
        doctorName: "Dr. Sandeep Kumar", signedByName: "Dr. Sandeep Kumar", signedAt: day(7, 10),
        lateEntry: true, lateEntryAt: now,
        lateEntryReason: "Retrospective electronic entry — ward-round progress note transcribed from the paper record (NABH HIC.6).",
        soap: {
          subjective: "No fever, walking with support in physio.", objective: "Vitals stable, wound granulating well.",
          assessment: "Recovering; sepsis resolved.", plan: "Step down to oral antibiotics, continue physio, plan discharge in 3-4 days.",
        },
      }),
    ],
    "../models/Vitals/vitalSheetModel": [
      VS(0,  [{ time: "06:00", sys: 96,  dia: 60, pr: 118, temp: 39.4, spo2: 94, rr: 24, gcs: 12 },
              { time: "14:00", sys: 100, dia: 62, pr: 110, temp: 38.6, spo2: 95, rr: 22, gcs: 13 }]),
      VS(2,  [{ time: "06:00", sys: 106, dia: 68, pr: 98,  temp: 37.8, spo2: 96, rr: 20, gcs: 14 },
              { time: "18:00", sys: 108, dia: 70, pr: 94,  temp: 37.5, spo2: 97, rr: 19, gcs: 14 }]),
      VS(5,  [{ time: "06:00", sys: 112, dia: 72, pr: 88,  temp: 37.2, spo2: 97, rr: 18, gcs: 15 }]),
      VS(8,  [{ time: "06:00", sys: 118, dia: 76, pr: 82,  temp: 36.9, spo2: 98, rr: 16, gcs: 15 }]),
      VS(11, [{ time: "06:00", sys: 122, dia: 78, pr: 78,  temp: 36.8, spo2: 99, rr: 16, gcs: 15 }]),
    ],
    "../models/Nurse/shiftHandoverModel": [
      SH(0, "morning", "evening", NURSE,  NURSE2, "critical",          "Septic, GCS 12, on noradrenaline infusion + insulin sliding scale. Right IJV CVC, Foley in situ, 2-hrly turning. Wrist restraint for line safety."),
      SH(1, "evening", "night",   NURSE2, NURSE,  "needs_observation", "Fever settling, noradrenaline weaning. Restraint reviewed 2-hrly, skin intact. Strict I/O maintained."),
      SH(3, "night",   "morning", NURSE,  NURSE2, "needs_observation", "Post-debridement dressing dry & intact. Pain 4/10 controlled. Physiotherapy referral raised."),
      SH(7, "morning", "evening", NURSE2, NURSE,  "stable",            "Afebrile, wound granulating, ambulating with walker. Stepped down to oral antibiotics. Discharge teaching started."),
    ],
    "../models/Nurse/NursingCarePlanModel": [
      NCP(0, "Risk of sepsis-related deterioration related to diabetic foot infection",
          "Maintain MAP > 65 mmHg, temperature < 38°C and adequate perfusion within 48 hours",
          "Hourly vitals, IV antibiotics as charted, insulin-infusion titration, strict intake/output, sepsis-bundle compliance",
          "Sepsis resolving by day 5 — vitals normalised, lactate trending down",
          "Wound healed, ambulant, glycaemia controlled, foot-care educated before discharge"),
      NCP(2, "Impaired skin integrity related to diabetic foot ulcer and reduced mobility",
          "Wound bed granulating and no new pressure injury throughout the stay",
          "Daily aseptic dressing, 2-hrly turning, air mattress, heel offloading, Braden reassessment each shift",
          "Sacral skin intact; foot wound granulating well by day 8",
          "Home wound-care and diabetic-footwear advice delivered to patient and son"),
    ],
    "../models/Nurse/NursingAssessmentModel": [
      NA(1, "daily",     "Daily nursing assessment", "Drowsy to alert, fever settling, wound post-debridement clean, tolerating oral diet."),
      NA(4, "pain",      "Pain reassessment",        "NRS 4/10 at foot wound, relieved to 2/10 after analgesia and repositioning."),
      NA(8, "nutrition", "Nutrition reassessment",   "MUST 2 — diabetic high-protein diet; egg removed after urticaria; oral intake adequate."),
    ],
    "../models/Patient/emergencyModel": [B({
      createdAt: admit, arrivalDate: admit, arrivalTime: admit, triageTime: admit,
      patientId: patient._id, patientName: patient.fullName || patient.firstName,
      emergencyNumber: `ER-DEMO-${UHID}`,
      arrivalMode: "Ambulance", modeOfArrival: "Ambulance",
      triageCategory: "Critical", triageLevel: "Red (Emergent)", erType: "Medical Emergency",
      presentingComplaints: "High-grade fever, altered sensorium, foul-smelling right-foot ulcer — septic diabetic foot × 4 days",
      chiefComplaint: "High-grade fever, altered sensorium, foul-smelling right-foot ulcer",
      complaintDuration: "4 days",
      consultantIncharge: "Dr. Sandeep Kumar", consultantName: "Dr. Sandeep Kumar",
      provisionalDiagnosis: "Septic diabetic foot (right) with sepsis",
      vitals: { weight: 72, temperature: 39.4, bloodPressure: "96/60", pulse: 118, respiratoryRate: 24, oxygenSaturation: 94, painScore: 6, glasgowComaScale: 12 },
      disposition: "Admitted", status: "Admitted",
      admission: admissionId, admittedAt: admit, admittedBy: "Dr. Sandeep Kumar",
      admittedToWard: "ICU", admittedToBed: "ICU-3", admittedDepartment: "General Medicine",
    })],
    "../models/Doctor/prescription": [B({
      createdAt: day(-20, 11), date: day(-20, 11), prescriptionDate: day(-20, 11), prescriptionNumber: "RX-2026-000112",
      patient: patient._id, patientName: patient.fullName || patient.firstName,
      doctor: demoDoctorId, doctorName: "Dr. Sandeep Kumar",
      department: "General Medicine", registrationType: "OPD",
      provisionalDiagnosis: "Type-2 diabetes mellitus with early right plantar foot ulcer",
      medicines: [
        { medicineName: "Metformin 500mg", dosage: "1 tab", frequency: "BD", duration: "Continued", schedule: "BD", route: "Oral", days: "Continued" },
        { medicineName: "Glimepiride 1mg", dosage: "1 tab", frequency: "OD", duration: "Continued", schedule: "OD", route: "Oral", days: "Continued" },
      ],
      advice: "Foot care, daily dressing, review if discharge/redness increases",
      status: "Completed",
    })],
    "../models/Appointment/appointmentModel": [B({
      createdAt: day(3), bookedAt: day(3),
      appointmentNumber: `APT-DEMO-${UHID}`,
      patientId: patient._id,
      patientName: patient.fullName || patient.firstName,
      patientPhone: patient.contactNumber || "9876543210",
      doctorId: demoDoctorId, doctorName: "Dr. Sandeep Kumar",
      appointmentDate: future(7), slotTime: "10:30", durationMinutes: 15,
      department: "General Medicine",
      chiefComplaint: "Post-discharge follow-up + wound review",
      status: "Booked", bookedBy: "Ritu Sharma (Receptionist)",
    })],
    "../models/PatientBillModel/PatientAdvanceModel": [
      B({ createdAt: admit, paidAt: admit, receiptNumber: `ADV-DEMO-${UHID}`,
          patientId: patient._id, admission: admissionId,
          amount: 25000, paymentMode: "UPI", transactionId: "UPI-DEMO-415922",
          receivedBy: "Ritu Sharma", receivedByRole: "Receptionist",
          appliedAmount: 20000, refundedAmount: 5000,
          refundedAt: day(13, 16), refundedBy: "Ritu Sharma", refundMode: "CASH",
          refundedToName: patient.fullName || patient.firstName, refundedToRelation: "Self",
          refundReason: "Unutilised advance after final bill",
          status: "REFUNDED" }),
    ],
    "../models/Clinical/MedReconciliationModel": [B({
      createdAt: day(0, 14), reconciledAt: day(0, 14), phase: "Admission",
      homeMedications: [{ name: "Metformin 500mg" }, { name: "Glimepiride 1mg" }, { name: "Amlodipine 5mg" }],
      reconciledByName: "Asha Pandey (Pharmacist)",
      discrepancies: "Home Metformin dose mismatch vs OPD Rx — corrected; Amlodipine continued",
    })],
    "../models/Clinical/ProcedureNoteModel": [B({
      createdAt: day(2, 12), procedureDate: day(2, 12),
      patientId: patient._id, patientName: patient.fullName || patient.firstName,
      admissionNumber: ipdNo,
      surgeryName: "Wound debridement (LA) — right foot",
      actualProcedure: "Wound debridement — right diabetic foot",
      procedureName: "Wound debridement — right diabetic foot",
      startTime: day(2, 10, 30), endTime: day(2, 11, 15), durationMinutes: 45,
      surgeon: "Dr. Sandeep Kumar", performedByName: "Dr. Sandeep Kumar",
      anaesthetistName: "Dr. Anaes Verma", anaesthesiaType: "Local", asaGrade: "III",
      complications: "", bloodLossMl: 30, postOpDestination: "ICU",
      site: "Right foot (plantar)",
      notes: "Extensive slough excised, healthy margins achieved, dressing applied. Swab count correct.",
      createdByName: "Dr. Sandeep Kumar", createdByRole: "Doctor",
    })],
    // R7hr(REG-V): all register seeds below rewritten to the REAL schema
    // field names (raw insertMany bypasses strict mode, so the old wrong
    // keys persisted and masked renderer bugs while required fields were
    // simply absent — demo rows rendered blank on every schema-faithful
    // surface: register pages, dashboard KPIs, statutory prints).
    "../models/Compliance/OTRegisterModel": [B({
      createdAt: day(2, 11), occurredAt: day(2, 11), startTime: day(2, 10, 30), endTime: day(2, 11, 15),
      patientName: patient.fullName || patient.firstName,
      surgeryName: "Wound debridement (LA) — right foot",
      plannedProcedure: "Wound debridement — right diabetic foot",
      actualProcedure: "Wound debridement — right diabetic foot",
      surgicalSpeciality: "General Surgery", anaesthesiaType: "Local",
      surgeonName: "Dr. Sandeep Kumar", anaesthetistName: "Dr. Anaes Verma",
      durationMinutes: 45, complications: "", status: "Completed",
    })],
    "../models/Clinical/PhysioPlanModel": [B({
      _id: physioPlanId,
      createdAt: day(3, 10),
      patientName: patient.fullName || patient.firstName,
      diagnosis: "Post-debridement deconditioning; diabetic neuropathy",
      goals: ["Bed mobility → assisted standing → independent ambulation with footwear"],
      modalitySet: ["ROM", "STRENGTH", "GAIT"],
      sessionsTotal: 6, sessionsCompleted: 3, frequency: "OD",
      dischargeAdvice: "Continue home exercise programme; protective diabetic footwear",
      createdByName: "Anita (PT)", createdByRole: "Physiotherapist", status: "ACTIVE",
      // Display-only extras (not schema paths — strict validate ignores, raw insert keeps):
      // the Complete File physioPlans print row reads modalities / sessionCount.
      modalities: ["Active-assisted ROM", "Strengthening", "Gait training"], sessionCount: 6,
    })],
    "../models/Clinical/PhysioSessionModel": [
      B({ planId: physioPlanId, createdAt: day(4, 11), sessionDate: day(4, 11),
        patientName: patient.fullName || patient.firstName,
        sessionType: "ROM", modalitiesUsed: ["Bed mobility", "Active-assisted ROM"], duration_min: 30,
        painScoreBefore: 6, painScoreAfter: 5, tolerance: "GOOD",
        notes: "Tolerated well, mild fatigue",
        status: "COMPLETED", signedByName: "Anita (PT)", signedAt: day(4, 11),
        // display-only extras for the physioSessions print row (not schema paths)
        modality: "Bed mobility + ROM", duration: "30 min", therapistName: "Anita (PT)", patientResponse: "Tolerated well, mild fatigue" }),
      B({ planId: physioPlanId, createdAt: day(6, 11), sessionDate: day(6, 11),
        patientName: patient.fullName || patient.firstName,
        sessionType: "STRENGTH", modalitiesUsed: ["Assisted standing", "Strengthening"], duration_min: 35,
        painScoreBefore: 5, painScoreAfter: 4, tolerance: "FAIR",
        notes: "Stood with support ×2 min",
        status: "COMPLETED", signedByName: "Anita (PT)", signedAt: day(6, 11),
        modality: "Assisted standing + strengthening", duration: "35 min", therapistName: "Anita (PT)", patientResponse: "Stood with support ×2 min" }),
      B({ planId: physioPlanId, createdAt: day(9, 11), sessionDate: day(9, 11),
        patientName: patient.fullName || patient.firstName,
        sessionType: "GAIT", modalitiesUsed: ["Gait training (walker)"], duration_min: 40,
        painScoreBefore: 4, painScoreAfter: 3, tolerance: "GOOD",
        notes: "Walked 10m with walker, stable",
        status: "COMPLETED", signedByName: "Anita (PT)", signedAt: day(9, 11),
        modality: "Gait training (walker)", duration: "40 min", therapistName: "Anita (PT)", patientResponse: "Walked 10m with walker, stable" }),
    ],
    "../models/Compliance/RestraintRegisterModel": [B({
      createdAt: day(1, 3), occurredAt: day(1, 3), startTime: day(1, 3), endTime: day(1, 11), durationMinutes: 480,
      patientName: patient.fullName || patient.firstName,
      restraintType: "physical", restraintDevice: ["Bilateral wrist soft restraint"],
      reason: "Agitation with risk of central-line self-removal", reasonCategory: "Safety",
      orderingDoctor: "Dr. Sandeep Kumar", appliedBy: "Sunita Patil (Nurse)",
      monitoringFrequency: "q2h", consentObtained: true, consentFrom: "Attendant (son)",
      status: "Removed", removedAt: day(1, 11), removedBy: "Sunita Patil (Nurse)",
      removalReason: "Agitation resolved; line secured",
    })],
    "../models/Compliance/FallRiskRegisterModel": [B({
      createdAt: day(1, 9), assessedAt: day(1, 9),
      patientName: patient.fullName || patient.firstName,
      morseScore: 55, riskTier: "High", highRiskFlag: true,
      historyOfFalling: false, ambulatoryAid: "None", ivTherapy: true,
      gait: "Weak", mentalStatus: "Oriented",
      interventionBundle: "Fall precautions — bed low, rails up, night light, call bell within reach",
      assessedBy: "Sunita Patil (Nurse)",
    })],
    "../models/Compliance/PressureUlcerRegisterModel": [B({
      createdAt: day(5, 8), assessedAt: day(5, 8),
      patientName: patient.fullName || patient.firstName,
      bradenScore: 12, riskTier: "High",
      ulcerPresent: true, ulcerStage: "II", ulcerSite: "Sacrum", ulcerSize: "2×3 cm",
      hospitalAcquired: true, repositioningFreq: "Q2H", pressureMattress: true,
      nutritionConsult: true, dressingType: "Hydrocolloid",
      assessedBy: "Sunita Patil (Nurse)",
    })],
    "../models/Compliance/HAISurveillanceRegisterModel": [B({
      createdAt: day(6, 9), onsetDate: day(6, 9),
      patientName: patient.fullName || patient.firstName,
      HAIType: "CAUTI", organismIsolated: "E. coli", deviceDays: 6, cultureSent: true,
      antibioticPrescribed: "Culture-directed antibiotic (7 days)",
      identifiedByEmpId: "Dr. Sandeep Kumar", status: "Closed", outcome: "Resolved",
    })],
    "../models/Compliance/MedicationErrorRegisterModel": [B({
      createdAt: day(4, 20), reportedAt: day(4, 20),
      patientName: patient.fullName || patient.firstName,
      errorPhase: "Dispensing", medicationName: "Insulin (10 IU vs 40 IU look-alike vial)",
      expectedDose: "10 IU", actualDose: "40 IU (intercepted)",
      severityNCC: "B", patientHarm: "None",
      actionTakenImmediate: "Intercepted before administration; vial returned",
      rootCause: "Look-alike vials stored adjacently",
      correctiveAction: "Shelf separation + high-alert labelling",
      reportedByName: "Asha Pandey (Pharmacist)", status: "Closed", closedAt: day(5, 10),
    })],
    "../models/Compliance/NearMissEventRegisterModel": [B({
      createdAt: day(7, 13), observedAt: day(7, 13), emittedAt: day(7, 13),
      patientName: patient.fullName || patient.firstName,
      eventType: "Wrong-patient-intercepted", severityIfMissed: "B",
      interventionTaken: "Sample relabelled at bedside after two-identifier check",
      recommendation: "Enforce two-identifier check before every sample draw",
      observedByEmpId: "EMP-LAB-07", observedByName: "Mohit (Lab Tech)",
      sourceRef: `demo-nearmiss-${UHID}`, status: "Closed",
    })],
    "../models/Compliance/AntimicrobialUseRegisterModel": [B({
      createdAt: day(2, 15), occurredAt: day(2, 15),
      patientName: patient.fullName || patient.firstName,
      antibiotic: "Meropenem 1g IV TDS",
      indication: "Sepsis — culture-directed (E. coli)",
      orderingDoctor: "Dr. Sandeep Kumar", createdByName: "Dr. Sandeep Kumar",
      status: "Active",
    })],
    "../models/Pharmacy/ADRReportModel": [B({
      createdAt: day(3, 18),
      patientName: patient.fullName || patient.firstName,
      suspectedDrugName: "Ceftriaxone", suspectedDrugDose: "1 g IV BD", suspectedRoute: "IV",
      reactionDescription: "Maculopapular rash over trunk", onsetDate: day(3, 18),
      severity: "MODERATE", causality: "PROBABLE", dechallenge: "POSITIVE",
      actionTaken: "Drug withdrawn; antihistamine given",
      outcome: "RECOVERED",
      notes: "Recovered after drug withdrawal + antihistamine",
      reportedBy: demoAdrReporterId, reportedByName: "Dr. Sandeep Kumar", reportedByRole: "Doctor",
      status: "SUBMITTED", submittedAt: day(3, 18),
      // Display-only extras (not schema paths — strict validate ignores, raw insert keeps):
      // the adrReports print row picks reportedAt / drugName / reaction. Schema suspectedDrug
      // is an ObjectId ref PharmacyDrug (string failed cast) so it is intentionally omitted.
      reportedAt: day(3, 18), drugName: "Ceftriaxone", reaction: "Maculopapular rash over trunk",
    })],
    "../models/Clinical/AdverseFoodReactionModel": [B({
      createdAt: day(8, 13), reportedAt: day(8, 13),
      patientName: patient.fullName || patient.firstName,
      mealItem: "Egg (breakfast tray)", suspectedAllergen: "Egg",
      reactionDescription: "Urticaria over forearms",
      severity: "MILD", onsetMinutesAfterMeal: 45,
      reportedByName: "Sister Anita", reportedByRole: "Staff Nurse",
      actionTaken: "Egg removed from diet plan; noted as intolerance",
      outcome: "RESOLVED", status: "CLOSED",
    })],
    "../models/Compliance/CodeResponseEventModel": [B({
      createdAt: day(3, 2), alertedAt: day(3, 2),
      eventNumber: `CR-DEMO-${UHID}`,                 // unique index — demo-scoped value
      code: "BLUE", location: "ICU Bed 3", bedNumber: "ICU-3",
      patientUHID: UHID, patientName: patient.fullName || patient.firstName,
      arrivalDelaySec: 120, resolvedAt: day(3, 2, 25), durationMinutes: 25,
      outcome: "RESOLVED",
      notes: "ROSC achieved after 2 cycles CPR; shifted to ventilator",
    })],
    "../models/Clinical/PROMPREMSurveyModel": [B({
      createdAt: day(13, 16), administeredAt: day(13, 16),
      patientId: patient._id, patientName: patient.fullName || patient.firstName,
      admissionNumber: ipdNo,
      type: "PROM", instrument: "EQ-5D-5L",
      responses: { mobility: 2, selfcare: 1, usualActivities: 2, pain: 2, anxiety: 1, vas: 75 },
      scores: { vas: 75 },
      comments: "Walking better than at admission; mild pain at wound site.",
      patientSignature: { method: "DIGITAL_PAD", signedAt: day(13, 16) },
      staffWitness: { userName: "Sister Anita", userRole: "Staff Nurse", signedAt: day(13, 16) },
      status: "SIGNED", signedAt: day(13, 16), signedByName: "Sister Anita",
      sourceRef: `demo-prom-${UHID}`,
    }), B({
      createdAt: day(13, 17), administeredAt: day(13, 17),
      patientId: patient._id, patientName: patient.fullName || patient.firstName,
      admissionNumber: ipdNo,
      type: "PREM", instrument: "NABH-PSQ",
      responses: { doctorCare: 9, nursingCare: 9, cleanliness: 8, foodQuality: 6, overallRating: 8 },
      scores: { overall: 8 },
      comments: "Very satisfied with doctors and nursing care; hospital food could improve.",
      patientSignature: { method: "DIGITAL_PAD", signedAt: day(13, 17) },
      staffWitness: { userName: "Sister Anita", userRole: "Staff Nurse", signedAt: day(13, 17) },
      status: "SIGNED", signedAt: day(13, 17), signedByName: "Sister Anita",
      sourceRef: `demo-prem-${UHID}`,
    })],
    "../models/Clinical/MedicalCertificateModel": [B({
      createdAt: day(14, 11), issuedAt: day(14, 11),
      patient: patient._id, patientName: patient.fullName || patient.firstName,
      certNumber: `MC-DEMO-${UHID}`,                 // unique index — demo-scoped value
      certType: "discharge-fitness",
      visitType: "IPD", admissionNumber: ipdNo,
      doctorName: "Dr. Sandeep Kumar", doctorReg: "MCI-2011-54321",
      diagnosis: "Septic diabetic foot — infection resolved, wound granulating",
      typeSpecific: { fitForDischarge: true, validFrom: day(14, 11), validTo: future(14), remarks: "Fit for discharge; OPD review in 7 days" },
      status: "issued",
    })],
  };

  // ── 3. Insert (delete prior demo rows first) ──
  // R7hr(SEED-GUARD): raw collection.insertMany stays (it preserves the
  // _demoSeed tag + patient-scoping keys that some schemas don't declare,
  // which the cleanup delete and _byPatient queries rely on) — but each
  // doc is now VALIDATED against its schema first. REG-V found 8 register
  // seeds silently carrying wrong keys / enum-violating values / missing
  // required fields for months because raw inserts bypass validators; any
  // future drift now fails loudly at seed time instead.
  let total = 0;
  for (const [p, docs] of Object.entries(SETS)) {
    const M = resolveModel(p);
    if (!M) { console.warn(`   ⚠️  ${p.split("/").pop()} — model unresolved, skipped`); continue; }
    try {
      for (const d of docs) {
        try {
          await new M(d).validate();
        } catch (ve) {
          const bad = Object.keys(ve.errors || {}).join(", ") || ve.message;
          throw new Error(`schema validation failed (${bad}) — fix the seed doc, do not bypass`);
        }
      }
      await M.collection.deleteMany({ _demoSeed: true, UHID });
      await M.collection.insertMany(docs);
      total += docs.length;
      console.log(`   ✅ ${M.collection.collectionName.padEnd(28)} +${docs.length}`);
    } catch (e) {
      console.warn(`   ⚠️  ${p.split("/").pop()} insert failed: ${e.message}`);
    }
  }

  console.log(`\n🎉 Seeded ${total} demo records across ${Object.keys(SETS).length} collections for ${UHID}.`);
  console.log(`   Print the Complete File for ${UHID} to see full coverage.`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error("❌ seed failed:", e.stack || e.message); process.exit(1); });
