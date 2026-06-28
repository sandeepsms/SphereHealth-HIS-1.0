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

/* ── 1. Generic drugs + common Indian brand names (R7hr-275: expanded to 959
   via a 6-agent lexicon compile; single token re-cased when recognised). ── */
const DRUGS = [
  "Abciximab", "Acarbose", "Acebrophylline", "Acebutolol", "Aceclofenac", "Acenocoumarol", "Acetaminophen", "Acetazolamide",
  "Acetylcysteine", "Aciclovir", "Aciloc", "Aclidinium", "Acrivastine", "Acyclovir", "Adalimumab", "Adapalene",
  "Adenosine", "Adrenaline", "Agomelatine", "Albendazole", "Albuterol", "Alfuzosin", "Alirocumab", "Allegra",
  "Alogliptin", "Alprazolam", "Alteplase", "Alverine", "Amantadine", "Amaryl", "Ambroxol", "Amikacin",
  "Amiloride", "Aminophylline", "Amiodarone", "Amisulpride", "Amitriptyline", "Amlodipine", "Amlong", "Amoxicillin",
  "Amphotericin", "Ampicillin", "Ampoxin", "Anastrozole", "Anidulafungin", "Apixaban", "Apomorphine", "Aprepitant",
  "Argatroban", "Aripiprazole", "Artemether", "Artesunate", "Articaine", "Ascorbic Acid", "Ascoril", "Asenapine",
  "Asparaginase", "Aspart", "Aspirin", "Asthalin", "Atenolol", "Atorvastatin", "Atovaquone", "Atracurium",
  "Atropine", "Augmentin", "Autrin", "Avil", "Azathioprine", "Azee", "Azelastine", "Azilsartan",
  "Azithromycin", "Aztreonam", "Bacitracin", "Balsalazide", "Bambuterol", "Barium Sulphate", "Beclomethasone", "Becosules",
  "Bedaquiline", "Bempedoic", "Benazepril", "Benidipine", "Benserazide", "Benzathine Penicillin", "Benzocaine", "Benzonatate",
  "Benztropine", "Benzylpenicillin", "Betamethasone", "Betaxolol", "Bevacizumab", "Bezafibrate", "Bicalutamide", "Bilastine",
  "Bimatoprost", "Biotin", "Biperiden", "Bisacodyl", "Bismuth Subsalicylate", "Bisoprolol", "Bivalirudin", "Bleomycin",
  "Bortezomib", "Brexpiprazole", "Brimonidine", "Brinzolamide", "Brivaracetam", "Bromazepam", "Bromfenac", "Bromhexine",
  "Bromocriptine", "Brufen", "Budecort", "Budesonide", "Bumetanide", "Bupivacaine", "Buprenorphine", "Bupropion",
  "Buscopan", "Buspirone", "Butamirate", "Butorphanol", "Cabergoline", "Calcipotriol", "Calcium Carbonate", "Calcium Citrate",
  "Calpol", "Canagliflozin", "Candesartan", "Capecitabine", "Capreomycin", "Captopril", "Carbamazepine", "Carbenicillin",
  "Carbidopa", "Carbimazole", "Carbocisteine", "Carbonyl Iron", "Carboplatin", "Carboprost", "Cardace", "Cariprazine",
  "Carvedilol", "Caspofungin", "Castor Oil", "Cefaclor", "Cefadroxil", "Cefalexin", "Cefazolin", "Cefdinir",
  "Cefditoren", "Cefepime", "Cefixime", "Cefoperazone", "Cefotaxime", "Cefpodoxime", "Cefprozil", "Cefspan",
  "Ceftaroline", "Ceftazidime", "Ceftibuten", "Ceftolozane", "Ceftriaxone", "Cefuroxime", "Celecoxib", "Celiprolol",
  "Cenobamate", "Cephalexin", "Cervical Cancer Vaccine", "Cetil", "Cetirizine", "Cetuximab", "Cetzine", "Cheston",
  "Chloramphenicol", "Chlordiazepoxide", "Chloroprocaine", "Chloroquine", "Chlorpheniramine", "Chlorpromazine", "Chlorpropamide", "Chlorthalidone",
  "Cholecalciferol", "Cholestyramine", "Chymoral", "Ciclesonide", "Cilastatin", "Cilnidipine", "Cilostazol", "Cimetidine",
  "Cinchocaine", "Cinnarizine", "Ciplox", "Ciprofloxacin", "Cisatracurium", "Cisplatin", "Citalopram", "Clarithromycin",
  "Clavam", "Clavulanate", "Clevidipine", "Clindamycin", "Clobazam", "Clofazimine", "Clomiphene", "Clomipramine",
  "Clonazepam", "Clonidine", "Clopidogrel", "Clopilet", "Clorazepate", "Clotrimazole", "Cloxacillin", "Clozapine",
  "Codeine", "Colesevelam", "Colistin", "Combiflam", "Concor", "Cotrimoxazole", "Crocin", "Cyanocobalamin",
  "Cyclizine", "Cyclopam", "Cyclopentolate", "Cyclophosphamide", "Cycloserine", "Cyproheptadine", "Cytarabine", "Dabigatran",
  "Dacarbazine", "Daclatasvir", "Dalbavancin", "Dalteparin", "Dapagliflozin", "Dapsone", "Daptomycin", "Defcort",
  "Deflazacort", "Degludec", "Delamanid", "Demeclocycline", "Deriphyllin", "Desflurane", "Desloratadine", "Desogestrel",
  "Desvenlafaxine", "Detemir", "Dexamethasone", "Dexketoprofen", "Dexlansoprazole", "Dexorange", "Dexrabeprazole", "Dextromethorphan",
  "Dextrose", "Diazepam", "Dibucaine", "Diclofenac", "Dicloxacillin", "Dicyclomine", "Dicycloverine", "Diethylcarbamazine",
  "Dihydrocodeine", "Diltiazem", "Dimenhydrinate", "Diphenhydramine", "Diphenoxylate", "Dipyridamole", "Disopyramide", "Disprin",
  "Divalproex", "Dobutamine", "Docetaxel", "Docusate", "Dofetilide", "Dolasetron", "Dolo", "Dolutegravir",
  "Domperidone", "Donepezil", "Dopamine", "Doripenem", "Dornase Alfa", "Dorzolamide", "Doxacurium", "Doxazosin",
  "Doxepin", "Doxofylline", "Doxorubicin", "Doxycycline", "Doxylamine", "Dronedarone", "Drospirenone", "Drotaverine",
  "Drotin", "Dulaglutide", "Duloxetine", "Dutasteride", "Dydrogesterone", "Ebastine", "Ecosprin", "Edoxaban",
  "Edrophonium", "Efavirenz", "Empagliflozin", "Enalapril", "Enflurane", "Enoxaparin", "Entacapone", "Entecavir",
  "Enzoflam", "Ephedrine", "Epinephrine", "Eplerenone", "Eprosartan", "Eptifibatide", "Eravacycline", "Erdosteine",
  "Ergocalciferol", "Erlotinib", "Ertapenem", "Ertugliflozin", "Erythromycin", "Escitalopram", "Esketamine", "Eslicarbazepine",
  "Esmolol", "Esomeprazole", "Estazolam", "Estradiol", "Estriol", "Eszopiclone", "Ethambutol", "Ethinylestradiol",
  "Ethionamide", "Ethosuximide", "Etizolam", "Etodolac", "Etomidate", "Etophylline", "Etoposide", "Etoricoxib",
  "Etoshine", "Evolocumab", "Exemestane", "Exenatide", "Ezetimibe", "Famotidine", "Faropenem", "Favipiravir",
  "Fefol", "Felbamate", "Felodipine", "Fenofibrate", "Fentanyl", "Ferrous Ascorbate", "Ferrous Sulphate", "Fexofenadine",
  "Fimasartan", "Finasteride", "Flecainide", "Flexon", "Flucloxacillin", "Fluconazole", "Fludrocortisone", "Flumazenil",
  "Flunisolide", "Fluorouracil", "Fluoxetine", "Flupenthixol", "Fluphenazine", "Flurazepam", "Flurbiprofen", "Flutamide",
  "Fluticasone", "Fluvastatin", "Fluvoxamine", "Folic Acid", "Fondaparinux", "Foracort", "Formoterol", "Fosaprepitant",
  "Fosfomycin", "Fosinopril", "Fosphenytoin", "Furosemide", "Fusidic Acid", "Gabapentin", "Gabapin", "Gadobenate",
  "Gadolinium", "Gadoteridol", "Galantamine", "Galvus", "Ganciclovir", "Gantacurium", "Gatifloxacin", "Gefitinib",
  "Gemcitabine", "Gemfibrozil", "Gentamicin", "Glargine", "Glibenclamide", "Gliclazide", "Glimepiride", "Glipizide",
  "Glulisine", "Glyburide", "Glycerin", "Glycomet", "Glycopyrrolate", "Glycopyrronium", "Goserelin", "Granisetron",
  "Grilinctus", "Griseofulvin", "Guaifenesin", "Gudcef", "Haloperidol", "Halothane", "Hartmann", "Heparin",
  "Hepatitis B Vaccine", "Hetastarch", "Hifenac", "Hydralazine", "Hydrochlorothiazide", "Hydrocortisone", "Hydromorphone", "Hydroquinone",
  "Hydroxychloroquine", "Hydroxyurea", "Hydroxyzine", "Hyoscine", "Hyoscyamine", "Ibuprofen", "Ibutilide", "Ifosfamide",
  "Ilaprazole", "Iloperidone", "Imatinib", "Imidapril", "Imipenem", "Imipramine", "Indacaterol", "Indapamide",
  "Indomethacin", "Infliximab", "Influenza Vaccine", "Insulin", "Iodixanol", "Iohexol", "Iopamidol", "Ioversol",
  "Ipratropium", "Irbesartan", "Irinotecan", "Isavuconazole", "Isocarboxazid", "Isoflurane", "Isoniazid", "Isophane",
  "Isoprenaline", "Isoproterenol", "Isosorbide", "Isotretinoin", "Ispaghula", "Isradipine", "Istamet", "Itopride",
  "Itraconazole", "Ivabradine", "Ivermectin", "Janumet", "Kanamycin", "Ketamine", "Ketoconazole", "Ketoprofen",
  "Ketorolac", "Ketotifen", "Labetalol", "Lacidipine", "Lacosamide", "Lactitol", "Lactulose", "Lamivudine",
  "Lamotrigine", "Lansoprazole", "Lariago", "Latanoprost", "Ledipasvir", "Lenalidomide", "Lercanidipine", "Letrozole",
  "Leuprolide", "Levalbuterol", "Levamisole", "Levetiracetam", "Levobupivacaine", "Levocetirizine", "Levodopa", "Levodropropizine",
  "Levoflox", "Levofloxacin", "Levolin", "Levonorgestrel", "Levosalbutamol", "Levosimendan", "Levosulpiride", "Levothyroxine",
  "Lidocaine", "Lignocaine", "Limcee", "Linaclotide", "Linagliptin", "Lincomycin", "Linezolid", "Liofen",
  "Liothyronine", "Liquid Paraffin", "Liraglutide", "Lisinopril", "Lispro", "Lithium", "Livogen", "Lixisenatide",
  "Loperamide", "Loratadine", "Lorazepam", "Lornoxicam", "Losartan", "Lovastatin", "Loxapine", "Lubiprostone",
  "Lumefantrine", "Lurasidone", "Macrogol", "Magnesium Hydroxide", "Magnesium Sulphate", "Magnex", "Mahacef", "Mannitol",
  "Maprotiline", "Mebendazole", "Mebeverine", "Meclizine", "Mecobalamin", "Medroxyprogesterone", "Mefenamic Acid", "Mefloquine",
  "Meftal", "Megapen", "Meloxicam", "Memantine", "Meningococcal Vaccine", "Meperidine", "Mephentermine", "Mepivacaine",
  "Mercaptopurine", "Meropenem", "Mesalamine", "Mesalazine", "Metaraminol", "Metformin", "Methadone", "Methimazole",
  "Methohexital", "Methotrexate", "Methylcobalamin", "Methyldopa", "Methylergometrine", "Methylprednisolone", "Metoclopramide", "Metolazone",
  "Metoprolol", "Metrogyl", "Metronidazole", "Mexiletine", "Micafungin", "Miconazole", "Midazolam", "Mifepristone",
  "Miglitol", "Milnacipran", "Milrinone", "Minocycline", "Minoxidil", "Mirabegron", "Mirtazapine", "Misoprostol",
  "Mitomycin", "Mivacurium", "Mizolastine", "Moclobemide", "Mometasone", "Monocef", "Montair", "Montelukast",
  "Moov", "Morphine", "Mosapride", "Moxifloxacin", "Moxikind", "Moxonidine", "Mupirocin", "Nabumetone",
  "Nadifloxacin", "Nalbuphine", "Naloxegol", "Naloxone", "Naltrexone", "Naphazoline", "Naproxen", "Nateglinide",
  "Nebivolol", "Neomycin", "Neostigmine", "Nepafenac", "Nervijen", "Netilmicin", "Netupitant", "Neurobion",
  "Nevirapine", "Nexpro", "Niacinamide", "Nicardipine", "Niclosamide", "Nicorandil", "Nifedipine", "Nimesulide",
  "Nimodipine", "Nise", "Nitazoxanide", "Nitrazepam", "Nitrendipine", "Nitrofurantoin", "Nitroglycerine", "Nitrous",
  "Nivolumab", "Nizatidine", "Noradrenaline", "Norepinephrine", "Norethisterone", "Norflox", "Norfloxacin", "Normal Saline",
  "Nortriptyline", "Noscapine", "Nystatin", "Octreotide", "Ofloxacin", "Okacet", "Olanzapine", "Olmesartan",
  "Olodaterol", "Olopatadine", "Olsalazine", "Omeprazole", "Omnacortil", "Ondansetron", "Opicapone", "Ornidazole",
  "Orofer", "Oseltamivir", "Otilonium", "Oxaliplatin", "Oxazepam", "Oxcarbazepine", "Oxybutynin", "Oxycodone",
  "Oxymetazoline", "Oxytocin", "Paclitaxel", "Paliperidone", "Palonosetron", "Pan-D", "Pancuronium", "Pantocid",
  "Pantop", "Pantoprazole", "Paracetamol", "Parecoxib", "Paroxetine", "Pembrolizumab", "Penfluridol", "Penicillin",
  "Pentavalent Vaccine", "Pentazocine", "Perampanel", "Perindopril", "Permethrin", "Perphenazine", "Pethidine", "Phenazopyridine",
  "Phenelzine", "Pheniramine", "Phenobarbital", "Phenobarbitone", "Phenylephrine", "Phenytoin", "Pholcodine", "Phytomenadione",
  "Pilocarpine", "Pimecrolimus", "Pimozide", "Pinaverium", "Pindolol", "Pioglitazone", "Pipecuronium", "Piperacillin",
  "Piroxicam", "Pitavastatin", "Plazomicin", "Plecanatide", "Pneumococcal Vaccine", "Polyethylene Glycol", "Polymyxin", "Posaconazole",
  "Pramipexole", "Prasugrel", "Pravastatin", "Praziquantel", "Prazosin", "Prednisolone", "Prednisone", "Pregabalin",
  "Prilocaine", "Primaquine", "Primidone", "Procainamide", "Procaine", "Procaine Penicillin", "Prochlorperazine", "Procyclidine",
  "Progesterone", "Proguanil", "Promethazine", "Propafenone", "Propofol", "Propranolol", "Propylthiouracil", "Prucalopride",
  "Prulifloxacin", "Pseudoephedrine", "Psyllium", "Pyrantel", "Pyrazinamide", "Pyridostigmine", "Pyridoxine", "Pyrimethamine",
  "Quetiapine", "Quinapril", "Quinidine", "Quinine", "Rabeprazole", "Rabies Vaccine", "Racecadotril", "Raloxifene",
  "Ramipril", "Ramosetron", "Ranitidine", "Ranolazine", "Rantac", "Rasagiline", "Razo", "Reboxetine",
  "Remdesivir", "Repaglinide", "Reteplase", "Revital", "Ribavirin", "Riboflavin", "Rifampicin", "Rifampin",
  "Rifaximin", "Ringer Lactate", "Risperidone", "Rituximab", "Rivaroxaban", "Rivastigmine", "Rocuronium", "Roflumilast",
  "Ropinirole", "Ropivacaine", "Roscilox", "Rosiglitazone", "Rosuvastatin", "Rotavirus Vaccine", "Rotigotine", "Roxatidine",
  "Roxithromycin", "Rufinamide", "Rupatadine", "Safinamide", "Salbutamol", "Salmeterol", "Saridon", "Saxagliptin",
  "Secnidazole", "Selegiline", "Semaglutide", "Senna", "Sennosides", "Septran", "Sertraline", "Sevoflurane",
  "Shelcal", "Sildenafil", "Silodosin", "Simvastatin", "Sinarest", "Sitagliptin", "Sofosbuvir", "Solifenacin",
  "Sotalol", "Sparfloxacin", "Spasmonil", "Spiramycin", "Spironolactone", "Stamlo", "Sterculia", "Streptokinase",
  "Streptomycin", "Succinylcholine", "Sucralfate", "Sugammadex", "Sulbactam", "Sulfadiazine", "Sulfamethoxazole", "Sulfasalazine",
  "Sulpiride", "Supradyn", "Suxamethonium", "Tacrine", "Tacrolimus", "Tadalafil", "Tamoxifen", "Tamsulosin",
  "Tapentadol", "Taxim", "Tazarotene", "Tazobactam", "Tedizolid", "Tegaserod", "Teicoplanin", "Telavancin",
  "Telithromycin", "Telma", "Telmisartan", "Temazepam", "Temozolomide", "Tenecteplase", "Teneligliptin", "Tenofovir",
  "Tenoxicam", "Terazosin", "Terbinafine", "Terbutaline", "Terlipressin", "Testosterone", "Tetanus Toxoid", "Tetracaine",
  "Tetracycline", "Theophylline", "Thiamine", "Thiopental", "Thiopentone", "Thioridazine", "Tiagabine", "Tianeptine",
  "Tibolone", "Ticagrelor", "Ticarcillin", "Ticlopidine", "Tigecycline", "Timolol", "Tinidazole", "Tiotropium",
  "Tirofiban", "Tobramycin", "Tocopherol", "Tofacitinib", "Tolbutamide", "Tolcapone", "Tolterodine", "Topiramate",
  "Topotecan", "Torsemide", "Tramadol", "Trandolapril", "Tranexamic", "Tranylcypromine", "Trastuzumab", "Travoprost",
  "Trazodone", "Tretinoin", "Triamcinolone", "Triamterene", "Triazolam", "Trifluoperazine", "Trihexyphenidyl", "Trimebutine",
  "Trimetazidine", "Trimethobenzamide", "Trimethoprim", "Triprolidine", "Tropicamide", "Tropisetron", "Typhoid Vaccine", "Ultracet",
  "Umeclidinium", "Urokinase", "Ustekinumab", "Valacyclovir", "Valdecoxib", "Valganciclovir", "Valproate", "Valsartan",
  "Vancomycin", "Varicella Vaccine", "Vasopressin", "Vecuronium", "Vedolizumab", "Velpatasvir", "Venlafaxine", "Verapamil",
  "Vicks", "Vigabatrin", "Vilanterol", "Vilazodone", "Vildagliptin", "Vinblastine", "Vincristine", "Voglibose",
  "Volini", "Voriconazole", "Vortioxetine", "Voveran", "Warfarin", "Wysolone", "Xylometazoline", "Zafirlukast",
  "Zaleplon", "Zanamivir", "Zerodol", "Zidovudine", "Zifi", "Zileuton", "Zinc Sulphate", "Zincovit",
  "Ziprasidone", "Zofenopril", "Zolpidem", "Zonisamide", "Zopiclone", "Zoxan", "Zuclopenthixol",
];

