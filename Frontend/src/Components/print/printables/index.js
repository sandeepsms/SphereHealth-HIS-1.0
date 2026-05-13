// Registry of every printable in the system, keyed by URL slug.
// Adding a new printable: drop it in this folder + register here.

import OPDReceipt      from "./OPDReceipt";
import OPDPrescription from "./OPDPrescription";
import PaymentReceipt  from "./PaymentReceipt";
import AdvanceReceipt  from "./AdvanceReceipt";
import FinalBill       from "./FinalBill";
import CompleteIPDFile from "./CompleteIPDFile";

export const PRINTABLES = {
  "opd-receipt":      { component: OPDReceipt,      title: "OPD Bill / Receipt",        defaultPaper: "half-a4" },
  "opd-prescription": { component: OPDPrescription, title: "OPD Prescription (Rx)",     defaultPaper: "a4"      },
  "payment-receipt":  { component: PaymentReceipt,  title: "Payment Receipt",           defaultPaper: "half-a4" },
  "advance-receipt":  { component: AdvanceReceipt,  title: "Advance / Deposit Receipt", defaultPaper: "half-a4" },
  "final-bill":       { component: FinalBill,       title: "Final Bill (IPD)",          defaultPaper: "a4"      },
  "ipd-file":         { component: CompleteIPDFile, title: "Complete IPD File",         defaultPaper: "a4"      },
};

export default PRINTABLES;
