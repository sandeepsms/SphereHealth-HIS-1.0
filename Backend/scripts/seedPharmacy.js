/**
 * seedPharmacy.js
 *
 * Seeds the pharmacy with a realistic drug master (50+ entries across
 * every category) and a handful of inbound batches per drug so the
 * inventory / FIFO / alerts / dispense flows have real data to chew on.
 *
 * Run:
 *   node Backend/scripts/seedPharmacy.js              # safe — skips drugs that already exist
 *   node Backend/scripts/seedPharmacy.js --reseed     # delete & re-create everything
 *   node Backend/scripts/seedPharmacy.js --batches-only  # only add batches to existing drugs
 *
 * Supplier(s) are also seeded so GRNs have a proper vendor reference.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose  = require("mongoose");
const connectDB = require("../config/db");

const Drug      = require("../models/Pharmacy/DrugModel");
const DrugBatch = require("../models/Pharmacy/DrugBatchModel");
const Supplier  = require("../models/Pharmacy/SupplierModel");

const args = process.argv.slice(2);
const RESEED       = args.includes("--reseed");
const BATCHES_ONLY = args.includes("--batches-only");

/* ────────────────────────────────────────────────────────────────
   SUPPLIER LIST — typical Indian distributor profile
──────────────────────────────────────────────────────────────── */
const SUPPLIERS = [
  { name: "MediCorp Distributors",   contactPerson: "Rakesh Sharma",   phone: "+91-9876500001", gstin: "27ABCDE1234F1Z5", drugLicenseNo: "MH/20B/2023-456",  city: "Mumbai",    state: "Maharashtra", pincode: "400001", creditDays: 30 },
  { name: "PharmaPlus Wholesale",    contactPerson: "Anjali Verma",    phone: "+91-9876500002", gstin: "07XYZAB5678P1Z3", drugLicenseNo: "DL/20B/2023-1024", city: "Delhi",     state: "Delhi",       pincode: "110001", creditDays: 45 },
  { name: "Apollo Surgical Supplies",contactPerson: "Suresh Iyer",     phone: "+91-9876500003", gstin: "33LMNOP9012Q1Z7", drugLicenseNo: "TN/20B/2023-789",  city: "Chennai",   state: "Tamil Nadu",  pincode: "600001", creditDays: 30 },
  { name: "Cipla Direct",            contactPerson: "Priya Nair",      phone: "+91-9876500004", gstin: "27CIPLA1234C1Z9", drugLicenseNo: "MH/20B/2023-2001", city: "Mumbai",    state: "Maharashtra", pincode: "400069", creditDays: 21 },
  { name: "Sun Pharma Channel",      contactPerson: "Amit Kapoor",     phone: "+91-9876500005", gstin: "24SUNPH5678S1Z2", drugLicenseNo: "GJ/20B/2023-3142", city: "Ahmedabad", state: "Gujarat",     pincode: "380015", creditDays: 60 },
];

