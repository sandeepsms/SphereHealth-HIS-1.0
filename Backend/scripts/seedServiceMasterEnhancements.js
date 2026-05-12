// scripts/seedServiceMasterEnhancements.js
// ═══════════════════════════════════════════════════════════════
// Two-phase seed for AI Billing Intelligence:
//
//  Phase 1 — enhanceExistingServices()
//    Updates existing ServiceMaster records with aiTags, serviceType,
//    and chargeableBy based on their category.
//
//  Phase 2 — seedSampleServices()
//    Upserts a curated list of common Indian hospital services
//    (nursing, investigations, radiology, procedures, consultations,
//    room charges) by serviceCode — safe to run multiple times.
//
// Usage:
//   node Backend/scripts/seedServiceMasterEnhancements.js
// ═══════════════════════════════════════════════════════════════

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const ServiceMaster = require("../models/ServiceMaster/serviceMasterModel");

// ── Category-level defaults ───────────────────────────────────
const CATEGORY_DEFAULTS = {
  NURSING: {
    serviceType: "nursing",
    chargeableBy: ["Nurse", "Doctor"],
  },
  ROOM: {
    serviceType: "room",
    chargeableBy: ["Auto", "Reception"],
  },
  ICU: {
    serviceType: "icu",
    chargeableBy: ["Auto", "Reception", "Doctor"],
  },
  SUPPORT: {
    // investigations / radiology live here
    serviceType: "investigation",
    chargeableBy: ["Lab", "Doctor"],
  },
  PROCEDURE: {
    serviceType: "procedure",
    chargeableBy: ["Doctor", "Nurse"],
  },
  OT: {
    serviceType: "ot",
    chargeableBy: ["Doctor"],
  },
  CONSULTATION: {
    serviceType: "consultation",
    chargeableBy: ["Doctor", "Reception"],
  },
  PACKAGE: {
    serviceType: "package",
    chargeableBy: ["Doctor", "Reception"],
  },
  REGISTRATION: {
    serviceType: "other",
    chargeableBy: ["Reception"],
  },
  DAYCARE: {
    serviceType: "other",
    chargeableBy: ["Doctor", "Reception"],
  },
  DISCHARGE: {
    serviceType: "other",
    chargeableBy: ["Reception"],
  },
  OTHER: {
    serviceType: "other",
    chargeableBy: ["Doctor", "Reception"],
  },
};

