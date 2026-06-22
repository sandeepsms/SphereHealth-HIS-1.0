// Components/voice/medicalDictionary.js
// R7hr-271 (USER, 2026-06-22): medical-vocabulary correction layer for the
// global voice dictation (VoiceDictation.jsx).
//
// WHY a post-processing layer (and not a "real" engine dictionary): the browser
// Web Speech API uses the vendor's cloud recogniser and gives NO supported way
// to inject a custom lexicon (the old SpeechGrammarList is ignored by Chrome).
// So we correct the recogniser's OUTPUT instead — the standard, effective
// approach for medical dictation in the browser.
//
// Two safe mechanisms, applied to FINAL transcripts only:
//   1. PHRASE_FIXES  — curated regexes. Mostly "spoken as separate letters"
//      abbreviations (the engine writes "b p" / "s p o 2") + a few phonetic
//      drug mis-hearings. Spaced single letters basically never occur in normal
//      prose, so these are high-precision.
//   2. CASING_MAP    — re-cases whole-word occurrences of known medical terms
//      (drug names, multi-letter abbreviations). Only acts on tokens that are
//      themselves medical (Amoxicillin, SpO2, COPD…), so normal English is
//      untouched. Deliberately NOT capitalising ambiguous 2-letter tokens
//      (od/er/im/mi/pe…) — those are handled spaced-only in PHRASE_FIXES.
//
// To extend: add a generic drug to DRUGS, a safe 3+ letter abbreviation to
// ABBREVIATIONS, or a tricky mis-hearing to PHRASE_FIXES.