/* ────────────────────────────────────────────────────────────────
   DRUG MASTER — 55 real-world drugs across every category
──────────────────────────────────────────────────────────────── */
const DRUGS = [
  // ── Antibiotics ────────────────────────────────────────────
  { name: "Amoxicillin 500mg",          genericName: "Amoxicillin",                brandName: "Mox",         manufacturer: "Cipla",        form: "Capsule",   strength: "500mg",   pack: "10 caps/strip",  category: "Antibiotic",    schedule: "H",  hsnCode: "30049099", gstRate: 12, reorderLevel: 100, defaultSalePrice: 12,    isHighAlert: false },
  { name: "Azithromycin 500mg",         genericName: "Azithromycin",               brandName: "Azithral",    manufacturer: "Alembic",      form: "Tablet",    strength: "500mg",   pack: "5 tabs/strip",   category: "Antibiotic",    schedule: "H",  hsnCode: "30049099", gstRate: 12, reorderLevel: 80,  defaultSalePrice: 78  },
  { name: "Ciprofloxacin 500mg",        genericName: "Ciprofloxacin",              brandName: "Cifran",      manufacturer: "Sun Pharma",   form: "Tablet",    strength: "500mg",   pack: "10 tabs/strip",  category: "Antibiotic",    schedule: "H",  hsnCode: "30049099", gstRate: 12, reorderLevel: 80,  defaultSalePrice: 18  },
  { name: "Doxycycline 100mg",          genericName: "Doxycycline Hyclate",        brandName: "Doxt",        manufacturer: "Dr. Reddy's",  form: "Capsule",   strength: "100mg",   pack: "10 caps/strip",  category: "Antibiotic",    schedule: "H",  hsnCode: "30049099", gstRate: 12, reorderLevel: 60,  defaultSalePrice: 14  },
  { name: "Cefixime 200mg",             genericName: "Cefixime",                   brandName: "Taxim-O",     manufacturer: "Alkem",        form: "Tablet",    strength: "200mg",   pack: "10 tabs/strip",  category: "Antibiotic",    schedule: "H",  hsnCode: "30049099", gstRate: 12, reorderLevel: 70,  defaultSalePrice: 32  },
  { name: "Metronidazole 400mg",        genericName: "Metronidazole",              brandName: "Flagyl",      manufacturer: "Abbott",       form: "Tablet",    strength: "400mg",   pack: "10 tabs/strip",  category: "Antibiotic",    schedule: "H",  hsnCode: "30049099", gstRate: 12, reorderLevel: 100, defaultSalePrice: 7   },
  { name: "Ceftriaxone 1g Inj",         genericName: "Ceftriaxone Sodium",         brandName: "Monocef",     manufacturer: "Aristo",       form: "Injection", strength: "1g",      pack: "Vial",           category: "Antibiotic",    schedule: "H",  hsnCode: "30042090", gstRate: 12, reorderLevel: 50,  defaultSalePrice: 65  },
  { name: "Levofloxacin 500mg",         genericName: "Levofloxacin",               brandName: "Levoflox",    manufacturer: "Cipla",        form: "Tablet",    strength: "500mg",   pack: "5 tabs/strip",   category: "Antibiotic",    schedule: "H",  hsnCode: "30049099", gstRate: 12, reorderLevel: 50,  defaultSalePrice: 42  },

  // ── Analgesics / Antipyretics ──────────────────────────────
  { name: "Paracetamol 500mg",          genericName: "Acetaminophen",              brandName: "Crocin",      manufacturer: "GSK",          form: "Tablet",    strength: "500mg",   pack: "15 tabs/strip",  category: "Analgesic",     schedule: "OTC",hsnCode: "30049011", gstRate: 12, reorderLevel: 300, defaultSalePrice: 2.5 },
  { name: "Paracetamol 650mg",          genericName: "Acetaminophen",              brandName: "Dolo 650",    manufacturer: "Micro Labs",   form: "Tablet",    strength: "650mg",   pack: "15 tabs/strip",  category: "Analgesic",     schedule: "OTC",hsnCode: "30049011", gstRate: 12, reorderLevel: 300, defaultSalePrice: 3   },
  { name: "Ibuprofen 400mg",            genericName: "Ibuprofen",                  brandName: "Brufen",      manufacturer: "Abbott",       form: "Tablet",    strength: "400mg",   pack: "15 tabs/strip",  category: "Analgesic",     schedule: "OTC",hsnCode: "30049011", gstRate: 12, reorderLevel: 150, defaultSalePrice: 3.5 },
  { name: "Diclofenac 50mg",            genericName: "Diclofenac Sodium",          brandName: "Voveran",     manufacturer: "Novartis",     form: "Tablet",    strength: "50mg",    pack: "10 tabs/strip",  category: "Analgesic",     schedule: "H",  hsnCode: "30049011", gstRate: 12, reorderLevel: 120, defaultSalePrice: 4   },
  { name: "Tramadol 50mg",              genericName: "Tramadol HCl",               brandName: "Tramazac",    manufacturer: "Zydus",        form: "Capsule",   strength: "50mg",    pack: "10 caps/strip",  category: "Analgesic",     schedule: "H1", hsnCode: "30049011", gstRate: 12, reorderLevel: 60,  defaultSalePrice: 12,   isHighAlert: true,  isNarcotic: true },
  { name: "Morphine 10mg Inj",          genericName: "Morphine Sulphate",          brandName: "Morcontin",   manufacturer: "Modi-Mundi",   form: "Injection", strength: "10mg/mL", pack: "Ampoule",        category: "Analgesic",     schedule: "X",  hsnCode: "30042020", gstRate: 12, reorderLevel: 20,  defaultSalePrice: 35,   isHighAlert: true,  isNarcotic: true },
  { name: "Aceclofenac 100mg",          genericName: "Aceclofenac",                brandName: "Hifenac",     manufacturer: "Intas",        form: "Tablet",    strength: "100mg",   pack: "10 tabs/strip",  category: "Analgesic",     schedule: "H",  hsnCode: "30049011", gstRate: 12, reorderLevel: 100, defaultSalePrice: 8   },

  // ── Antihypertensives ─────────────────────────────────────
  { name: "Amlodipine 5mg",             genericName: "Amlodipine Besylate",        brandName: "Amlong",      manufacturer: "Micro Labs",   form: "Tablet",    strength: "5mg",     pack: "10 tabs/strip",  category: "Antihypertensive", schedule: "H", hsnCode: "30049022", gstRate: 12, reorderLevel: 100, defaultSalePrice: 4 },
  { name: "Telmisartan 40mg",           genericName: "Telmisartan",                brandName: "Telma",       manufacturer: "Glenmark",     form: "Tablet",    strength: "40mg",    pack: "10 tabs/strip",  category: "Antihypertensive", schedule: "H", hsnCode: "30049022", gstRate: 12, reorderLevel: 80,  defaultSalePrice: 11 },
  { name: "Losartan 50mg",              genericName: "Losartan Potassium",         brandName: "Losar",       manufacturer: "Unichem",      form: "Tablet",    strength: "50mg",    pack: "10 tabs/strip",  category: "Antihypertensive", schedule: "H", hsnCode: "30049022", gstRate: 12, reorderLevel: 80,  defaultSalePrice: 9  },
  { name: "Metoprolol 50mg",            genericName: "Metoprolol Succinate",       brandName: "Metolar",     manufacturer: "Cipla",        form: "Tablet",    strength: "50mg",    pack: "10 tabs/strip",  category: "Antihypertensive", schedule: "H", hsnCode: "30049022", gstRate: 12, reorderLevel: 60,  defaultSalePrice: 12 },
  { name: "Ramipril 5mg",               genericName: "Ramipril",                   brandName: "Cardace",     manufacturer: "Sanofi",       form: "Capsule",   strength: "5mg",     pack: "10 caps/strip",  category: "Antihypertensive", schedule: "H", hsnCode: "30049022", gstRate: 12, reorderLevel: 70,  defaultSalePrice: 14 },
  { name: "Atenolol 50mg",              genericName: "Atenolol",                   brandName: "Aten",        manufacturer: "Zydus",        form: "Tablet",    strength: "50mg",    pack: "14 tabs/strip",  category: "Antihypertensive", schedule: "H", hsnCode: "30049022", gstRate: 12, reorderLevel: 80,  defaultSalePrice: 6  },

  // ── Antidiabetics ─────────────────────────────────────────
  { name: "Metformin 500mg",            genericName: "Metformin HCl",              brandName: "Glycomet",    manufacturer: "USV",          form: "Tablet",    strength: "500mg",   pack: "20 tabs/strip",  category: "Antidiabetic",  schedule: "H",  hsnCode: "30049030", gstRate: 12, reorderLevel: 200, defaultSalePrice: 2  },
  { name: "Metformin 1000mg ER",        genericName: "Metformin HCl",              brandName: "Glycomet GP", manufacturer: "USV",          form: "Tablet",    strength: "1000mg",  pack: "10 tabs/strip",  category: "Antidiabetic",  schedule: "H",  hsnCode: "30049030", gstRate: 12, reorderLevel: 120, defaultSalePrice: 8  },
  { name: "Glimepiride 2mg",            genericName: "Glimepiride",                brandName: "Amaryl",      manufacturer: "Sanofi",       form: "Tablet",    strength: "2mg",     pack: "10 tabs/strip",  category: "Antidiabetic",  schedule: "H",  hsnCode: "30049030", gstRate: 12, reorderLevel: 80,  defaultSalePrice: 12 },
  { name: "Sitagliptin 100mg",          genericName: "Sitagliptin Phosphate",      brandName: "Januvia",     manufacturer: "MSD",          form: "Tablet",    strength: "100mg",   pack: "7 tabs/strip",   category: "Antidiabetic",  schedule: "H",  hsnCode: "30049030", gstRate: 12, reorderLevel: 40,  defaultSalePrice: 75 },
  { name: "Insulin Regular (Actrapid)", genericName: "Human Insulin Regular",      brandName: "Actrapid",    manufacturer: "Novo Nordisk", form: "Injection", strength: "40 IU/mL",pack: "10mL vial",      category: "Insulin",       schedule: "H",  hsnCode: "30043910", gstRate: 5,  reorderLevel: 20,  defaultSalePrice: 165, isHighAlert: true },
  { name: "Insulin Glargine (Lantus)",  genericName: "Insulin Glargine",           brandName: "Lantus",      manufacturer: "Sanofi",       form: "Injection", strength: "100 IU/mL",pack:"3mL cartridge",  category: "Insulin",       schedule: "H",  hsnCode: "30043910", gstRate: 5,  reorderLevel: 25,  defaultSalePrice: 920, isHighAlert: true },
  { name: "Insulin Lispro (Humalog)",   genericName: "Insulin Lispro",             brandName: "Humalog",     manufacturer: "Eli Lilly",    form: "Injection", strength: "100 IU/mL",pack: "3mL cartridge", category: "Insulin",       schedule: "H",  hsnCode: "30043910", gstRate: 5,  reorderLevel: 20,  defaultSalePrice: 720, isHighAlert: true },

  // ── Cardiac ───────────────────────────────────────────────
  { name: "Atorvastatin 10mg",          genericName: "Atorvastatin",               brandName: "Lipitor",     manufacturer: "Pfizer",       form: "Tablet",    strength: "10mg",    pack: "10 tabs/strip",  category: "Cardiac",       schedule: "H",  hsnCode: "30049029", gstRate: 12, reorderLevel: 100, defaultSalePrice: 7  },
  { name: "Rosuvastatin 10mg",          genericName: "Rosuvastatin",               brandName: "Rosuvas",     manufacturer: "Sun Pharma",   form: "Tablet",    strength: "10mg",    pack: "10 tabs/strip",  category: "Cardiac",       schedule: "H",  hsnCode: "30049029", gstRate: 12, reorderLevel: 80,  defaultSalePrice: 14 },
  { name: "Aspirin 75mg",               genericName: "Aspirin (low-dose)",         brandName: "Ecosprin",    manufacturer: "USV",          form: "Tablet",    strength: "75mg",    pack: "14 tabs/strip",  category: "Cardiac",       schedule: "OTC",hsnCode: "30049011", gstRate: 12, reorderLevel: 200, defaultSalePrice: 1  },
  { name: "Clopidogrel 75mg",           genericName: "Clopidogrel",                brandName: "Clopilet",    manufacturer: "Sun Pharma",   form: "Tablet",    strength: "75mg",    pack: "10 tabs/strip",  category: "Cardiac",       schedule: "H",  hsnCode: "30049029", gstRate: 12, reorderLevel: 80,  defaultSalePrice: 9  },
  { name: "Warfarin 5mg",               genericName: "Warfarin Sodium",            brandName: "Warf",        manufacturer: "Cipla",        form: "Tablet",    strength: "5mg",     pack: "30 tabs/strip",  category: "Cardiac",       schedule: "H",  hsnCode: "30049029", gstRate: 12, reorderLevel: 40,  defaultSalePrice: 6, isHighAlert: true },
  { name: "Nitroglycerin SL",           genericName: "Glyceryl Trinitrate",        brandName: "Sorbitrate",  manufacturer: "Abbott",       form: "Tablet",    strength: "0.5mg",   pack: "10 tabs/strip",  category: "Cardiac",       schedule: "H",  hsnCode: "30049029", gstRate: 12, reorderLevel: 40,  defaultSalePrice: 2.5},

  // ── Respiratory ───────────────────────────────────────────
  { name: "Salbutamol Inhaler",         genericName: "Salbutamol Sulphate",        brandName: "Asthalin",    manufacturer: "Cipla",        form: "Inhaler",   strength: "100mcg/dose",pack: "200 doses",   category: "Respiratory",   schedule: "H",  hsnCode: "30049062", gstRate: 12, reorderLevel: 30,  defaultSalePrice: 165 },
  { name: "Budesonide Inhaler",         genericName: "Budesonide",                 brandName: "Budecort",    manufacturer: "Cipla",        form: "Inhaler",   strength: "200mcg/dose",pack: "200 doses",   category: "Respiratory",   schedule: "H",  hsnCode: "30049062", gstRate: 12, reorderLevel: 25,  defaultSalePrice: 215 },
  { name: "Montelukast 10mg",           genericName: "Montelukast Sodium",         brandName: "Montair",     manufacturer: "Cipla",        form: "Tablet",    strength: "10mg",    pack: "10 tabs/strip",  category: "Respiratory",   schedule: "H",  hsnCode: "30049062", gstRate: 12, reorderLevel: 60,  defaultSalePrice: 14 },
  { name: "Cetirizine 10mg",            genericName: "Cetirizine HCl",             brandName: "Cetzine",     manufacturer: "Dr. Reddy's",  form: "Tablet",    strength: "10mg",    pack: "10 tabs/strip",  category: "Respiratory",   schedule: "OTC",hsnCode: "30049062", gstRate: 12, reorderLevel: 150, defaultSalePrice: 1.5 },

  // ── Neuro ─────────────────────────────────────────────────
  { name: "Phenytoin 100mg",            genericName: "Phenytoin Sodium",           brandName: "Eptoin",      manufacturer: "Abbott",       form: "Capsule",   strength: "100mg",   pack: "10 caps/strip",  category: "Neuro",         schedule: "H",  hsnCode: "30049039", gstRate: 12, reorderLevel: 60,  defaultSalePrice: 4  },
  { name: "Levetiracetam 500mg",        genericName: "Levetiracetam",              brandName: "Levipil",     manufacturer: "Sun Pharma",   form: "Tablet",    strength: "500mg",   pack: "10 tabs/strip",  category: "Neuro",         schedule: "H",  hsnCode: "30049039", gstRate: 12, reorderLevel: 50,  defaultSalePrice: 32 },
  { name: "Gabapentin 300mg",           genericName: "Gabapentin",                 brandName: "Gabantin",    manufacturer: "Sun Pharma",   form: "Capsule",   strength: "300mg",   pack: "10 caps/strip",  category: "Neuro",         schedule: "H",  hsnCode: "30049039", gstRate: 12, reorderLevel: 60,  defaultSalePrice: 14 },
  { name: "Diazepam 5mg",               genericName: "Diazepam",                   brandName: "Valium",      manufacturer: "Ranbaxy",      form: "Tablet",    strength: "5mg",     pack: "10 tabs/strip",  category: "Neuro",         schedule: "H1", hsnCode: "30049039", gstRate: 12, reorderLevel: 40,  defaultSalePrice: 5,  isHighAlert: true, isNarcotic: true },

  // ── Gastro ────────────────────────────────────────────────
  { name: "Pantoprazole 40mg",          genericName: "Pantoprazole",               brandName: "Pan-40",      manufacturer: "Alkem",        form: "Tablet",    strength: "40mg",    pack: "10 tabs/strip",  category: "Gastro",        schedule: "H",  hsnCode: "30049079", gstRate: 12, reorderLevel: 150, defaultSalePrice: 8.5},
  { name: "Omeprazole 20mg",            genericName: "Omeprazole",                 brandName: "Omez",        manufacturer: "Dr. Reddy's",  form: "Capsule",   strength: "20mg",    pack: "15 caps/strip",  category: "Gastro",        schedule: "H",  hsnCode: "30049079", gstRate: 12, reorderLevel: 130, defaultSalePrice: 4  },
  { name: "Ondansetron 4mg",            genericName: "Ondansetron",                brandName: "Emeset",      manufacturer: "Cipla",        form: "Tablet",    strength: "4mg",     pack: "10 tabs/strip",  category: "Gastro",        schedule: "H",  hsnCode: "30049079", gstRate: 12, reorderLevel: 80,  defaultSalePrice: 9  },
  { name: "Domperidone 10mg",           genericName: "Domperidone",                brandName: "Domstal",     manufacturer: "Torrent",      form: "Tablet",    strength: "10mg",    pack: "10 tabs/strip",  category: "Gastro",        schedule: "H",  hsnCode: "30049079", gstRate: 12, reorderLevel: 100, defaultSalePrice: 3.5},
  { name: "Loperamide 2mg",             genericName: "Loperamide HCl",             brandName: "Imodium",     manufacturer: "Janssen",      form: "Capsule",   strength: "2mg",     pack: "4 caps/strip",   category: "Gastro",        schedule: "OTC",hsnCode: "30049079", gstRate: 12, reorderLevel: 60,  defaultSalePrice: 4.5},

  // ── Steroid ───────────────────────────────────────────────
  { name: "Hydrocortisone 100mg Inj",   genericName: "Hydrocortisone Sodium Succinate", brandName:"Efcorlin",manufacturer: "Glaxo",        form: "Injection", strength: "100mg",   pack: "Vial",           category: "Steroid",       schedule: "H",  hsnCode: "30043290", gstRate: 12, reorderLevel: 30,  defaultSalePrice: 28 },
  { name: "Dexamethasone 4mg Inj",      genericName: "Dexamethasone Sodium Phosphate",  brandName:"Decdan",  manufacturer: "Wyeth",         form: "Injection", strength: "4mg/mL",  pack: "Ampoule",        category: "Steroid",       schedule: "H",  hsnCode: "30043290", gstRate: 12, reorderLevel: 40,  defaultSalePrice: 18 },
  { name: "Prednisolone 10mg",          genericName: "Prednisolone",               brandName: "Wysolone",    manufacturer: "Wyeth",        form: "Tablet",    strength: "10mg",    pack: "10 tabs/strip",  category: "Steroid",       schedule: "H",  hsnCode: "30043290", gstRate: 12, reorderLevel: 50,  defaultSalePrice: 5  },

  // ── Vitamins ──────────────────────────────────────────────
  { name: "Vitamin D3 60K IU",          genericName: "Cholecalciferol",            brandName: "Calcirol",    manufacturer: "Cadila",       form: "Powder",    strength: "60000 IU",pack: "1 sachet",       category: "Vitamin",       schedule: "OTC",hsnCode: "30045032", gstRate: 12, reorderLevel: 80,  defaultSalePrice: 38 },
  { name: "Folic Acid 5mg",             genericName: "Folic Acid",                 brandName: "Folvite",     manufacturer: "Wyeth",        form: "Tablet",    strength: "5mg",     pack: "30 tabs/strip",  category: "Vitamin",       schedule: "OTC",hsnCode: "30045090", gstRate: 12, reorderLevel: 150, defaultSalePrice: 0.8},
  { name: "Vitamin B12 1500mcg",        genericName: "Methylcobalamin",            brandName: "Nervz",       manufacturer: "Mankind",      form: "Tablet",    strength: "1500mcg", pack: "10 tabs/strip",  category: "Vitamin",       schedule: "OTC",hsnCode: "30045090", gstRate: 12, reorderLevel: 100, defaultSalePrice: 4  },
  { name: "Multivitamin",               genericName: "Multi-vitamin complex",      brandName: "Becosules",   manufacturer: "Pfizer",       form: "Capsule",   strength: "1 cap",   pack: "20 caps/strip",  category: "Vitamin",       schedule: "OTC",hsnCode: "30045090", gstRate: 12, reorderLevel: 200, defaultSalePrice: 3  },

  // ── IV Fluids ─────────────────────────────────────────────
  { name: "Normal Saline 0.9% 500mL",   genericName: "Sodium Chloride 0.9%",       brandName: "NS",          manufacturer: "Baxter",       form: "Injection", strength: "500mL",   pack: "Bottle",         category: "IV Fluid",      schedule: "H",  hsnCode: "30049099", gstRate: 12, reorderLevel: 60,  defaultSalePrice: 38 },
  { name: "Ringer's Lactate 500mL",     genericName: "Ringer Lactate",             brandName: "RL",          manufacturer: "Baxter",       form: "Injection", strength: "500mL",   pack: "Bottle",         category: "IV Fluid",      schedule: "H",  hsnCode: "30049099", gstRate: 12, reorderLevel: 60,  defaultSalePrice: 42 },
  { name: "Dextrose 5% 500mL",          genericName: "Dextrose 5% in Water",       brandName: "DNS",         manufacturer: "Baxter",       form: "Injection", strength: "500mL",   pack: "Bottle",         category: "IV Fluid",      schedule: "H",  hsnCode: "30049099", gstRate: 12, reorderLevel: 50,  defaultSalePrice: 45 },

  // ── Topical ───────────────────────────────────────────────
  { name: "Betadine Ointment",          genericName: "Povidone Iodine 5%",         brandName: "Betadine",    manufacturer: "Win-Medicare", form: "Ointment",  strength: "5%",      pack: "15g tube",       category: "Topical",       schedule: "OTC",hsnCode: "30049099", gstRate: 12, reorderLevel: 50,  defaultSalePrice: 55 },
  { name: "Diclofenac Gel",             genericName: "Diclofenac Diethylamine",    brandName: "Volini",      manufacturer: "Sun Pharma",   form: "Cream",     strength: "1.16%",   pack: "30g tube",       category: "Topical",       schedule: "OTC",hsnCode: "30049099", gstRate: 12, reorderLevel: 60,  defaultSalePrice: 95 },
  { name: "Silver Sulfadiazine Cream",  genericName: "Silver Sulfadiazine 1%",     brandName: "Silverex",    manufacturer: "Cipla",        form: "Cream",     strength: "1%",      pack: "20g tube",       category: "Topical",       schedule: "H",  hsnCode: "30049099", gstRate: 12, reorderLevel: 40,  defaultSalePrice: 78 },
];