// ── Sample services to upsert ─────────────────────────────────
const SAMPLE_SERVICES = [
  // ── Nursing — chargeable by nurses ──────────────────────────
  {
    serviceName: "IV Cannulation",
    serviceCode: "NRS-001",
    category: "NURSING",
    serviceType: "nursing",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 150,
    chargeableBy: ["Nurse", "Doctor"],
    aiTags: ["iv", "cannula", "line", "access"],
    domain: "COMMON",
  },
  {
    serviceName: "IV Fluid Administration",
    serviceCode: "NRS-002",
    category: "NURSING",
    serviceType: "nursing",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 100,
    chargeableBy: ["Nurse"],
    aiTags: ["iv fluid", "drip", "infusion", "saline"],
    domain: "COMMON",
  },
  {
    serviceName: "Urinary Catheterisation",
    serviceCode: "NRS-003",
    category: "NURSING",
    serviceType: "nursing",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 300,
    chargeableBy: ["Nurse", "Doctor"],
    aiTags: ["foley", "catheter", "urinary", "retention"],
    domain: "COMMON",
  },
  {
    serviceName: "Dressing - Simple",
    serviceCode: "NRS-004",
    category: "NURSING",
    serviceType: "nursing",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 200,
    chargeableBy: ["Nurse", "Doctor"],
    aiTags: ["wound", "dressing", "bandage", "suture"],
    domain: "COMMON",
  },
  {
    serviceName: "Dressing - Complex",
    serviceCode: "NRS-005",
    category: "NURSING",
    serviceType: "nursing",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 500,
    chargeableBy: ["Nurse", "Doctor"],
    aiTags: ["wound", "ulcer", "pressure sore", "debridement"],
    domain: "COMMON",
  },
  {
    serviceName: "Nasogastric Tube Insertion",
    serviceCode: "NRS-006",
    category: "NURSING",
    serviceType: "nursing",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 400,
    chargeableBy: ["Nurse", "Doctor"],
    aiTags: ["ngt", "nasogastric", "feeding tube", "ryles tube"],
    domain: "COMMON",
  },
  {
    serviceName: "Oxygen Administration (per hour)",
    serviceCode: "NRS-007",
    category: "NURSING",
    serviceType: "nursing",
    applicableTo: ["ALL"],
    billingType: "PER_HOUR",
    defaultPrice: 50,
    chargeableBy: ["Nurse"],
    aiTags: ["oxygen", "o2", "spo2", "hypoxia", "respiratory"],
    domain: "COMMON",
  },
  {
    serviceName: "Nebulisation",
    serviceCode: "NRS-008",
    category: "NURSING",
    serviceType: "nursing",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 150,
    chargeableBy: ["Nurse"],
    aiTags: ["nebuliser", "bronchospasm", "asthma", "copd", "wheezing"],
    domain: "COMMON",
  },
  {
    serviceName: "Blood Glucose Monitoring (RBS)",
    serviceCode: "NRS-009",
    category: "NURSING",
    serviceType: "nursing",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 50,
    chargeableBy: ["Nurse"],
    aiTags: ["bsl", "rbs", "blood sugar", "diabetes", "dm", "glucose"],
    domain: "COMMON",
  },
  {
    serviceName: "ECG 12-Lead",
    serviceCode: "NRS-010",
    category: "NURSING",
    serviceType: "nursing",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 200,
    chargeableBy: ["Nurse", "Doctor"],
    aiTags: ["ecg", "ekg", "cardiac", "chest pain", "arrhythmia", "heart"],
    domain: "COMMON",
  },

  // ── Investigations — chargeable by Lab ──────────────────────
  {
    serviceName: "Complete Blood Count (CBC)",
    serviceCode: "INV-001",
    category: "SUPPORT",
    serviceType: "investigation",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 300,
    chargeableBy: ["Lab", "Doctor", "Nurse"],
    aiTags: [
      "cbc",
      "blood count",
      "haemoglobin",
      "wbc",
      "platelets",
      "anemia",
      "infection",
    ],
    domain: "COMMON",
  },
  {
    serviceName: "Blood Urea & Creatinine",
    serviceCode: "INV-002",
    category: "SUPPORT",
    serviceType: "investigation",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 350,
    chargeableBy: ["Lab", "Doctor"],
    aiTags: ["renal", "kidney", "urea", "creatinine", "ckd", "arf", "aki"],
    domain: "COMMON",
  },
  {
    serviceName: "Liver Function Tests (LFT)",
    serviceCode: "INV-003",
    category: "SUPPORT",
    serviceType: "investigation",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 600,
    chargeableBy: ["Lab", "Doctor"],
    aiTags: [
      "liver",
      "hepatitis",
      "jaundice",
      "bilirubin",
      "sgot",
      "sgpt",
      "lft",
    ],
    domain: "COMMON",
  },
  {
    serviceName: "Electrolytes (Na/K/Cl)",
    serviceCode: "INV-004",
    category: "SUPPORT",
    serviceType: "investigation",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 400,
    chargeableBy: ["Lab", "Doctor", "Nurse"],
    aiTags: [
      "electrolytes",
      "sodium",
      "potassium",
      "hyponatremia",
      "hypokalemia",
      "diarrhea",
      "vomiting",
    ],
    domain: "COMMON",
  },
  {
    serviceName: "Random Blood Sugar (RBS)",
    serviceCode: "INV-005",
    category: "SUPPORT",
    serviceType: "investigation",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 80,
    chargeableBy: ["Lab", "Nurse"],
    aiTags: ["rbs", "blood sugar", "diabetes", "dm", "glucose", "hyperglycemia"],
    domain: "COMMON",
  },
  {
    serviceName: "HbA1c",
    serviceCode: "INV-006",
    category: "SUPPORT",
    serviceType: "investigation",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 500,
    chargeableBy: ["Lab", "Doctor"],
    aiTags: [
      "hba1c",
      "glycated haemoglobin",
      "diabetes",
      "dm",
      "sugar control",
    ],
    domain: "COMMON",
  },
  {
    serviceName: "Urine Routine & Microscopy",
    serviceCode: "INV-007",
    category: "SUPPORT",
    serviceType: "investigation",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 150,
    chargeableBy: ["Lab", "Doctor", "Nurse"],
    aiTags: ["urine", "uti", "urinary infection", "albuminuria", "proteinuria"],
    domain: "COMMON",
  },
  {
    serviceName: "Troponin I (rapid)",
    serviceCode: "INV-008",
    category: "SUPPORT",
    serviceType: "investigation",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 800,
    chargeableBy: ["Lab", "Doctor", "Nurse"],
    aiTags: ["troponin", "mi", "heart attack", "acs", "chest pain", "cardiac"],
    domain: "COMMON",
  },
  {
    serviceName: "D-Dimer",
    serviceCode: "INV-009",
    category: "SUPPORT",
    serviceType: "investigation",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 1200,
    chargeableBy: ["Lab", "Doctor"],
    aiTags: ["dvt", "pe", "pulmonary embolism", "clot", "thrombosis", "d-dimer"],
    domain: "COMMON",
  },
  {
    serviceName: "Thyroid Profile (T3/T4/TSH)",
    serviceCode: "INV-010",
    category: "SUPPORT",
    serviceType: "investigation",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 700,
    chargeableBy: ["Lab", "Doctor"],
    aiTags: ["thyroid", "tsh", "hypothyroid", "hyperthyroid", "t3", "t4"],
    domain: "COMMON",
  },
  {
    serviceName: "PT/INR (Coagulation)",
    serviceCode: "INV-011",
    category: "SUPPORT",
    serviceType: "investigation",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 300,
    chargeableBy: ["Lab", "Doctor"],
    aiTags: ["inr", "pt", "coagulation", "anticoagulant", "warfarin", "bleeding"],
    domain: "COMMON",
  },
  {
    serviceName: "Blood Culture & Sensitivity",
    serviceCode: "INV-012",
    category: "SUPPORT",
    serviceType: "investigation",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 1200,
    chargeableBy: ["Lab", "Doctor", "Nurse"],
    aiTags: [
      "blood culture",
      "sepsis",
      "bacteremia",
      "fever",
      "infection",
      "antibiotic",
    ],
    domain: "COMMON",
  },

  // ── Radiology — chargeable by Radiology dept ─────────────────
  {
    serviceName: "X-Ray Chest (PA view)",
    serviceCode: "RAD-001",
    category: "SUPPORT",
    serviceType: "radiology",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 300,
    chargeableBy: ["Radiology", "Doctor", "Nurse"],
    aiTags: ["x-ray", "chest", "cxr", "pneumonia", "TB", "COPD", "pleural"],
    domain: "COMMON",
  },
  {
    serviceName: "X-Ray Abdomen",
    serviceCode: "RAD-002",
    category: "SUPPORT",
    serviceType: "radiology",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 350,
    chargeableBy: ["Radiology", "Doctor"],
    aiTags: [
      "x-ray",
      "abdomen",
      "bowel",
      "obstruction",
      "perforation",
      "calculi",
    ],
    domain: "COMMON",
  },
  {
    serviceName: "USG Abdomen & Pelvis",
    serviceCode: "RAD-003",
    category: "SUPPORT",
    serviceType: "radiology",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 800,
    chargeableBy: ["Radiology", "Doctor"],
    aiTags: [
      "ultrasound",
      "usg",
      "abdomen",
      "liver",
      "gallbladder",
      "kidney",
      "pelvis",
    ],
    domain: "COMMON",
  },
  {
    serviceName: "CT Scan Head Plain",
    serviceCode: "RAD-004",
    category: "SUPPORT",
    serviceType: "radiology",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 3500,
    chargeableBy: ["Radiology", "Doctor"],
    aiTags: [
      "ct",
      "brain",
      "head",
      "stroke",
      "bleed",
      "neurological",
      "seizure",
    ],
    domain: "COMMON",
  },
  {
    serviceName: "CT Scan Thorax (HRCT)",
    serviceCode: "RAD-005",
    category: "SUPPORT",
    serviceType: "radiology",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 4000,
    chargeableBy: ["Radiology", "Doctor"],
    aiTags: ["ct thorax", "hrct", "covid", "pneumonia", "lung", "pulmonary"],
    domain: "COMMON",
  },
  {
    serviceName: "2D Echo (Echocardiography)",
    serviceCode: "RAD-006",
    category: "SUPPORT",
    serviceType: "radiology",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 2000,
    chargeableBy: ["Radiology", "Doctor"],
    aiTags: [
      "echo",
      "cardiac",
      "heart",
      "ejection fraction",
      "valve",
      "pericardial",
    ],
    domain: "COMMON",
  },
  {
    serviceName: "ECG Interpretation (Cardiologist)",
    serviceCode: "RAD-007",
    category: "SUPPORT",
    serviceType: "radiology",
    applicableTo: ["ALL"],
    billingType: "PER_UNIT",
    defaultPrice: 300,
    chargeableBy: ["Doctor"],
    aiTags: ["ecg", "cardiac", "arrhythmia", "reading", "interpretation"],
    domain: "COMMON",
  },

  // ── Procedures ───────────────────────────────────────────────
  {
    serviceName: "Pleural Tap (Thoracocentesis)",
    serviceCode: "PRO-001",
    category: "PROCEDURE",
    serviceType: "procedure",
    applicableTo: ["IPD"],
    billingType: "PER_UNIT",
    defaultPrice: 3000,
    chargeableBy: ["Doctor", "Nurse"],
    aiTags: ["pleural effusion", "tap", "thoracocentesis", "fluid"],
    domain: "IPD",
  },
  {
    serviceName: "Lumbar Puncture (CSF)",
    serviceCode: "PRO-002",
    category: "PROCEDURE",
    serviceType: "procedure",
    applicableTo: ["IPD"],
    billingType: "PER_UNIT",
    defaultPrice: 3500,
    chargeableBy: ["Doctor", "Nurse"],
    aiTags: ["lumbar puncture", "csf", "meningitis", "lp", "spinal"],
    domain: "IPD",
  },
  {
    serviceName: "Ascitic Tap",
    serviceCode: "PRO-003",
    category: "PROCEDURE",
    serviceType: "procedure",
    applicableTo: ["IPD"],
    billingType: "PER_UNIT",
    defaultPrice: 2500,
    chargeableBy: ["Doctor", "Nurse"],
    aiTags: [
      "ascites",
      "tap",
      "abdomen",
      "liver cirrhosis",
      "paracentesis",
    ],
    domain: "IPD",
  },
  {
    serviceName: "Central Line Insertion (CVP)",
    serviceCode: "PRO-004",
    category: "PROCEDURE",
    serviceType: "procedure",
    applicableTo: ["IPD"],
    billingType: "PER_UNIT",
    defaultPrice: 5000,
    chargeableBy: ["Doctor", "Nurse"],
    aiTags: ["central line", "cvp", "icu", "venous access", "sepsis"],
    domain: "IPD",
  },
  {
    serviceName: "Intubation & Mechanical Ventilation",
    serviceCode: "PRO-005",
    category: "ICU",
    serviceType: "procedure",
    applicableTo: ["IPD"],
    billingType: "PER_DAY",
    defaultPrice: 2000,
    chargeableBy: ["Doctor", "Nurse"],
    aiTags: [
      "intubation",
      "ventilator",
      "respiratory failure",
      "icu",
      "critical",
    ],
    domain: "IPD",
  },

  // ── Consultation ─────────────────────────────────────────────
  {
    serviceName: "Specialist Consultation",
    serviceCode: "CON-001",
    category: "CONSULTATION",
    serviceType: "consultation",
    applicableTo: ["ALL"],
    billingType: "PER_VISIT",
    defaultPrice: 500,
    chargeableBy: ["Doctor", "Reception"],
    aiTags: ["consultation", "specialist", "referral", "opinion"],
    domain: "COMMON",
  },
  {
    serviceName: "Emergency Consultation",
    serviceCode: "CON-002",
    category: "CONSULTATION",
    serviceType: "consultation",
    applicableTo: ["EMERGENCY"],
    billingType: "PER_VISIT",
    defaultPrice: 800,
    chargeableBy: ["Doctor", "Reception"],
    aiTags: ["emergency", "urgent", "consultation"],
    domain: "EMERGENCY",
  },

  // ── Room charges (IPD) ───────────────────────────────────────
  {
    serviceName: "General Ward (per day)",
    serviceCode: "RM-001",
    category: "ROOM",
    serviceType: "room",
    applicableTo: ["IPD"],
    billingType: "PER_DAY",
    defaultPrice: 800,
    isAutoCharged: true,
    chargeableBy: ["Auto", "Reception"],
    aiTags: [],
    domain: "IPD",
  },
  {
    serviceName: "Semi-Private Room (per day)",
    serviceCode: "RM-002",
    category: "ROOM",
    serviceType: "room",
    applicableTo: ["IPD"],
    billingType: "PER_DAY",
    defaultPrice: 1500,
    isAutoCharged: true,
    chargeableBy: ["Auto", "Reception"],
    aiTags: [],
    domain: "IPD",
  },
  {
    serviceName: "Private Room (per day)",
    serviceCode: "RM-003",
    category: "ROOM",
    serviceType: "room",
    applicableTo: ["IPD"],
    billingType: "PER_DAY",
    defaultPrice: 2500,
    isAutoCharged: true,
    chargeableBy: ["Auto", "Reception"],
    aiTags: [],
    domain: "IPD",
  },
  {
    serviceName: "ICU Bed (per day)",
    serviceCode: "RM-004",
    category: "ICU",
    serviceType: "room",
    applicableTo: ["IPD"],
    billingType: "PER_DAY",
    defaultPrice: 5000,
    isAutoCharged: true,
    chargeableBy: ["Auto", "Reception"],
    aiTags: ["icu", "critical", "intensive care"],
    domain: "IPD",
  },

  // ──────────────────────────────────────────────────────────────
  //  Auto-billing engine codes
  //  The autoBillingService references these short codes directly
  //  (OPD-CON, REG-IPD, ADM-IPD, BED-DAY-IPD, ER-TRIAGE, NRS-BLD,
  //  NRS-INJ). Without these rows, every event-driven charge silently
  //  fails the Service-master lookup and never produces a bill item.
  // ──────────────────────────────────────────────────────────────
  {
    serviceName: "OPD Consultation",
    serviceCode: "OPD-CON",
    category: "CONSULTATION",
    serviceType: "consultation",
    applicableTo: ["OPD"],
    billingType: "PER_VISIT",
    defaultPrice: 500,
    isAutoCharged: true,
    chargeableBy: ["Auto", "Reception"],
    aiTags: ["opd", "consultation", "outpatient"],
    domain: "OPD",
  },
  {
    serviceName: "OPD Registration Fee",
    serviceCode: "REG-OPD",
    category: "REGISTRATION",
    serviceType: "other",
    applicableTo: ["OPD"],
    billingType: "PER_VISIT",
    defaultPrice: 100,
    isAutoCharged: true,
    chargeableBy: ["Auto", "Reception"],
    aiTags: ["opd", "registration"],
    domain: "OPD",
  },
  {
    serviceName: "IPD Registration Fee",
    serviceCode: "REG-IPD",
    category: "REGISTRATION",
    serviceType: "other",
    applicableTo: ["IPD"],
    billingType: "ONE_TIME",
    defaultPrice: 200,
    isAutoCharged: true,
    chargeableBy: ["Auto", "Reception"],
    aiTags: ["ipd", "registration"],
    domain: "IPD",
  },
  {
    serviceName: "Daycare Registration Fee",
    serviceCode: "REG-DAYCARE",
    category: "REGISTRATION",
    serviceType: "other",
    applicableTo: ["DAYCARE"],
    billingType: "ONE_TIME",
    defaultPrice: 150,
    isAutoCharged: true,
    chargeableBy: ["Auto", "Reception"],
    aiTags: ["daycare", "registration"],
    domain: "IPD",
  },
  {
    serviceName: "Emergency Registration Fee",
    serviceCode: "REG-EMERGENCY",
    category: "REGISTRATION",
    serviceType: "other",
    applicableTo: ["EMERGENCY"],
    billingType: "ONE_TIME",
    defaultPrice: 200,
    isAutoCharged: true,
    chargeableBy: ["Auto", "Reception"],
    aiTags: ["emergency", "registration"],
    domain: "EMERGENCY",
  },
  {
    serviceName: "IPD Admission Charge",
    serviceCode: "ADM-IPD",
    category: "REGISTRATION",
    serviceType: "other",
    applicableTo: ["IPD"],
    billingType: "ONE_TIME",
    defaultPrice: 500,
    isAutoCharged: true,
    chargeableBy: ["Auto", "Reception"],
    aiTags: ["ipd", "admission"],
    domain: "IPD",
  },
  {
    serviceName: "Daycare Admission Charge",
    serviceCode: "ADM-DAYCARE",
    category: "REGISTRATION",
    serviceType: "other",
    applicableTo: ["DAYCARE"],
    billingType: "ONE_TIME",
    defaultPrice: 300,
    isAutoCharged: true,
    chargeableBy: ["Auto", "Reception"],
    aiTags: ["daycare", "admission"],
    domain: "IPD",
  },
  {
    serviceName: "Emergency Admission Charge",
    serviceCode: "ADM-EMERGENCY",
    category: "REGISTRATION",
    serviceType: "other",
    applicableTo: ["EMERGENCY"],
    billingType: "ONE_TIME",
    defaultPrice: 800,
    isAutoCharged: true,
    chargeableBy: ["Auto", "Reception"],
    aiTags: ["emergency", "admission"],
    domain: "EMERGENCY",
  },
  {
    serviceName: "IPD Bed Charge (per day)",
    serviceCode: "BED-DAY-IPD",
    category: "ROOM",
    serviceType: "room",
    applicableTo: ["IPD"],
    billingType: "PER_DAY",
    defaultPrice: 1500,
    isAutoCharged: true,
    chargeableBy: ["Auto"],
    aiTags: ["ipd", "bed", "room", "per day"],
    domain: "IPD",
  },
  {
    serviceName: "Daycare Bed Charge (per session)",
    serviceCode: "BED-DAY-DAYCARE",
    category: "ROOM",
    serviceType: "room",
    applicableTo: ["DAYCARE"],
    billingType: "PER_DAY",
    defaultPrice: 800,
    isAutoCharged: true,
    chargeableBy: ["Auto"],
    aiTags: ["daycare", "bed", "session"],
    domain: "IPD",
  },
  {
    serviceName: "Emergency Triage / Observation",
    serviceCode: "ER-TRIAGE",
    category: "PROCEDURE",
    serviceType: "procedure",
    applicableTo: ["EMERGENCY"],
    billingType: "PER_VISIT",
    defaultPrice: 500,
    isAutoCharged: true,
    chargeableBy: ["Auto", "Reception"],
    aiTags: ["emergency", "triage", "observation"],
    domain: "EMERGENCY",
  },
  {
    serviceName: "Blood Transfusion Service Charge",
    serviceCode: "NRS-BLD",
    category: "NURSING",
    serviceType: "nursing",
    applicableTo: ["IPD", "DAYCARE", "EMERGENCY"],
    billingType: "PER_UNIT",
    defaultPrice: 1500,
    isAutoCharged: false,
    chargeableBy: ["Nurse", "Doctor"],
    aiTags: ["blood", "transfusion"],
    domain: "IPD",
  },
  {
    serviceName: "Injection Administration",
    serviceCode: "NRS-INJ",
    category: "NURSING",
    serviceType: "nursing",
    applicableTo: ["IPD", "DAYCARE", "EMERGENCY", "OPD"],
    billingType: "PER_UNIT",
    defaultPrice: 100,
    isAutoCharged: true,
    chargeableBy: ["Nurse", "Doctor"],
    aiTags: ["injection", "administration", "im", "iv"],
    domain: "IPD",
  },
];

