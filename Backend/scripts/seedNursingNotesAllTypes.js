/**
 * seedNursingNotesAllTypes.js — seed 5 nursing notes of EVERY note type for
 * one patient, each populated so buildNurseNoteCardHtml's per-type builders
 * render a full card (no empty bodies).
 *
 * Nursing notes store their structured payload under noteData.<key> (unlike
 * doctor notes' noteDetails). Types (NursingNotes "Add a Note" picker):
 *   vitals intake iv pain wound skin fall neuro mews blood procedure daily
 *   careplan nutrition education dvt discharge general  + 1 upserted initial.
 *
 *   Run: node Backend/scripts/seedNursingNotesAllTypes.js            (UH01)
 *        node Backend/scripts/seedNursingNotesAllTypes.js UH07 3     (UH07, 3 each)
 *
 * Idempotent (_demoSeed + _demoBatch:"nursingAllTypes"); raw insert bypasses
 * validators; "initial" is capped at 1 (uniq_initial_per_admission index).
 */
"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");

if (!process.env.MONGO_URI) { console.error("FATAL: MONGO_URI missing"); process.exit(1); }
const UHID  = (process.argv[2] || "UH01").toUpperCase();
const COUNT = Math.max(1, Math.min(parseInt(process.argv[3], 10) || 5, 20));

const now = new Date();
let admit = new Date(now.getTime() - 14 * 86400000);   // fallback; re-anchored to the real admission date in main()
const at = (d, h = 9, m = 0) => { const x = new Date(admit.getTime() + d * 86400000); x.setHours(h, m, 0, 0); return x; };
const RN = "Sunita Patil";
const SHIFTS = ["morning", "evening", "night"];