/* ────────────────────────────────────────────────────────────────
   BATCH GENERATION — for each drug, create 1-3 batches
──────────────────────────────────────────────────────────────── */
function randInt(lo, hi) { return Math.floor(Math.random() * (hi - lo + 1)) + lo; }
function plusDays(n) { return new Date(Date.now() + n * 86400000); }
function minusDays(n){ return new Date(Date.now() - n * 86400000); }

function generateBatches(drug, supplierIds) {
  const out = [];
  const batchCount = randInt(1, 3);
  for (let i = 0; i < batchCount; i++) {
    const expiryDays = randInt(60, 720);                // 2 months – 2 years
    const mfgDays    = randInt(60, 365);                // up to 1 year old
    const qty        = randInt(Math.max(20, Math.round(drug.reorderLevel * 0.5)),
                               Math.max(40, Math.round(drug.reorderLevel * 2.5)));
    const purchase   = Math.max(0.5, drug.defaultSalePrice * 0.62);
    const mrp        = Math.round(drug.defaultSalePrice * 1.18 * 100) / 100;
    const supplier   = supplierIds[randInt(0, supplierIds.length - 1)];
    const ymd        = new Date().toISOString().slice(0,10).replace(/-/g, "");
    const batchNo    = `${drug.name.split(" ")[0].substring(0, 3).toUpperCase()}-${ymd}-${String(i + 1).padStart(2, "0")}${String(randInt(1, 99)).padStart(2, "0")}`;
    out.push({
      drugId: drug._id, drugName: drug.name,
      batchNo,
      expiryDate: plusDays(expiryDays),
      mfgDate:    minusDays(mfgDays),
      quantityIn: qty, remaining: qty,
      purchaseRate: Math.round(purchase * 100) / 100,
      mrp,
      salePrice: drug.defaultSalePrice,
      supplierId: supplier.id, supplierName: supplier.name,
      grnNumber: `GRN-${ymd}-${randInt(1000, 9999)}`,
      invoiceNo: `INV/${randInt(2024, 2026)}/${randInt(1000, 9999)}`,
      invoiceDate: minusDays(mfgDays - randInt(0, 7)),
      location: "Main Pharmacy",
      createdBy: "Seed script",
    });
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────
   MAIN
──────────────────────────────────────────────────────────────── */
(async () => {
  await connectDB();
  console.log("\n┌────────────────────────────────────────────");
  console.log("│  Pharmacy seed —", DRUGS.length, "drugs · 1-3 batches each");
  console.log("└────────────────────────────────────────────\n");

  if (RESEED) {
    console.log("  --reseed flag set: clearing existing pharmacy data…");
    await DrugBatch.deleteMany({});
    await Drug.deleteMany({});
    await Supplier.deleteMany({});
    console.log("  cleared.\n");
  }

  // 1. Suppliers
  const supplierIds = [];
  if (!BATCHES_ONLY) {
    for (const s of SUPPLIERS) {
      const existing = await Supplier.findOne({ name: s.name });
      if (existing) {
        supplierIds.push({ id: existing._id, name: existing.name });
        continue;
      }
      const created = await Supplier.create({ ...s, createdBy: "Seed script" });
      supplierIds.push({ id: created._id, name: created.name });
    }
    console.log(`  ✓ Suppliers: ${supplierIds.length}\n`);
  } else {
    const existing = await Supplier.find({ isActive: true }).lean();
    existing.forEach(s => supplierIds.push({ id: s._id, name: s.name }));
  }

  // 2. Drugs
  let drugCreated = 0, drugSkipped = 0;
  const allDrugs = [];
  for (const d of DRUGS) {
    if (BATCHES_ONLY) {
      const existing = await Drug.findOne({ name: d.name });
      if (existing) { allDrugs.push(existing); }
      continue;
    }
    const existing = await Drug.findOne({ name: d.name });
    if (existing) { drugSkipped++; allDrugs.push(existing); continue; }
    const created = await Drug.create({ ...d, createdBy: "Seed script" });
    drugCreated++;
    allDrugs.push(created);
  }
  if (!BATCHES_ONLY) {
    console.log(`  ✓ Drugs: ${drugCreated} created, ${drugSkipped} already present\n`);
  }

  // 3. Batches — generate 1-3 per drug
  let batchCreated = 0, batchSkipped = 0;
  for (const drug of allDrugs) {
    const have = await DrugBatch.countDocuments({ drugId: drug._id });
    if (have > 0 && !RESEED) { batchSkipped += have; continue; }
    const batches = generateBatches(drug, supplierIds);
    for (const b of batches) {
      try {
        await DrugBatch.create(b);
        batchCreated++;
      } catch (e) {
        if (e.code === 11000) batchSkipped++;
        else throw e;
      }
    }
  }
  console.log(`  ✓ Batches: ${batchCreated} new, ${batchSkipped} pre-existing\n`);

  // Summary stats
  const totals = {
    drugs:      await Drug.countDocuments({ isActive: true }),
    batches:    await DrugBatch.countDocuments({ isActive: true }),
    suppliers:  await Supplier.countDocuments({ isActive: true }),
    inStock:    await DrugBatch.countDocuments({ isActive: true, remaining: { $gt: 0 } }),
  };
  const valAgg = await DrugBatch.aggregate([
    { $match: { isActive: true, remaining: { $gt: 0 } } },
    { $group: { _id: null, total: { $sum: { $multiply: ["$remaining", "$salePrice"] } } } },
  ]);
  totals.stockValue = Math.round(valAgg[0]?.total || 0);

  console.log("  ──────────────────────────────────────────");
  console.log("  Live totals:");
  console.log("    Drugs in master:    ", totals.drugs);
  console.log("    Suppliers active:   ", totals.suppliers);
  console.log("    Batches active:     ", totals.batches);
  console.log("    Batches with stock: ", totals.inStock);
  console.log("    Stock value:         ₹" + totals.stockValue.toLocaleString("en-IN"));
  console.log("  ──────────────────────────────────────────\n");

  await mongoose.connection.close();
  process.exit(0);
})().catch(e => { console.error("Seed failed:", e); process.exit(1); });