/* ── 1. Generic drug names (single token; re-cased when recognised) ───────── */
const DRUGS = [
  // Analgesics / antipyretics / NSAIDs
  "Paracetamol", "Acetaminophen", "Ibuprofen", "Diclofenac", "Aceclofenac",
  "Naproxen", "Ketorolac", "Etoricoxib", "Nimesulide", "Tramadol", "Morphine",
  "Fentanyl", "Pethidine", "Tapentadol", "Buprenorphine",
  // Antibiotics / antimicrobials
  "Amoxicillin", "Ampicillin", "Amoxiclav", "Augmentin", "Cloxacillin",
  "Piperacillin", "Tazobactam", "Azithromycin", "Clarithromycin", "Erythromycin",
  "Roxithromycin", "Cefixime", "Cefuroxime", "Ceftriaxone", "Cefpodoxime",
  "Cefoperazone", "Cefepime", "Cephalexin", "Cefadroxil", "Ciprofloxacin",
  "Levofloxacin", "Ofloxacin", "Norfloxacin", "Moxifloxacin", "Doxycycline",
  "Minocycline", "Metronidazole", "Tinidazole", "Ornidazole", "Gentamicin",
  "Amikacin", "Tobramycin", "Vancomycin", "Teicoplanin", "Linezolid",
  "Meropenem", "Imipenem", "Ertapenem", "Colistin", "Clindamycin",
  "Cotrimoxazole", "Nitrofurantoin", "Fosfomycin", "Rifampicin", "Isoniazid",
  "Ethambutol", "Pyrazinamide", "Fluconazole", "Itraconazole", "Voriconazole",
  "Amphotericin", "Caspofungin", "Acyclovir", "Valacyclovir", "Oseltamivir",
  // GI
  "Pantoprazole", "Omeprazole", "Esomeprazole", "Rabeprazole", "Lansoprazole",
  "Ranitidine", "Famotidine", "Domperidone", "Ondansetron", "Granisetron",
  "Metoclopramide", "Sucralfate", "Lactulose", "Loperamide", "Mesalamine",
  "Rifaximin", "Itopride", "Dicyclomine", "Drotaverine",
  // Endocrine / diabetes
  "Metformin", "Glimepiride", "Gliclazide", "Glibenclamide", "Glipizide",
  "Sitagliptin", "Vildagliptin", "Teneligliptin", "Linagliptin", "Pioglitazone",
  "Dapagliflozin", "Empagliflozin", "Insulin", "Levothyroxine", "Thyroxine",
  "Carbimazole", "Methimazole", "Liraglutide",
  // Cardiovascular
  "Amlodipine", "Nifedipine", "Cilnidipine", "Telmisartan", "Losartan",
  "Olmesartan", "Valsartan", "Ramipril", "Enalapril", "Lisinopril", "Perindopril",
  "Atenolol", "Metoprolol", "Bisoprolol", "Carvedilol", "Nebivolol",
  "Hydrochlorothiazide", "Chlorthalidone", "Indapamide", "Furosemide",
  "Torsemide", "Spironolactone", "Clonidine", "Prazosin", "Nitroglycerin",
  "Isosorbide", "Digoxin", "Amiodarone", "Ivabradine", "Ranolazine",
  // Lipids / antiplatelet / anticoagulant
  "Atorvastatin", "Rosuvastatin", "Simvastatin", "Fenofibrate", "Ezetimibe",
  "Clopidogrel", "Ticagrelor", "Prasugrel", "Aspirin", "Heparin", "Enoxaparin",
  "Dalteparin", "Fondaparinux", "Warfarin", "Acenocoumarol", "Dabigatran",
  "Rivaroxaban", "Apixaban",
  // Respiratory
  "Salbutamol", "Levosalbutamol", "Ipratropium", "Tiotropium", "Budesonide",
  "Formoterol", "Salmeterol", "Montelukast", "Theophylline", "Doxofylline",
  "Acebrophylline", "Ambroxol", "Bromhexine", "Acetylcysteine",
  // Steroids
  "Prednisolone", "Dexamethasone", "Hydrocortisone", "Methylprednisolone",
  "Betamethasone", "Deflazacort", "Fluticasone", "Mometasone",
  // Antihistamines / allergy
  "Cetirizine", "Levocetirizine", "Fexofenadine", "Loratadine", "Desloratadine",
  "Chlorpheniramine", "Pheniramine", "Hydroxyzine", "Promethazine",
  "Diphenhydramine", "Montelukast",
  // Neuro / psych
  "Phenytoin", "Levetiracetam", "Valproate", "Carbamazepine", "Oxcarbazepine",
  "Lamotrigine", "Lacosamide", "Clobazam", "Gabapentin", "Pregabalin",
  "Lorazepam", "Diazepam", "Clonazepam", "Alprazolam", "Midazolam", "Etizolam",
  "Sertraline", "Escitalopram", "Fluoxetine", "Paroxetine", "Amitriptyline",
  "Nortriptyline", "Duloxetine", "Venlafaxine", "Mirtazapine", "Quetiapine",
  "Olanzapine", "Risperidone", "Aripiprazole", "Haloperidol", "Lithium",
  "Levodopa", "Carbidopa", "Donepezil",
  // Emergency / critical care / anaesthesia
  "Adrenaline", "Epinephrine", "Noradrenaline", "Norepinephrine", "Dopamine",
  "Dobutamine", "Vasopressin", "Atropine", "Naloxone", "Mannitol", "Labetalol",
  "Lignocaine", "Lidocaine", "Bupivacaine", "Ropivacaine", "Propofol",
  "Ketamine", "Thiopentone", "Etomidate", "Suxamethonium", "Succinylcholine",
  "Vecuronium", "Rocuronium", "Atracurium", "Cisatracurium", "Neostigmine",
  "Glycopyrrolate", "Sugammadex", "Nitroprusside", "Streptokinase", "Tenecteplase",
  "Alteplase", "Tranexamic", "Etamsylate",
  // Supplements / misc
  "Cyanocobalamin", "Pyridoxine", "Thiamine", "Cholecalciferol", "Calcitriol",
  "Methylcobalamin", "Folic", "Ferrous", "Calcium",
];

/* ── 2. Multi-letter abbreviations (3+ chars, unambiguous when joined) ────── */
const ABBREVIATIONS = [
  "SpO2", "HbA1c", "GCS", "RBS", "FBS", "PPBS", "ECG", "EKG", "CBC", "LFT",
  "RFT", "KFT", "ABG", "INR", "CRP", "ESR", "TSH", "USG", "MRI", "NBM", "NPO",
  "PRN", "SOS", "STAT", "TDS", "QID", "OPD", "IPD", "ICU", "NICU", "PICU",
  "CCU", "COPD", "CAD", "CKD", "AKI", "DVT", "UTI", "URTI", "LRTI", "ARDS",
  "CHF", "TIA", "CVA", "PUO", "IHD", "RTI", "DKA", "AKI", "BPH", "GERD",
  "CO2", "B12", "T3", "T4", "O2", "D3", "K2", "WBC", "RBC", "PCV", "MCV",
  "PT", "APTT", "LDH", "CPK", "BNP", "PSA", "CEA", "HIV", "HBsAg", "TB",
  "IVF", "RTPCR", "CSF",
];

/* Build the case-insensitive → canonical map for the token re-caser. */
const CASING_MAP = new Map();
[...DRUGS, ...ABBREVIATIONS].forEach((t) => CASING_MAP.set(t.toLowerCase(), t));