/* type → { noteData:{<key>:{}}, remarks? }  (i = 1..COUNT) */
const CONTENT = {
  vitals: (i) => ({ noteData: { vitals: {
    bp: { systolic: 110 + i, diastolic: 70 + i }, pulse: 82 + i, temp: (37 + i * 0.1).toFixed(1),
    spo2: 95 + (i % 4), rr: 18 + (i % 3), gcs: "15/15", bsl: 140 + i * 6 } } }),
  intake: (i) => ({ noteData: { intakeOutput: {
    oral: 400 + i * 50, ivFluids: 1000, ivMedFluids: 100 + i * 20, bloodProducts: 0,
    urineOutput: 900 + i * 40, nasogastricOutput: 0, drainOutput: 30 + i * 5, bloodLoss: 0, emesis: 0 } } }),
  iv: (i) => ({ noteData: { ivInfusion: {
    drug: i % 2 ? "Meropenem 1g" : "NS 0.9% maintenance", dose: i % 2 ? "1 g" : "500 ml",
    route: "IV Right forearm", rate: `${80 + i * 5} ml/hr`, site: "Patent",
    siteCondition: "No redness/swelling", startTime: at(i, 8).toLocaleTimeString("en-IN"),
    endTime: at(i, 12).toLocaleTimeString("en-IN"), nurseName: RN } } }),
  pain: (i) => ({ noteData: { painAssessment: {
    score: 6 - i, scale: "NRS", type: "Nociceptive", location: "Right foot wound",
    character: "Throbbing", onset: "Gradual", duration: "Intermittent",
    intervention: i % 2 ? "Inj Tramadol 50mg IV" : "Repositioning + reassurance",
    reassessScore: Math.max(0, 4 - i) } } }),
  wound: (i) => ({ noteData: { woundCare: {
    type: "Diabetic ulcer", site: "Right plantar foot", healingStage: i > 2 ? "Granulating" : "Sloughy",
    dressing: "Betadine + saline gauze", exudateAmt: i > 2 ? "Scanty" : "Moderate", exudateType: "Serous",
    surroundingSkin: "Mild erythema", length: 4 - i * 0.3, width: 3 - i * 0.2, depth: 1,
    odour: i <= 2, painDuring: `${5 - i}/10`, swabSent: i === 1,
    nextDressingDate: at(i + 1, 9).toLocaleDateString("en-IN") } } }),
  skin: (i) => ({ noteData: { skinAssessment: {
    bradenSensoryPerception: 3, bradenMoisture: 3, bradenActivity: 2, bradenMobility: 2,
    bradenNutrition: 3, bradenFrictionShear: 2, bradenTotal: 15 + (i % 3),
    riskBand: "Moderate risk", actions: "2-hrly turning, air mattress, heel offloading" } } }),
  fall: (i) => ({ noteData: { fallRisk: {
    m1: 25, m2: 15, m3: 15, m4: 20, m5: 10, m6: 0, total: 85, riskBand: "HIGH risk (≥45)",
    intBedLowest: true, intBedRails: true, intCallBell: true, intNonSlip: true,
    intSupervision: true, intPatientEd: true, intFamilyEd: i % 2 === 0,
    precautions: "Continuous supervision during ambulation" } } }),
  neuro: (i) => ({ noteData: { neuroAssessment: {
    gcse: 4, gcsv: 5, gcsm: 6, orientation: "Oriented ×3", pupils: "Equal reactive",
    pupilSizeL: 3, pupilSizeR: 3, lightReflex: "Brisk", limbUL: "5/5", limbUR: "5/5",
    limbLL: "4/5", limbLR: "4/5", sensory: "Reduced right foot (neuropathy)", seizure: false } } }),
  mews: (i) => ({ noteData: { mewsScore: {
    rr: 18 + (i % 3), hr: 88 + i, spo2: 95 + (i % 4), sbp: 110 + i, dbp: 70 + i,
    temp: (37 + i * 0.1).toFixed(1), avpu: "Alert", urineOutput: "Adequate",
    total: Math.max(0, 4 - i), band: i > 2 ? "Low — routine monitoring" : "Medium — 4-hrly obs" } } }),
  blood: (i) => ({ noteData: { bloodTransfusion: {
    product: "PRBC", bloodGroup: "B+", bagNo: `BAG-260${i}`, crossMatchNo: `XM-140${i}`, volume: 350,
    startTime: at(i, 10).toLocaleTimeString("en-IN"), endTime: at(i, 13).toLocaleTimeString("en-IN"),
    status: "Completed", preBP_sys: 108, preBP_dia: 68, prePulse: 90, preTemp: "37.0",
    postBP_sys: 116, postBP_dia: 74, postPulse: 84, groupVerified: true,
    reactionType: "No reaction", givenBy: RN, secondNurse: "Asha Rani" } } }),
  procedure: (i) => ({ noteData: { procedure: {
    procedureName: i % 2 ? "Urinary catheterization" : "Wound dressing (aseptic)",
    indication: i % 2 ? "Strict I/O monitoring" : "Diabetic foot ulcer care",
    consentObtained: "Verbal consent", asepsisMaintained: "Full aseptic technique",
    complications: "None", urineColour: i % 2 ? "Clear yellow" : "—",
    initialDrainage: i % 2 ? "300 ml" : "—", postProcVitals: "Stable" } } }),
  daily: (i) => ({ noteData: { dailyAssessment: {
    bp_sys: 112 + i, bp_dia: 72, pulse: 84 + i, rr: 18, temp: "37.0", spo2: 97, gcs: "15/15",
    neuroStatus: "Alert, oriented", respiratoryStatus: "Air entry equal, no distress",
    cardiovascularStatus: "S1S2 normal", giStatus: "Soft, tolerating diet", guStatus: "Adequate output",
    skinStatus: "Sacral area intact, foot wound dressed", generalCondition: "Stable, improving",
    appetiteHydration: "Fair oral intake", mobility: "Assisted with walker", shiftSummary: `Day ${i}: uneventful shift, wound care done.`,
    intCallBell: true, intOralCare: true, intMedAdministered: true, intWoundCare: true, intReposition: true } } }),
  careplan: (i) => ({ noteData: { carePlan: {
    problem: "Impaired skin integrity — diabetic foot ulcer", goal: "Wound healing without infection by day 14",
    interventions: "Daily aseptic dressing, glycaemic control, offloading, nutrition support",
    expectedOutcome: "Granulating wound, no systemic infection", evaluationDate: at(i + 2, 10).toLocaleDateString("en-IN") } } }),
  nutrition: (i) => ({ noteData: { nutritionalAssessment: {
    nutritionScore: 2, diseaseScore: 2, ageScore: 1, nrsTotal: 5, riskBand: "At nutritional risk (NRS ≥3)",
    appetite: i > 2 ? "Improving" : "Poor", weightChange: "-2 kg in 1 month",
    recommendations: "High-protein diabetic diet, dietitian follow-up" } } }),
  education: (i) => ({ noteData: { patientEducation: {
    topics: ["Diabetic foot care", "Insulin administration", "Wound signs to report"],
    methods: ["Verbal", "Demonstration", "Leaflet"], language: "Hindi",
    understanding: i > 2 ? "Good — teach-back correct" : "Partial — reinforced",
    response: "Engaged, asked relevant questions", barriers: i % 2 ? ["Low literacy"] : [],
    sessionNotes: "Family included in session.", educator: RN,
    date: at(i, 15).toLocaleDateString("en-IN"), nextSessionDate: at(i + 3, 15).toLocaleDateString("en-IN") } } }),
  dvt: (i) => ({ noteData: { dvtAssessment: {
    capriniTotal: 6 + i, riskTier: "High (≥5)", improveBleedTier: "Low bleeding risk",
    prophylaxis: i % 2 ? "Enoxaparin 40mg SC OD" : "Mechanical — IPC + early mobilisation" } },
    tags: ["Caprini scored", "IV line patent"] }),
  discharge: (i) => ({ noteData: { discharge: {
    homeSupport: "Lives with son's family", primaryCaregiver: "Son (Suresh)", transportNeed: "Own vehicle",
    anticipatedBarriers: "Wound care compliance", followUpPlan: "OPD review day 7, daily home dressing",
    medicationsToContinue: "Linezolid ×7d, Insulin Glargine, Amlodipine",
    educationStarted: "Foot care + insulin technique demonstrated" } } }),
  general: (i) => ({ remarks: `General observation ${i}: patient comfortable, vitals stable, wound dressing intact, no fresh complaints. Family updated.`,
    noteData: { content: `General observation ${i}: patient comfortable, vitals stable, wound intact, family updated.`,
      doctorInformed: i % 2 === 0, familyInformed: true, patientComfortable: true, monitoringContinued: true } }),
  initial: (i) => ({ noteData: {
    nursing: { admitDate: admit.toLocaleDateString("en-IN"), admitTime: "14:30", ward: "ICU", bedNo: "ICU-3",
      modeOfAdmit: "Ambulance (via ER)", consciousnessLevel: "Drowsy (GCS 12)", mobility: "Bed-bound",
      carePlan: "Sepsis management with source control, glycaemic control and diabetic-foot wound care — hourly monitoring, IV antibiotics as charted, insulin sliding scale, strict intake/output, 2-hrly turning and pressure-area care.",
      dischargePlanning: "Anticipated 12-14 day stay. Discharge goals: infection cleared, wound granulating, independent ambulation with footwear, glycaemia controlled. Patient and son to be educated on foot care, insulin technique, dressing and follow-up before discharge.",
      vitals: { bp: "96/60", pulse: 118, temp: "39.4", spo2: 94, rr: 24 } },
    nursingNabh: {
      allergies: { noKnown: false, list: [{ type: "Drug", agent: "Sulfa", severity: "Moderate", reaction: "Rash" }] },
      anthropometry: { weight: 72, height: 168, bmi: 25.5 },
      homeMedications: [{ drug: "Metformin 500", dose: "1 tab", frequency: "BD" }],
    },
  } }),
};