// ── Phase 1: Enhance existing services ───────────────────────
async function enhanceExistingServices() {
  console.log("\n[Phase 1] Enhancing existing ServiceMaster records...");
  const services = await ServiceMaster.find({});
  console.log(`  Found ${services.length} existing services`);

  let updated = 0;
  for (const svc of services) {
    const defaults = CATEGORY_DEFAULTS[svc.category] || CATEGORY_DEFAULTS.OTHER;

    const update = {};

    // Only set serviceType if not already set (not the schema default "other"
    // which could be intentional, so we check if missing/default)
    if (!svc.serviceType || svc.serviceType === "other") {
      update.serviceType = defaults.serviceType;
    }

    // Only set chargeableBy if it's still the schema default
    const defaultChargeableBy = ["Doctor", "Reception"];
    const isDefault =
      svc.chargeableBy?.length === 2 &&
      svc.chargeableBy.includes("Doctor") &&
      svc.chargeableBy.includes("Reception");
    if (!svc.chargeableBy || isDefault) {
      update.chargeableBy = defaults.chargeableBy;
    }

    if (Object.keys(update).length > 0) {
      await ServiceMaster.updateOne({ _id: svc._id }, { $set: update });
      updated++;
    }
  }
  console.log(`  Updated ${updated} services with category-level defaults.`);
}

// ── Phase 2: Upsert sample services ──────────────────────────
async function seedSampleServices() {
  console.log("\n[Phase 2] Upserting sample services...");

  let inserted = 0;
  let skipped = 0;

  for (const svcData of SAMPLE_SERVICES) {
    const result = await ServiceMaster.updateOne(
      { serviceCode: svcData.serviceCode },
      { $setOnInsert: { ...svcData, isActive: true } },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      console.log(`  [+] Inserted: ${svcData.serviceCode} — ${svcData.serviceName}`);
      inserted++;
    } else {
      console.log(`  [=] Exists:   ${svcData.serviceCode} — ${svcData.serviceName}`);
      skipped++;
    }
  }

  console.log(`\n  Inserted: ${inserted}  |  Already existed: ${skipped}`);
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log("Connected.");

  await enhanceExistingServices();
  await seedSampleServices();

  console.log("\nSeed complete.\n");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
