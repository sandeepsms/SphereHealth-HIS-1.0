// config/insurers.js
// R7hr(CLAIM-P4.1) — registry of the major Indian health-insurance companies.
//
// This is distinct from the TPA registry (models/tpa/tpaModel.js): a TPA
// (Medi Assist, Paramount…) ADMINISTERS claims on behalf of one or more
// INSURERS (Star Health, HDFC Ergo…). A patient's claim form is the
// INSURER's form, submitted via the TPA. So we capture the insurer on the
// patient and drive the "company's own form" off this registry.
//
// IRDAI standardized the health claim form (Part A insured + Part B hospital)
// so every insurer legally accepts the standard form — hence `mandatesOwnForm`
// is "accepts-irdai-standard" throughout. The PDF engine (insurerFormService)
// overlays claim data onto the insurer's uploaded official blank PDF when the
// hospital has provided one, otherwise onto a generated standard form that
// carries this insurer's name/branding + where to submit.
//
// Submission email / address / portal were researched per insurer (2026) and
// are the single edit point — update here when an insurer changes its claims
// hub. `commonTpas: ["In-house"]` means the insurer self-administers claims.

const INSURERS = [
  // ── Standalone Health Insurers ─────────────────────────────────────
  { code: "STAR", name: "Star Health", legalName: "Star Health and Allied Insurance Co. Ltd.", type: "STANDALONE_HEALTH",
    claimEmail: "support@starhealth.in", claimAddress: "Star Health & Allied Insurance Co. Ltd., No.1 New Tank Street, Valluvar Kottam High Road, Nungambakkam, Chennai - 600034", portal: "starhealth.in",
    formTitle: "Health Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["In-house"] },
  { code: "CARE", name: "Care Health", legalName: "Care Health Insurance Ltd. (formerly Religare Health)", type: "STANDALONE_HEALTH",
    claimEmail: "customerfirst@careinsurance.com", claimAddress: "Care Health Insurance Ltd., Vipul Tech Square, Tower C, 3rd Floor, Golf Course Road, Sector-43, Gurugram - 122009", portal: "careinsurance.com",
    formTitle: "Health Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["In-house"] },
  { code: "NIVABUPA", name: "Niva Bupa", legalName: "Niva Bupa Health Insurance Co. Ltd. (formerly Max Bupa)", type: "STANDALONE_HEALTH",
    claimEmail: "claims@nivabupa.com", claimAddress: "Niva Bupa Health Insurance Co. Ltd., Claims Dept, 2nd Floor, Plot D-5, E Block, Sector 59, Noida - 201301", portal: "nivabupa.com",
    formTitle: "Reimbursement Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["In-house"] },
  { code: "MANIPALCIGNA", name: "ManipalCigna", legalName: "ManipalCigna Health Insurance Co. Ltd.", type: "STANDALONE_HEALTH",
    claimEmail: "manipalcigna@mediassist.in", claimAddress: "ManipalCigna Health Insurance Co. Ltd., 401/402 Raheja Titanium, Off Western Express Highway, Goregaon (E), Mumbai - 400063", portal: "manipalcigna.com",
    formTitle: "Claim Form Part A & B", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["Medi Assist (MediBuddy)"] },
  { code: "ADITYABIRLA", name: "Aditya Birla Health", legalName: "Aditya Birla Health Insurance Co. Ltd. (ABHICL)", type: "STANDALONE_HEALTH",
    claimEmail: "care.healthinsurance@adityabirlacapital.com", claimAddress: "Aditya Birla Health Insurance Co. Ltd., 9th Floor Tower 1, One World Center, 841 Senapati Bapat Marg, Mumbai - 400013", portal: "adityabirlacapital.com/healthinsurance",
    formTitle: "Reimbursement Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["In-house"] },
  { code: "NARAYANA", name: "Narayana Health Insurance", legalName: "Narayana Health Insurance Ltd.", type: "STANDALONE_HEALTH",
    claimEmail: "claims@narayanahealth.insurance", claimAddress: "", portal: "narayanahealth.insurance",
    formTitle: "Reimbursement Claim Form", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["In-house"] },
  { code: "GALAXY", name: "Galaxy Health", legalName: "Galaxy Health and Allied Insurance Co. Ltd.", type: "STANDALONE_HEALTH",
    claimEmail: "support@galaxyhealth.com", claimAddress: "Galaxy Health Insurance Co. Ltd., Prestige Polygon, 12th Floor, #471 Anna Salai, Nandanam, Chennai - 600035", portal: "galaxyhealth.com",
    formTitle: "Reimbursement Claim Form", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["Medi Assist"] },

  // ── Public-Sector (PSU) General Insurers ───────────────────────────
  { code: "NEWINDIA", name: "New India Assurance", legalName: "The New India Assurance Co. Ltd.", type: "PSU",
    claimEmail: "", claimAddress: "The New India Assurance Co. Ltd. (HO), 87 Mahatma Gandhi Road, Fort, Mumbai - 400001 — or the TPA named on the health card", portal: "newindia.co.in",
    formTitle: "Health Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["Medi Assist", "Paramount", "Raksha", "Vidal Health"] },
  { code: "NATIONAL", name: "National Insurance", legalName: "National Insurance Co. Ltd.", type: "PSU",
    claimEmail: "", claimAddress: "National Insurance Co. Ltd. (HO), 3 Middleton Street, Kolkata - 700071 — or the servicing TPA", portal: "nationalinsurance.nic.co.in",
    formTitle: "Health Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["MDIndia", "Vidal Health", "Raksha", "Medi Assist", "Paramount"] },
  { code: "ORIENTAL", name: "Oriental Insurance", legalName: "The Oriental Insurance Co. Ltd.", type: "PSU",
    claimEmail: "", claimAddress: "The Oriental Insurance Co. Ltd. (HO), Oriental House, A-25/27 Asaf Ali Road, New Delhi - 110002 — or the servicing TPA", portal: "orientalinsurance.org.in",
    formTitle: "Health Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["Vidal Health", "Raksha", "MDIndia", "Medi Assist", "Paramount"] },
  { code: "UNITEDINDIA", name: "United India Insurance", legalName: "United India Insurance Co. Ltd.", type: "PSU",
    claimEmail: "healthclaimquery@uiic.co.in", claimAddress: "United India Insurance Co. Ltd. (HO), 24 Whites Road, Chennai - 600014 — or the servicing TPA", portal: "uiic.co.in",
    formTitle: "Health Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["Health India TPA", "MDIndia", "Paramount", "Vidal Health", "Medi Assist", "FHPL"] },

  // ── Private General Insurers ───────────────────────────────────────
  { code: "HDFCERGO", name: "HDFC ERGO", legalName: "HDFC ERGO General Insurance Co. Ltd.", type: "PRIVATE_GENERAL",
    claimEmail: "healthclaims@hdfcergo.com", claimAddress: "HDFC ERGO General Insurance Co. Ltd., Health Claims, Stellar IT Park Tower-1, 5th Floor, C-25 Sector 62, Noida - 201301", portal: "hdfcergo.com",
    formTitle: "Health Suraksha / Optima Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["In-house"] },
  { code: "ICICILOMBARD", name: "ICICI Lombard", legalName: "ICICI Lombard General Insurance Co. Ltd.", type: "PRIVATE_GENERAL",
    claimEmail: "ihealthcare@icicilombard.com", claimAddress: "ICICI Lombard Health Care, ICICI Bank Tower, Plot 12 Financial District, Nanakramguda, Gachibowli, Hyderabad - 500032", portal: "ilhc.icicilombard.com",
    formTitle: "iHealthcare Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["In-house"] },
  { code: "BAJAJALLIANZ", name: "Bajaj Allianz", legalName: "Bajaj Allianz General Insurance Co. Ltd.", type: "PRIVATE_GENERAL",
    claimEmail: "bagichelp@bajajallianz.co.in", claimAddress: "Bajaj Allianz General Insurance Co. Ltd., Health Administration Team (HAT), Bajaj Allianz House, Airport Road, Yerawada, Pune - 411006", portal: "bajajallianz.com",
    formTitle: "Health Reimbursement Claim Form A + B", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["In-house"] },
  { code: "TATAAIG", name: "Tata AIG", legalName: "Tata AIG General Insurance Co. Ltd.", type: "PRIVATE_GENERAL",
    claimEmail: "healthclaimsupport@tataaig.com", claimAddress: "Tata AIG General Insurance Co. Ltd., Health Claims, 5th & 6th Floor Imperial Towers, Ameerpet, Hyderabad - 500016", portal: "tataaig.com",
    formTitle: "Medicare Health Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["Medi Assist", "FHPL", "In-house"] },
  { code: "RELIANCE", name: "Reliance General", legalName: "Reliance General Insurance Co. Ltd.", type: "PRIVATE_GENERAL",
    claimEmail: "rcarehealth@relianceada.com", claimAddress: "RCare Health, Reliance General Insurance, 3rd Floor Krishe Sapphire, Madhapur, Hyderabad - 500081", portal: "reliancegeneral.co.in",
    formTitle: "Reliance Health Reimbursement Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["In-house"] },
  { code: "SBIGENERAL", name: "SBI General", legalName: "SBI General Insurance Co. Ltd.", type: "PRIVATE_GENERAL",
    claimEmail: "customer.care@sbigeneral.in", claimAddress: "SBI General Insurance Co. Ltd., Health Vertical, 9th Floor Westport, Pan Card Club Road, Baner, Pune - 411045", portal: "sbigeneral.in",
    formTitle: "Health Insurance Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["Paramount", "Medi Assist", "MDIndia", "Vidal Health", "Health India"] },
  { code: "CHOLAMS", name: "Cholamandalam MS", legalName: "Cholamandalam MS General Insurance Co. Ltd.", type: "PRIVATE_GENERAL",
    claimEmail: "customercare@cholams.murugappa.com", claimAddress: "Cholamandalam MS General Insurance Co. Ltd., 2nd Floor 'Dare House', No.2 NSC Bose Road, Chennai - 600001", portal: "cholainsurance.com",
    formTitle: "Chola MS Health Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["Medi Assist", "Paramount"] },
  { code: "FUTUREGENERALI", name: "Future Generali (Generali Central)", legalName: "Future Generali India Insurance Co. Ltd. (now Generali Central Insurance Co. Ltd.)", type: "PRIVATE_GENERAL",
    claimEmail: "fgcare@futuregenerali.in", claimAddress: "Future Generali India Insurance Co. Ltd., Indiabulls Finance Centre Tower 3, 6th Floor, Senapati Bapat Marg, Mumbai - 400013", portal: "general.futuregenerali.in",
    formTitle: "Health Insurance Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["In-house (FGH)"] },
  { code: "KOTAK", name: "Zurich Kotak General", legalName: "Zurich Kotak General Insurance Co. (India) Ltd. (formerly Kotak Mahindra General)", type: "PRIVATE_GENERAL",
    claimEmail: "care@zurichkotak.com", claimAddress: "", portal: "zurichkotak.com",
    formTitle: "Health Insurance Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["Paramount", "FHPL"] },
  { code: "LIBERTY", name: "Liberty General", legalName: "Liberty General Insurance Ltd.", type: "PRIVATE_GENERAL",
    claimEmail: "health360@libertyinsurance.in", claimAddress: "", portal: "libertyinsurance.in",
    formTitle: "Health Policy Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["Vipul MedCorp", "Medi Assist"] },
  { code: "ROYALSUNDARAM", name: "Royal Sundaram", legalName: "Royal Sundaram General Insurance Co. Ltd.", type: "PRIVATE_GENERAL",
    claimEmail: "care@royalsundaram.in", claimAddress: "Royal Sundaram General Insurance Co. Ltd., Vishranthi Melaram Towers, No.2/319 Rajiv Gandhi Salai (OMR), Karapakkam, Chennai - 600097", portal: "royalsundaram.in",
    formTitle: "Health Insurance Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["Medi Assist", "Europ Assistance"] },
  { code: "IFFCOTOKIO", name: "IFFCO Tokio", legalName: "IFFCO Tokio General Insurance Co. Ltd.", type: "PRIVATE_GENERAL",
    claimEmail: "support@iffcotokio.co.in", claimAddress: "", portal: "iffcotokio.co.in",
    formTitle: "Health Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["In-house"] },
  { code: "UNIVERSALSOMPO", name: "Universal Sompo", legalName: "Universal Sompo General Insurance Co. Ltd.", type: "PRIVATE_GENERAL",
    claimEmail: "healthserve@universalsompo.com", claimAddress: "Universal Sompo General Insurance Co. Ltd., 5th Floor Logix Cyber Park Tower-D, Sector-62, Noida - 201303", portal: "universalsompo.com",
    formTitle: "Reimbursement Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["Medi Assist", "MDIndia"] },
  { code: "MAGMAHDI", name: "Magma General", legalName: "Magma General Insurance Ltd. (formerly Magma HDI)", type: "PRIVATE_GENERAL",
    claimEmail: "", claimAddress: "", portal: "magmahdi.com",
    formTitle: "Health Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: [] },

  // ── Digital-first Insurers ─────────────────────────────────────────
  { code: "ACKO", name: "Acko", legalName: "Acko General Insurance Ltd.", type: "DIGITAL",
    claimEmail: "health@acko.com", claimAddress: "", portal: "acko.com",
    formTitle: "Health Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["In-house (digital)"] },
  { code: "GODIGIT", name: "Go Digit", legalName: "Go Digit General Insurance Ltd.", type: "DIGITAL",
    claimEmail: "healthclaims@godigit.com", claimAddress: "", portal: "godigit.com",
    formTitle: "Health Insurance Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["In-house (digital)"] },
  { code: "NAVI", name: "Navi General", legalName: "Navi General Insurance Ltd. (formerly DHFL General)", type: "DIGITAL",
    claimEmail: "insurance.help@navi.com", claimAddress: "Navi General Insurance Ltd., Vaishnavi Tech Square, 7th Floor, Iballur Village, Begur Hobli, Bengaluru - 560102", portal: "navi.com/insurance",
    formTitle: "Health Claim Form - Reimbursement (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: ["Paramount", "FHPL"] },

  // ── Universal fallback ─────────────────────────────────────────────
  { code: "OTHER", name: "Other / Not Listed", legalName: "", type: "OTHER",
    claimEmail: "", claimAddress: "", portal: "",
    formTitle: "Health Claim Form (Part A & B)", mandatesOwnForm: "accepts-irdai-standard", commonTpas: [] },
];

const BY_CODE = INSURERS.reduce((m, i) => { m[i.code] = i; return m; }, {});

const TYPE_LABEL = {
  STANDALONE_HEALTH: "Standalone Health Insurer",
  PRIVATE_GENERAL:   "Private General Insurer",
  PSU:               "Public-Sector (PSU) Insurer",
  DIGITAL:           "Digital Insurer",
  OTHER:             "Other",
};

// Resolve by code (case-insensitive) or by a fuzzy name match; always returns
// a usable record (falls back to OTHER) so callers never crash on bad input.
function getInsurer(codeOrName = "") {
  if (!codeOrName) return BY_CODE.OTHER;
  const key = String(codeOrName).trim().toUpperCase();
  if (BY_CODE[key]) return BY_CODE[key];
  const byName = INSURERS.find(
    (i) => i.name.toUpperCase() === key || i.legalName.toUpperCase() === key
  );
  return byName || BY_CODE.OTHER;
}

// Lightweight list for dropdowns — no need to ship the whole record.
function listInsurers() {
  return INSURERS.filter((i) => i.code !== "OTHER").map((i) => ({
    code: i.code, name: i.name, type: i.type, typeLabel: TYPE_LABEL[i.type] || i.type,
  }));
}

module.exports = { INSURERS, BY_CODE, TYPE_LABEL, getInsurer, listInsurers };
