/**
 * seedDemoFeedback.js — populate the patient-feedback dashboard with a
 * realistic spread of submitted feedback (OPD / IPD / Emergency, varied
 * ratings + NPS + comments) across the last few weeks.
 *
 *   Run: node Backend/scripts/seedDemoFeedback.js
 *
 * Idempotent: every row carries `_demoSeed:true`; a re-run deletes the prior
 * demo rows first.
 */
"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");

if (!process.env.MONGO_URI) { console.error("FATAL: MONGO_URI missing"); process.exit(1); }

const Feedback = require("../models/Quality/PatientFeedbackModel");

const R = (o) => ({ doctor: 0, nursing: 0, cleanliness: 0, food: 0, billing: 0, facilities: 0, overall: 0, ...o });
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

// A believable mix: mostly happy, a few lukewarm, a couple unhappy.
const ROWS = [
  { visitType: "IPD", department: "General Medicine", ward: "Male General Ward", patientName: "Ramesh Verma",
    ratings: R({ doctor: 5, nursing: 5, cleanliness: 4, food: 3, billing: 4, facilities: 4, overall: 5 }), npsScore: 10,
    wentWell: "Doctors explained everything patiently and the nurses were very caring.", improvements: "Hospital food could have more variety.", contactConsent: true },
  { visitType: "OPD", department: "Orthopaedics", patientName: "Sunita Devi",
    ratings: R({ doctor: 5, cleanliness: 5, billing: 4, facilities: 5, overall: 5 }), npsScore: 9,
    wentWell: "Very short waiting time and clean OPD.", improvements: "" },
  { visitType: "IPD", department: "Cardiology", ward: "ICU", patientName: "Abdul Khan",
    ratings: R({ doctor: 4, nursing: 5, cleanliness: 5, food: 4, billing: 3, facilities: 4, overall: 4 }), npsScore: 8,
    wentWell: "ICU team was attentive round the clock.", improvements: "Billing counter took a while at discharge.", contactConsent: true },
  { visitType: "Emergency", department: "Emergency", patientName: "Priya Nair",
    ratings: R({ doctor: 5, nursing: 4, cleanliness: 4, facilities: 3, overall: 4 }), npsScore: 9,
    wentWell: "Triage was fast, doctor saw me within minutes.", improvements: "Waiting area seating was limited." },
  { visitType: "OPD", department: "Dermatology",
    ratings: R({ doctor: 3, cleanliness: 4, billing: 3, facilities: 3, overall: 3 }), npsScore: 6, anonymous: true,
    wentWell: "", improvements: "Felt the consultation was a bit rushed." },
  { visitType: "IPD", department: "General Surgery", ward: "Female General Ward", patientName: "Kavita Sharma",
    ratings: R({ doctor: 5, nursing: 5, cleanliness: 5, food: 4, billing: 4, facilities: 5, overall: 5 }), npsScore: 10,
    wentWell: "Surgery went smoothly and the follow-up was excellent.", improvements: "", contactConsent: true },
  { visitType: "OPD", department: "Paediatrics", patientName: "Baby of Anjali",
    ratings: R({ doctor: 5, nursing: 5, cleanliness: 5, facilities: 4, overall: 5 }), npsScore: 10,
    wentWell: "Paediatrician was wonderful with my child.", improvements: "" },
  { visitType: "IPD", department: "Nephrology", ward: "Male General Ward",
    ratings: R({ doctor: 4, nursing: 3, cleanliness: 3, food: 2, billing: 2, facilities: 3, overall: 3 }), npsScore: 5, anonymous: true,
    wentWell: "Treatment was effective.", improvements: "Housekeeping was irregular and the food was cold. Billing had errors that took time to fix." },
  { visitType: "Daycare", department: "Ophthalmology", patientName: "Mohan Lal",
    ratings: R({ doctor: 5, nursing: 4, cleanliness: 5, billing: 5, facilities: 5, overall: 5 }), npsScore: 9,
    wentWell: "Cataract day-care procedure was quick and well organised.", improvements: "" },
  { visitType: "OPD", department: "General Medicine", patientName: "Farah Sheikh",
    ratings: R({ doctor: 4, cleanliness: 4, billing: 4, facilities: 4, overall: 4 }), npsScore: 8,
    wentWell: "Good overall experience.", improvements: "Pharmacy queue was long." },
  { visitType: "IPD", department: "Pulmonology", ward: "Female General Ward", patientName: "Leela Menon",
    ratings: R({ doctor: 5, nursing: 5, cleanliness: 4, food: 4, billing: 4, facilities: 4, overall: 5 }), npsScore: 9,
    wentWell: "Nurses monitored my oxygen very closely, felt safe.", improvements: "", contactConsent: true },
  { visitType: "Emergency", department: "Emergency",
    ratings: R({ doctor: 2, nursing: 3, cleanliness: 3, facilities: 2, overall: 2 }), npsScore: 3, anonymous: true,
    wentWell: "", improvements: "Long wait despite being an emergency; communication could be much better." },
  { visitType: "OPD", department: "ENT", patientName: "Vikram Rao",
    ratings: R({ doctor: 5, cleanliness: 5, billing: 4, facilities: 5, overall: 5 }), npsScore: 10,
    wentWell: "Excellent ENT specialist, clear explanation.", improvements: "" },
  { visitType: "IPD", department: "Gastroenterology", ward: "Male General Ward", patientName: "Iqbal Ahmed",
    ratings: R({ doctor: 4, nursing: 4, cleanliness: 4, food: 3, billing: 3, facilities: 4, overall: 4 }), npsScore: 7,
    wentWell: "Endoscopy team was professional.", improvements: "Discharge process felt slow." },
  { visitType: "OPD", department: "Gynaecology", patientName: "Neha Gupta",
    ratings: R({ doctor: 5, nursing: 5, cleanliness: 5, billing: 5, facilities: 5, overall: 5 }), npsScore: 10,
    wentWell: "Compassionate care and privacy was respected throughout.", improvements: "", contactConsent: true },
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Mongo connected — seeding demo patient feedback\n");

  await Feedback.deleteMany({ _demoSeed: true });

  const docs = ROWS.map((r, i) => ({
    ...r,
    patientName: r.anonymous ? "" : r.patientName,
    submittedVia: i % 4 === 0 ? "patient-link" : "staff",
    submittedByName: r.anonymous || i % 4 === 0 ? "" : "Reception Desk",
    submittedAt: daysAgo((i * 2) % 28 + 1),
    status: "submitted",
    _demoSeed: true,
  }));

  await Feedback.collection.insertMany(docs.map((d) => ({ ...d, createdAt: d.submittedAt, updatedAt: new Date() })));
  console.log(`🎉 Seeded ${docs.length} patient-feedback rows (OPD/IPD/Emergency/Daycare mix).`);
  console.log("   Open /patient-feedback → Dashboard to see them.");
  await mongoose.disconnect();
}
main().catch((e) => { console.error("❌ seed failed:", e.stack || e.message); process.exit(1); });