/* ── 3. Curated phonetic / spaced-letter fixes (ordered, run first) ───────── */
const PHRASE_FIXES = [
  // Vitals & oxygen (spaced or phonetic)
  [/\b(s\s*p\s*o\s*2|s\s*p\s*o\s*two|sp02|spo\s*two)\b/gi, "SpO2"],
  [/\bh\s*b\s*a\s*1\s*c\b/gi, "HbA1c"],
  [/\bb\s+p\b/gi, "BP"],
  [/\bh\s+r\b/gi, "HR"],
  [/\br\s+r\b/gi, "RR"],
  [/\bg\s*c\s*s\b/gi, "GCS"],
  // Routes & frequencies (spaced letters)
  [/\bi\s+v\b/gi, "IV"],
  [/\bi\s+m\b/gi, "IM"],
  [/\bs\s+c\b/gi, "SC"],
  [/\bp\s+o\b/gi, "PO"],
  [/\bs\s+l\b/gi, "SL"],
  [/\bb\s+d\b/gi, "BD"],
  [/\bt\s*d\s*s\b/gi, "TDS"],
  [/\bq\s*i\s*d\b/gi, "QID"],
  [/\bo\s+d\b/gi, "OD"],
  [/\bh\s+s\b/gi, "HS"],
  [/\bp\s*r\s*n\b/gi, "PRN"],
  [/\bs\s*o\s*s\b/gi, "SOS"],
  [/\bn\s*b\s*m\b/gi, "NBM"],
  [/\bn\s*p\s*o\b/gi, "NPO"],
  [/\bs\s*t\s*a\s*t\b/gi, "STAT"],
  // Investigations (spaced letters)
  [/\be\s*c\s*g\b/gi, "ECG"],
  [/\be\s*k\s*g\b/gi, "EKG"],
  [/\bc\s*b\s*c\b/gi, "CBC"],
  [/\bl\s*f\s*t\b/gi, "LFT"],
  [/\b(r\s*f\s*t|k\s*f\s*t)\b/gi, "RFT"],
  [/\ba\s*b\s*g\b/gi, "ABG"],
  [/\bi\s*n\s*r\b/gi, "INR"],
  [/\bc\s*r\s*p\b/gi, "CRP"],
  [/\be\s*s\s*r\b/gi, "ESR"],
  [/\bt\s*s\s*h\b/gi, "TSH"],
  [/\bu\s*s\s*g\b/gi, "USG"],
  [/\bm\s*r\s*i\b/gi, "MRI"],
  [/\bc\s*t\s+scan\b/gi, "CT scan"],
  [/\bx\s*-?\s*ray\b/gi, "X-ray"],
  [/\btwo\s*d\s*echo\b/gi, "2D Echo"],
  // Units
  [/\bm\s*c\s*g\b/gi, "mcg"],
  [/\bmicrograms?\b/gi, "mcg"],
  [/\bi\s+u\b/gi, "IU"],
  // Common phonetic drug mis-hearings the engine makes
  [/\bpara\s*set\s*a?\s*(mol|moll|mall|mole)\b/gi, "Paracetamol"],
  [/\ba\s*mox\s*i?\s*cill?in\b/gi, "Amoxicillin"],
  [/\baz\s*i?\s*thro\s*my\s*cin\b/gi, "Azithromycin"],
  [/\bpan\s*to\s*pra\s*zol\b/gi, "Pantoprazole"],
  [/\bon\s*dan\s*se\s*tron\b/gi, "Ondansetron"],
  [/\bsef\s*tri\s*ax\s*one\b/gi, "Ceftriaxone"],
  [/\bmet\s*for\s*min\b/gi, "Metformin"],
  [/\bam\s*lo\s*di\s*pine\b/gi, "Amlodipine"],
];

/**
 * Apply medical-vocabulary corrections to a recognised (final) transcript.
 * Safe to call on any text; only touches known medical patterns/terms.
 */
export function applyMedicalCorrections(text) {
  if (!text || typeof text !== "string") return text;
  let out = text;
  // 1) curated phonetic + spaced-letter abbreviation fixes
  for (const [re, rep] of PHRASE_FIXES) out = out.replace(re, rep);
  // 2) re-case whole-word occurrences of known medical terms
  out = out.replace(/[A-Za-z][A-Za-z0-9]*/g, (w) => {
    const canon = CASING_MAP.get(w.toLowerCase());
    return canon || w;
  });
  return out;
}

export default applyMedicalCorrections;
