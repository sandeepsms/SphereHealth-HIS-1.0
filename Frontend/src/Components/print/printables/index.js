// Registry of every printable in the system, keyed by URL slug.
// Adding a new printable: drop it in this folder + register here.

import OPDReceipt        from "./OPDReceipt";
import OPDPrescription   from "./OPDPrescription";
import PaymentReceipt    from "./PaymentReceipt";
import AdvanceReceipt    from "./AdvanceReceipt";
import FinalBill         from "./FinalBill";
import CompleteIPDFile   from "./CompleteIPDFile";
import DischargeSummary  from "./DischargeSummary";
import CostEstimate      from "./CostEstimate";
import RefundReceipt     from "./RefundReceipt";
import ServiceReceipt    from "./ServiceReceipt";
import ConsentForm       from "./ConsentForm";
import MedicalCertificate from "./MedicalCertificate";
import ReferralLetter    from "./ReferralLetter";
import VisitorPass       from "./VisitorPass";
import MARSheet          from "./MARSheet";
import DoctorOrderSheet  from "./DoctorOrderSheet";
import TPAAuthorization  from "./TPAAuthorization";
import PharmacyBill      from "./PharmacyBill";
import PharmacyRegister  from "./PharmacyRegister";
// R7bh-F7 / R7bg-7-CRIT-3: 7 new accountant + NABH/GST registers.
// SettlementStatement and CreditNotePrint are GST §34 / §46 receipts;
// DayBookPrint, GstReportPrint, TpaSettlementPrint, CashierShiftClosePrint
// close the daily / monthly / TPA / shift reconciliation gap that left
// the Accountant role with no NABH-compliant printables. ScheduleXRegisterPrint
// is the Narcotic Drugs & Psychotropic Substances Act register (D&C §66/67).
import SettlementStatement   from "./SettlementStatement";
import CreditNotePrint       from "./CreditNotePrint";
import DayBookPrint          from "./DayBookPrint";
import GstReportPrint        from "./GstReportPrint";
import TpaSettlementPrint    from "./TpaSettlementPrint";
import CashierShiftClosePrint from "./CashierShiftClosePrint";
import ScheduleXRegisterPrint from "./ScheduleXRegisterPrint";
// R7bf-F / A4-CRIT-2 + A4-HIGH-11: NABH AAC.3 compliant lab report.
// Lives under Components/lab/ (not printables/) so the lab module can
// import it independently, but registered here so it routes via the
// shared print shell + paper toolbar.
import LabReport         from "../../lab/LabReport";

// R7bj-F7: 14 new templates spanning Ward-Boy, Housekeeping, Security,
// Dietary, Mortuary, BMW and Code-Response workflows. These close the
// remaining "ungoverned printable" gaps surfaced by AUDIT_R7bi. F1 +
// F2's PhysioSession / PhysioPlan / KitchenIndentSlip slugs are
// pre-registered below behind a guard so the build remains green
// before / after their templates land.
import WardTaskTicket        from "./WardTaskTicket";
import EquipmentTransport    from "./EquipmentTransport";
import SampleCollectionSlip  from "./SampleCollectionSlip";
import CleaningTaskSlip      from "./CleaningTaskSlip";
import SpillageReport        from "./SpillageReport";
import PestControlRegister   from "./PestControlRegister";
import AreaCleaningChecklist from "./AreaCleaningChecklist";
import GateLogSlip           from "./GateLogSlip";
import IncidentReportPrint   from "./IncidentReportPrint";
import SecurityShiftRegister from "./SecurityShiftRegister";
import DietPlan              from "./DietPlan";
import MortuaryHandover      from "./MortuaryHandover";
import BmwManifest           from "./BmwManifest";
import CodeResponseSheet     from "./CodeResponseSheet";
// R7bj-F1 + F2 sibling printables — Physio session/plan + Kitchen indent
// slip. Templates landed in R7bj; R7bm-F1 activates the slug registrations
// so openPrint("physio-session"|"physio-plan"|"kitchen-indent-slip", …)
// finally routes to a real component instead of falling through to 404.
import PhysioSession         from "./PhysioSession";
import PhysioPlan            from "./PhysioPlan";
import KitchenIndentSlip     from "./KitchenIndentSlip";
// R7bm-F7 — three new regulatory-grade printables that close out the
// last gaps surfaced by R7bl-8. SharpsInjuryPrint backs NABH HIC.6 +
// BMW Rules 2016 §13 (5-year retention), ColdChainLogPrint backs
// FSSAI 2.1.13 + D&C Schedule K + WHO PQS E003 (3-year retention),
// AdverseFoodReactionPrint backs NABH COP.21 + JCI FMS.
import SharpsInjuryPrint        from "./SharpsInjuryPrint";
import ColdChainLogPrint        from "./ColdChainLogPrint";
import AdverseFoodReactionPrint from "./AdverseFoodReactionPrint";

