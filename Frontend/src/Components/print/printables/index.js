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

  // ── Clinical ──────────────────────────────────────────
  "opd-prescription": { component: OPDPrescription,   title: "OPD Prescription (Rx)",     defaultPaper: "a4"      },
  "discharge-summary":{ component: DischargeSummary,  title: "Discharge Summary",         defaultPaper: "a4"      },
  "ipd-file":         { component: CompleteIPDFile,   title: "Complete IPD File",         defaultPaper: "a4"      },
  "mar-sheet":        { component: MARSheet,          title: "MAR Sheet · Daily",         defaultPaper: "a4"      },
  "doctor-order":     { component: DoctorOrderSheet,  title: "Doctor's Order Sheet",      defaultPaper: "a4"      },

  // ── Letters / certificates / authorizations ───────────
  "consent-form":     { component: ConsentForm,       title: "Consent Form",              defaultPaper: "a4"      },
  "medical-certificate": { component: MedicalCertificate, title: "Medical Certificate",   defaultPaper: "half-a4" },
  "referral-letter":  { component: ReferralLetter,    title: "Referral Letter",           defaultPaper: "a4"      },
  "tpa-authorization":{ component: TPAAuthorization,  title: "TPA / Cashless Authorization",defaultPaper: "a4"    },

  // ── Operational ───────────────────────────────────────
  "visitor-pass":     { component: VisitorPass,       title: "Visitor / Attendant Pass",  defaultPaper: "half-a4" },
};

export default PRINTABLES;
