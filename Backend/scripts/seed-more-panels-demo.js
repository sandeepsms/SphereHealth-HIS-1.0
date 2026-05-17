/* Demo notes for Vitals / I/O / Daily / Nutrition / Education panels. */
require("dotenv").config();
const mongoose = require("mongoose");
const NurseNote = require("../models/Nurse/NurseNotesModel");

const NOTES = [
  { noteType: "vitals", noteData: { bp_sys: "118", bp_dia: "76", pulse: "78", temp: "98.4", spo2: "98", rr: "16", gcs: "15", bsl: "112", painScore: "2", o2Flow: "", o2Device: "None", weight: "62", position: "Supine" }, remarks: "All vitals within range." },
  { noteType: "intake", noteData: { oral: "800", ivFluids: "1000", bloodProducts: "0", urineOutput: "1300", drainOutput: "0", nasogastric: "150", emesis: "100", bloodLoss: "0", notes: "Tolerating oral well." }, remarks: "Net positive ~250 ml." },
  { noteType: "daily", noteData: { bp_sys: "120", bp_dia: "78", pulse: "76", temp: "98.6", spo2: "98", rr: "16", bsl: "104", gcs: "15", neuroStatus: "Alert & Oriented ×3", respiratoryStatus: "Clear bilaterally", cardiovascularStatus: "Regular rate & rhythm", giStatus: "Active bowel sounds, soft non-tender", guStatus: "Urine output adequate, clear", musculoskeletalStatus: "Moves all extremities, normal tone", skinStatus: "Intact, no breakdown", intReposition: true, intOralCare: true, intPressureRelief: true, intCallBell: true, intMedAdministered: true, intIVCheck: true, intFoleyCheck: true, intPatientEducation: true, intFamilyUpdate: true, intDocumented: true }, remarks: "Stable day, no concerns." },
  { noteType: "nutrition", noteData: { bmi: "18.4", bmiLow: 2, weightLoss: 1, reducedIntake: 1, seriouslyIll: 0, nutritionScore: "4", weight: "52", height: "168", idealBodyWeight: "60", actualWeightPercent: "87", midArmCirc: "22", dietType: "High-Protein Soft", consistency: "Soft", fluidRestriction: false, fluidLimit: "", appetite: "Fair", swallowing: "Normal", feedingMode: "Oral", ngtPresent: false, caloriesToday: "1450", proteinToday: "62", fluidToday: "1800", dietitianReferral: true, referralReason: "Low BMI + recent weight loss; needs high-protein optimisation." }, remarks: "Refer to dietitian; MUST score 4 — high risk." },
  { noteType: "education", noteData: { date: "2026-05-17", educator: "Sunita Patil (Staff Nurse)", topics: ["Post-op wound care", "Pain medication schedule", "Mobility & ambulation", "Signs to report"], methods: ["Verbal", "Demonstration", "Printed leaflet"], language: "Hindi", understanding: "Good", barriers: [], response: "Positive", sessionNotes: "Patient + family attended. Demonstrated dressing change technique with return demo. Family verbalised understanding of red-flag signs.", nextSessionDate: "2026-05-19" }, remarks: "Family engaged and asking good questions." },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  for (const n of NOTES) {
    const filter = { patientUHID: "UH00000001", noteType: n.noteType, "noteData.__demo2": "patient-file-panels-v2" };
    const payload = {
      patientUHID: "UH00000001",
      patientName: "JaiBhagwan",
      ipdNo:    "ADM-2026-0001",
      noteDate: new Date(),
      shift:    "morning",
      nurseName: "Sunita Patil",
      noteType:  n.noteType,
      status:    "submitted",
      submittedAt: new Date(),
      signedByName: "Sunita Patil",
      remarks: n.remarks,
      noteData: { ...n.noteData, __demo2: "patient-file-panels-v2" },
    };
    const r = await NurseNote.findOneAndUpdate(filter, payload, { upsert: true, new: true });
    console.log("upserted", n.noteType, "→", r._id.toString());
  }
  await mongoose.disconnect();
})();