export const PRINTABLES = {
  // ── Receipts / billing ─────────────────────────────────
  "opd-receipt":      { component: OPDReceipt,        title: "OPD Bill / Receipt",        defaultPaper: "half-a4" },
  // R7b-HIGH-3b: SERVICE bills used to reuse opd-receipt, which forced
  // OPD-only fields (Doctor / Department / Visit Date) onto walk-in lab
  // tests + imaging + day procedures. Distinct slug + dedicated component
  // so the header reads correctly (Service Date / Reference / Counter).
  "service-receipt":  { component: ServiceReceipt,    title: "Service Bill / Receipt",    defaultPaper: "half-a4" },
  "payment-receipt":  { component: PaymentReceipt,    title: "Payment Receipt",           defaultPaper: "half-a4" },
  "advance-receipt":  { component: AdvanceReceipt,    title: "Advance / Deposit Receipt", defaultPaper: "half-a4" },
  "refund-receipt":   { component: RefundReceipt,     title: "Refund Receipt",            defaultPaper: "half-a4" },
  "cost-estimate":    { component: CostEstimate,      title: "Cost Estimate · Indicative",defaultPaper: "a4"      },
  "final-bill":       { component: FinalBill,         title: "Final Bill (IPD)",          defaultPaper: "a4"      },
  // Interim Bill — same component, caller passes { isInterim: true } in
  // the receipt payload to flip the title + the "snapshot as of …" banner.
  // Used by the IPD Live Ledger to print a running bill mid-stay.
  "interim-bill":     { component: FinalBill,         title: "Interim Bill (IPD)",        defaultPaper: "a4"      },
  "pharmacy-bill":    { component: PharmacyBill,      title: "Pharmacy GST Tax Invoice",  defaultPaper: "half-a4", defaultOrient: "portrait" },
  "pharmacy-register":{ component: PharmacyRegister,  title: "Pharmacy Register",         defaultPaper: "a4",      defaultOrient: "portrait" },

  // ── Accountant / NABH / GST registers (R7bh-F7) ───────
  "settlement-statement":  { component: SettlementStatement,    title: "Settlement Statement",      defaultPaper: "a4" },
  "credit-note":           { component: CreditNotePrint,        title: "Credit Note (GST §34)",     defaultPaper: "a4" },
  "day-book":              { component: DayBookPrint,           title: "Day Book / Cash Register",  defaultPaper: "a4" },
  "gst-report":            { component: GstReportPrint,         title: "GST Outward Register",      defaultPaper: "a4" },
  "tpa-settlement":        { component: TpaSettlementPrint,     title: "TPA Settlement Statement",  defaultPaper: "a4" },
  "cashier-shift-close":   { component: CashierShiftClosePrint, title: "Cashier Shift Close",       defaultPaper: "a4" },
  "schedule-x-register":   { component: ScheduleXRegisterPrint, title: "Schedule X Narcotics Register", defaultPaper: "a4", defaultOrient: "landscape" },

  // ── Clinical ──────────────────────────────────────────
  "opd-prescription": { component: OPDPrescription,   title: "OPD Prescription (Rx)",     defaultPaper: "a4"      },
  "discharge-summary":{ component: DischargeSummary,  title: "Discharge Summary",         defaultPaper: "a4"      },
  "ipd-file":             { component: CompleteIPDFile, title: "Complete IPD File (uses admin-picked theme)", defaultPaper: "a4" },
  // R7ft — 5 theme-forced preview slugs for the print gallery.
  // Each one hardcodes ?theme=<key> via the URL when opened from the
  // gallery card; CompleteIPDFile.jsx reads the override and ignores
  // settings.patientFilePrintTheme so admins can compare side-by-side
  // before picking the default. Each delegates to the SAME router →
  // SAME data normalizer → only theme renderer changes.
  "ipd-file-narrative":   { component: CompleteIPDFile, title: "Patient File · Narrative Letter (Apollo/Fortis prose)", defaultPaper: "a4" },
  "ipd-file-timeline":    { component: CompleteIPDFile, title: "Patient File · Chronological Journal (day-diary)",    defaultPaper: "a4" },
  "ipd-file-executive":   { component: CompleteIPDFile, title: "Patient File · Executive Brief (Max/Tirath 2-col)",   defaultPaper: "a4" },
  "ipd-file-audit":       { component: CompleteIPDFile, title: "Patient File · NABH Audit Table (inspector view)",     defaultPaper: "a4" },
  "ipd-file-editorial":   { component: CompleteIPDFile, title: "Patient File · Editorial Magazine (glossy VIP)",      defaultPaper: "a4" },
  "mar-sheet":        { component: MARSheet,          title: "MAR Sheet · Daily",         defaultPaper: "a4"      },
  "doctor-order":     { component: DoctorOrderSheet,  title: "Doctor's Order Sheet",      defaultPaper: "a4"      },
  "lab-report":       { component: LabReport,         title: "Laboratory Report",         defaultPaper: "a4"      },

  // ── Letters / certificates / authorizations ───────────
  "consent-form":     { component: ConsentForm,       title: "Consent Form",              defaultPaper: "a4"      },
  "medical-certificate": { component: MedicalCertificate, title: "Medical Certificate",   defaultPaper: "half-a4" },
  "referral-letter":  { component: ReferralLetter,    title: "Referral Letter",           defaultPaper: "a4"      },
  "tpa-authorization":{ component: TPAAuthorization,  title: "TPA / Cashless Authorization",defaultPaper: "a4"    },

  // ── Operational ───────────────────────────────────────
  "visitor-pass":     { component: VisitorPass,       title: "Visitor / Attendant Pass",  defaultPaper: "half-a4" },

  // ── R7bj-F7: ward boy / housekeeping / security / dietary / mortuary / BMW / code ──
  "ward-task-ticket":       { component: WardTaskTicket,        title: "Ward Task Ticket",                    defaultPaper: "half-a4" },
  "equipment-transport":    { component: EquipmentTransport,    title: "Equipment Transport / Return Slip",   defaultPaper: "half-a4" },
  "sample-collection-slip": { component: SampleCollectionSlip,  title: "Sample Collection Slip",              defaultPaper: "half-a4" },
  "cleaning-task-slip":     { component: CleaningTaskSlip,      title: "Housekeeping Cleaning Task Slip",     defaultPaper: "half-a4" },
  "spillage-report":        { component: SpillageReport,        title: "Spillage Incident Report",            defaultPaper: "a4" },
  "pest-control-register":  { component: PestControlRegister,   title: "Pest Control Register Entry",         defaultPaper: "a4" },
  "area-cleaning-checklist":{ component: AreaCleaningChecklist, title: "Area Cleaning Checklist",             defaultPaper: "a4" },
  "gate-log-slip":          { component: GateLogSlip,           title: "Security Gate Log Entry",             defaultPaper: "half-a4" },
  "incident-report":        { component: IncidentReportPrint,   title: "Incident Report",                     defaultPaper: "a4" },
  "security-shift-register":{ component: SecurityShiftRegister, title: "Security Shift Register",             defaultPaper: "a4" },
  "diet-plan":              { component: DietPlan,              title: "Diet Plan",                           defaultPaper: "a4" },
  "mortuary-handover":      { component: MortuaryHandover,      title: "Mortuary Body Handover & Release",    defaultPaper: "a4" },
  "bmw-manifest":           { component: BmwManifest,           title: "Bio-Medical Waste Manifest (Form-IV)",defaultPaper: "a4" },
  "code-response-sheet":    { component: CodeResponseSheet,     title: "Code Response Event Sheet",           defaultPaper: "a4" },

  // ── R7bj-F1 / F2: Physio + Kitchen sibling printables ───────────
  // Templates landed in R7bj; R7bm-F1 activated these registrations
  // (the comment block previously held them back behind a "must wait
  // until the component file exists" guard which was never lifted
  // when the component files were added on disk). Slugs match the
  // openPrint() callsites in physio + diet workflows.
  "physio-session":         { component: PhysioSession,         title: "Physiotherapy Session Note",          defaultPaper: "a4" },
  "physio-plan":            { component: PhysioPlan,            title: "Physiotherapy Treatment Plan",        defaultPaper: "a4" },
  "kitchen-indent-slip":    { component: KitchenIndentSlip,     title: "Kitchen Indent Slip",                 defaultPaper: "half-a4" },

  // ── R7bm-F7: regulatory printables for HIC.6 / cold-chain / food ADR ──
  "sharps-injury":          { component: SharpsInjuryPrint,         title: "Sharps / Needle-stick Injury Report", defaultPaper: "a4" },
  "cold-chain-log":         { component: ColdChainLogPrint,         title: "Cold-Chain Temperature Log",          defaultPaper: "a4", defaultOrient: "landscape" },
  "adverse-food-reaction":  { component: AdverseFoodReactionPrint,  title: "Adverse Food Reaction Report",        defaultPaper: "a4" },
};

export default PRINTABLES;
