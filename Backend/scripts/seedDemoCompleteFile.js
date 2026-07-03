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
const admit = new Date(now.getTime() - 14 * 86400000);        // admitted 14d ago
const day = (n, h = 10, min = 0) => {                          // day n of stay
  const d = new Date(admit.getTime() + n * 86400000);
  d.setHours(h, min, 0, 0); return d;
};
const future = (n) => new Date(now.getTime() + n * 86400000);

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`✅ Mongo connected — seeding demo journey for ${UHID}\n`);

  const Patient   = resolveModel("../models/Patient/patientModel");
  const Admission = resolveModel("../models/Patient/admissionModel");
  const patient = await Patient.findOne({ UHID }).lean();
  if (!patient) { console.error(`No patient ${UHID}`); process.exit(1); }
  const adm = await Admission.findOne({ UHID }).sort({ admissionDate: -1 }).lean();
  const admissionId = adm?._id || null;
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

  const SETS = {
    // Doctor notes — an Initial Assessment (the day-1 note that powers the
    // "Initial Assessment → Doctor" section) + daily progress notes so the
    // day-wise Clinical Journey has doctor entries too.
    "../models/Doctor/DoctorNotesModel": [
      DN({
        createdAt: day(0, 12), visitDate: day(0, 12), noteType: "initial", section: "doctor",
        doctorName: "Dr. Sandeep Kumar", signedByName: "Dr. Sandeep Kumar", doctorRegNo: "HMC-45821",
        signedAt: day(0, 12),
        noteDetails: { doctor: {
          chiefComplaints: "High-grade fever with chills × 4 days; foul-smelling ulcer over right foot; drowsiness × 1 day.",
          historyOfPresentingIllness: "Known type-2 diabetic (12 yrs, on OHA) noticed a small blister over the right sole 10 days ago that rapidly ulcerated with purulent discharge. Fever became high-grade with rigors; family reports altered sensorium since yesterday.",
          pastMedicalHistory: "Type-2 Diabetes Mellitus × 12 yrs. Hypertension × 6 yrs. No IHD/CKD.",
          familyHistory: "Father — diabetic.", socialHistory: "Non-smoker, occasional alcohol.",
          generalExamination: "Ill-looking, febrile (39.4°C), dehydrated. PR 118, BP 96/60, SpO2 94% RA, GCS E3V4M5. Right foot — 4×3 cm plantar ulcer, surrounding cellulitis, foul discharge, crepitus absent.",
          systemicExamination: "CVS: tachycardia, no murmur. RS: bibasal crepts. P/A: soft. CNS: drowsy, no focal deficit.",
          provisionalDiagnosis: "Septic diabetic foot (right) with sepsis; diabetic ketoacidosis to rule out.",
          workingDiagnosis: "Right diabetic foot infection with sepsis + hyperglycaemia.",
          codeStatus: "Full code",
        } },
      }),
      DN({
        createdAt: day(2, 9), visitDate: day(2, 9), noteType: "daily", section: "doctor",
        doctorName: "Dr. Sandeep Kumar", signedByName: "Dr. Sandeep Kumar", signedAt: day(2, 9),
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
        doctorName: "Dr. Sandeep Kumar", signedByName: "Dr. Sandeep Kumar", signedAt: day(7, 10),
        soap: {
          subjective: "No fever, walking with support in physio.", objective: "Vitals stable, wound granulating well.",
          assessment: "Recovering; sepsis resolved.", plan: "Step down to oral antibiotics, continue physio, plan discharge in 3-4 days.",
        },
      }),
    ],
    "../models/Patient/emergencyModel": [B({
      createdAt: admit, arrivalTime: admit, triageLevel: "Red (Emergent)", erType: "Medical Emergency",
      chiefComplaint: "High-grade fever, altered sensorium, foul-smelling right-foot ulcer",
      presentingComplaint: "Septic diabetic foot × 4 days", modeOfArrival: "Ambulance",
      disposition: "Admitted to ICU", consultantName: "Dr. Sandeep Kumar",
    })],
    "../models/Doctor/prescription": [B({
      createdAt: day(-20, 11), prescriptionDate: day(-20, 11), prescriptionNumber: "RX-2026-000112",
      doctorName: "Dr. Sandeep Kumar", department: "General Medicine",
      medicines: [
        { medicineName: "Metformin 500mg", dosage: "1 tab", frequency: "BD", duration: "Continued" },
        { medicineName: "Glimepiride 1mg", dosage: "1 tab", frequency: "OD", duration: "Continued" },
      ],
      advice: "Foot care, daily dressing, review if discharge/redness increases",
    })],
    "../models/Appointment/appointmentModel": [B({
      createdAt: day(3), appointmentDate: future(7), department: "General Medicine",
      doctorName: "Dr. Sandeep Kumar", chiefComplaint: "Post-discharge follow-up + wound review", status: "Booked",
    })],
    "../models/PatientBillModel/PatientAdvanceModel": [
      B({ createdAt: admit, paidAt: admit, receiptNumber: "ADV-DEMO-UH01", amount: 25000, paymentMode: "UPI",
          appliedAmount: 20000, refundedAmount: 5000, refundedAt: day(13, 16), refundReason: "Unutilised advance after final bill" }),
    ],
    "../models/Clinical/MedReconciliationModel": [B({
      createdAt: day(0, 14), reconciledAt: day(0, 14), phase: "Admission",
      homeMedications: [{ name: "Metformin 500mg" }, { name: "Glimepiride 1mg" }, { name: "Amlodipine 5mg" }],
      reconciledByName: "Asha Pandey (Pharmacist)",
      discrepancies: "Home Metformin dose mismatch vs OPD Rx — corrected; Amlodipine continued",
    })],
    "../models/Clinical/ProcedureNoteModel": [B({
      createdAt: day(2, 12), procedureDate: day(2, 12), procedureName: "Wound debridement — right diabetic foot",
      performedByName: "Dr. Sandeep Kumar", site: "Right foot (plantar)",
      notes: "Extensive slough excised, healthy margins achieved, dressing applied. Swab count correct.",
    })],
    "../models/Compliance/OTRegisterModel": [B({
      createdAt: day(2, 11), eventDate: day(2, 11), detail: "Wound debridement (LA) — right foot",
      indication: "Septic diabetic foot infection", recordedByName: "Dr. Sandeep Kumar",
      swabCount: "Correct", instrumentCount: "Correct", status: "Completed",
    })],
    "../models/Clinical/PhysioPlanModel": [B({
      createdAt: day(3, 10), diagnosis: "Post-debridement deconditioning; diabetic neuropathy",
      goals: "Bed mobility → assisted standing → independent ambulation with footwear",
      modalities: ["Active-assisted ROM", "Strengthening", "Gait training"], sessionCount: 6, frequency: "Once daily",
    })],
    "../models/Clinical/PhysioSessionModel": [
      B({ createdAt: day(4, 11), sessionDate: day(4, 11), modality: "Bed mobility + ROM", duration: "30 min", therapistName: "Anita (PT)", patientResponse: "Tolerated well, mild fatigue" }),
      B({ createdAt: day(6, 11), sessionDate: day(6, 11), modality: "Assisted standing + strengthening", duration: "35 min", therapistName: "Anita (PT)", patientResponse: "Stood with support ×2 min" }),
      B({ createdAt: day(9, 11), sessionDate: day(9, 11), modality: "Gait training (walker)", duration: "40 min", therapistName: "Anita (PT)", patientResponse: "Walked 10m with walker, stable" }),
    ],
    "../models/Compliance/RestraintRegisterModel": [B({
      createdAt: day(1, 3), eventDate: day(1, 3), appliedAt: day(1, 3), deviceType: "Bilateral wrist soft restraint",
      indication: "Agitation with risk of central-line self-removal", recordedByName: "Sunita Patil (Nurse)",
      orderedByName: "Dr. Sandeep Kumar", status: "Discontinued after 8h", reviewFrequency: "2-hourly",
    })],
    "../models/Compliance/FallRiskRegisterModel": [B({
      createdAt: day(1, 9), eventDate: day(1, 9), assessedAt: day(1, 9), eventType: "High fall risk (Morse 55)",
      reason: "Neuropathy + night sedation", recordedByName: "Sunita Patil (Nurse)", status: "Fall precautions applied",
    })],
    "../models/Compliance/PressureUlcerRegisterModel": [B({
      createdAt: day(5, 8), eventDate: day(5, 8), assessedAt: day(5, 8), stage: "Stage 2",
      detail: "Sacral pressure ulcer 2×3 cm", reason: "Immobility during ICU stay",
      recordedByName: "Sunita Patil (Nurse)", status: "Healing — 2-hrly turning + air mattress",
    })],
    "../models/Compliance/HAISurveillanceRegisterModel": [B({
      createdAt: day(6, 9), eventDate: day(6, 9), organism: "E. coli (CAUTI)", detail: "Catheter-associated UTI",
      reason: "Prolonged urinary catheterization", recordedByName: "Dr. Sandeep Kumar",
      status: "Catheter removed; treated with culture-directed antibiotic",
    })],
    "../models/Compliance/MedicationErrorRegisterModel": [B({
      createdAt: day(4, 20), eventDate: day(4, 20), errorType: "Wrong-dose insulin (intercepted)",
      reason: "Look-alike vial (10 vs 40 IU)", recordedByName: "Asha Pandey (Pharmacist)",
      status: "Near-miss — intercepted before administration", severity: "No harm",
    })],
    "../models/Compliance/NearMissEventRegisterModel": [B({
      createdAt: day(7, 13), eventDate: day(7, 13), eventType: "Wrong-patient sample label caught",
      rootCause: "Similar patient names on the same bay", recordedByName: "Mohit (Lab Tech)", status: "Intercepted — relabelled",
    })],
    "../models/Compliance/AntimicrobialUseRegisterModel": [B({
      createdAt: day(2, 15), eventDate: day(2, 15), drug: "Meropenem 1g IV TDS", detail: "Meropenem 1g IV TDS",
      indication: "Sepsis — culture-directed (E. coli)", recordedByName: "Dr. Sandeep Kumar", status: "Day 5 of 7",
    })],
    "../models/Pharmacy/ADRReportModel": [B({
      createdAt: day(3, 18), reportedAt: day(3, 18), suspectedDrug: "Ceftriaxone",
      reaction: "Maculopapular rash over trunk", severity: "Moderate", outcome: "Recovered after drug withdrawal + antihistamine",
    })],
    "../models/Clinical/AdverseFoodReactionModel": [B({
      createdAt: day(8, 13), reactionDate: day(8, 13), foodItem: "Egg (breakfast tray)",
      reaction: "Urticaria over forearms", severity: "Mild", actionTaken: "Egg removed from diet plan; noted as intolerance",
    })],
    "../models/Compliance/CodeResponseEventModel": [B({
      createdAt: day(3, 2), alertTime: day(3, 2), codeType: "Code Blue", location: "ICU Bed 3",
      outcome: "ROSC achieved after 2 cycles CPR; shifted to ventilator", responseTime: 2,
    })],
    "../models/Clinical/PROMPREMSurveyModel": [B({
      createdAt: day(13, 17), submittedAt: day(13, 17), surveyType: "PREM — Discharge",
      overallScore: 8, comments: "Very satisfied with doctors and nursing care; hospital food could improve.",
    })],
    "../models/Clinical/MedicalCertificateModel": [B({
      createdAt: day(14, 11), issuedAt: day(14, 11), certificateNumber: "MC-2026-00231",
      certificateType: "Fitness for Discharge", issuedByName: "Dr. Sandeep Kumar",
      validFrom: day(14, 11), validTo: future(14),
    })],
  };

  // ── 3. Insert (delete prior demo rows first) ──
  let total = 0;
  for (const [p, docs] of Object.entries(SETS)) {
    const M = resolveModel(p);
    if (!M) { console.warn(`   ⚠️  ${p.split("/").pop()} — model unresolved, skipped`); continue; }
    try {
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