const TYPE_ORDER = ["initial", "vitals", "daily", "neuro", "pain", "mews", "fall", "dvt", "skin",
  "intake", "iv", "blood", "wound", "procedure", "careplan", "nutrition", "education", "discharge", "general"];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Patient = require("../models/Patient/patientModel");
  const Admission = require("../models/Patient/admissionModel");
  const NurseNotes = require("../models/Nurse/NurseNotesModel");

  const patient = await Patient.findOne({ UHID }).lean();
  if (!patient) { console.error(`No patient ${UHID}`); process.exit(1); }
  const adm = await Admission.findOne({ UHID }).sort({ admissionDate: -1 }).lean();
  const ipdNo = adm?.admissionNumber || "";
  const admissionId = adm?._id || null;
  if (adm?.admissionDate) admit = new Date(adm.admissionDate);   // anchor note dates to the admission banner (date coherence)
  console.log(`✅ ${UHID} (${patient.fullName || patient.firstName}) · admission ${ipdNo} · ${COUNT} of each type\n`);

  const perType = (type) => (type === "initial" ? 1 : COUNT);
  const build = (type, i) => {
    const c = CONTENT[type](i);
    const vd = at(i * 2 + 1, 8 + (TYPE_ORDER.indexOf(type) % 10), (i * 11) % 60);
    return Object.assign({
      UHID, patientUHID: UHID, ipdNo, admissionId, noteType: type,
      nurseName: RN, signedByName: RN, shift: SHIFTS[(i - 1) % 3], status: "submitted",
      noteDate: vd, visitDate: vd, signedAt: vd, createdAt: vd, updatedAt: now,
      _demoSeed: true, _demoBatch: "nursingAllTypes",
    }, c.noteData ? { noteData: c.noteData } : {}, c.remarks ? { remarks: c.remarks } : {}, c.tags ? { tags: c.tags } : {});
  };

  const docs = [];
  TYPE_ORDER.forEach((type) => { if (type === "initial") return; for (let i = 1; i <= perType(type); i++) docs.push(build(type, i)); });

  await NurseNotes.collection.deleteMany({ _demoSeed: true, _demoBatch: "nursingAllTypes", UHID });
  const res = await NurseNotes.collection.insertMany(docs, { ordered: false });

  // Initial — one per admission (two partial-unique indexes: admissionId AND
  // ipdNo). Find any existing IA by either key and enrich it in place;
  // otherwise insert. Avoids colliding with a pre-seeded nursing IA.
  const iaDoc = build("initial", 1);
  const existingIA = await NurseNotes.collection.findOne({
    noteType: "initial", $or: [{ admissionId }, ...(ipdNo ? [{ ipdNo }] : [])],
  });
  if (existingIA) {
    const { createdAt, ...iaSet } = iaDoc;
    await NurseNotes.collection.updateOne({ _id: existingIA._id }, { $set: iaSet });
  } else {
    await NurseNotes.collection.insertOne(iaDoc);
  }

  TYPE_ORDER.forEach((type) =>
    console.log(`   ✅ ${type.padEnd(11)} +${perType(type)}${type === "initial" ? "  (unique per admission — upserted)" : ""}`));
  console.log(`\n🎉 Seeded ${(res.insertedCount || docs.length) + 1} nursing notes across ${TYPE_ORDER.length} types for ${UHID}.`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error("❌ seed failed:", e.stack || e.message); process.exit(1); });