/* ── 2. Medical abbreviations (R7hr-275: 261; unambiguous — everyday-English
   collisions like ALL/AS/IS/OR/CA/MR were filtered out, handled spaced-only below). ── */
const ABBREVIATIONS = [
  "ABG", "ACS", "ACTH", "ADL", "AFB", "AFP", "AKI", "ALP",
  "ALS", "ANA", "APTT", "ARDS", "ARF", "ART", "ASD", "ASO",
  "ASOM", "ATN", "AVF", "AVN", "BCG", "BMI", "BNP", "BPD",
  "BPH", "BPPV", "Braden", "BUN", "CABG", "CAD", "CAP", "CAPD",
  "CAUTI", "CBC", "CCF", "CCU", "CD4", "CEA", "CHF", "CKD",
  "CKMB", "CLABSI", "CMV", "CONS", "COPD", "CPK", "CPR", "CRF",
  "CRP", "CSF", "CSOM", "CTEV", "CVA", "CVP", "D-dimer", "DDH",
  "DEXA", "DKA", "DLC", "DMARD", "DNR", "DNS", "DOTS", "DPT",
  "DRE", "DUB", "DVT", "EBV", "ECG", "ECHO", "ECMO", "EDH",
  "EEG", "EGD", "EKG", "ELISA", "EMG", "ENT", "ERCP", "ESBL",
  "ESR", "ESRD", "EUS", "FBS", "FESS", "FEV1", "FiO2", "FNAC",
  "FSH", "FTND", "FVC", "GA", "GBS", "GCS", "GERD", "GFR",
  "GGT", "GTCS", "HAI", "HAP", "HbA1c", "HbsAg", "HBV", "HCG",
  "HCO3", "HCT", "HCV", "HDL", "HDU", "HepB", "Hib", "HIV",
  "HMD", "HPE", "HPLC", "HPV", "HRCT", "HSV", "HTN", "IABP",
  "ICH", "ICU", "IHD", "ILD", "INR", "IOPA", "IPD", "IUGR",
  "IVP", "JE", "K-wire", "KFT", "LBBB", "LDH", "LDL", "LFT",
  "LOC", "LRTI", "LSCS", "LVH", "MCH", "MCHC", "MCV", "MDR",
  "MLC", "MMR", "MND", "Morse", "MRCP", "MRI", "MRM", "MRSA",
  "MTP", "NACO", "NBM", "NCV", "NEC", "NICU", "NPO", "NS",
  "NSAID", "NSAIDS", "NSTEMI", "OGD", "OPD", "OPG", "OPV", "OREF",
  "ORIF", "ORS", "OSA", "PaCO2", "PaO2", "PCI", "PCOS", "PCR",
  "PCV", "PDA", "PEFR", "PEP", "PET", "PETCT", "PFT", "PICU",
  "PID", "PIVD", "PLID", "POP", "PPBS", "PPH", "PPI", "PRN",
  "PROM", "PSA", "PSVT", "PTB", "PTCA", "PTH", "PUD", "QID",
  "RA factor", "RBBB", "RBC", "RBS", "RDS", "RDW", "RFT", "RHD",
  "RL", "RNTCP", "ROM", "ROP", "ROSC", "RTA", "RTI", "RTPCR",
  "RVG", "RVH", "SAH", "SDH", "SGOT", "SGPT", "SLE", "SOB",
  "SOS", "SpA", "SPECT", "SpO2", "SSI", "STAT", "STEMI", "SVT",
  "TBI", "TDS", "TENS", "THR", "TIA", "TIBC", "TKR", "TLC",
  "TMT", "TOF", "TPHA", "TPN", "TSH", "TTN", "TURP", "URTI",
  "USG", "UTI", "UTIs", "VAP", "VDRL", "VF", "VLDL", "VRE",
  "VSD", "VZV", "WBC", "WPW", "XDR",
];

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
