// Registry of every printable in the system, keyed by URL slug.
// Adding a new printable: drop it in this folder + register here.

import OPDReceipt     from "./OPDReceipt";
import PaymentReceipt from "./PaymentReceipt";
import AdvanceReceipt from "./AdvanceReceipt";

export const PRINTABLES = {
  "opd-receipt":     { component: OPDReceipt,     title: "OPD Bill / Receipt",       defaultPaper: "half-a4" },
  "payment-receipt": { component: PaymentReceipt, title: "Payment Receipt",          defaultPaper: "half-a4" },
  "advance-receipt": { component: AdvanceReceipt, title: "Advance / Deposit Receipt",defaultPaper: "half-a4" },
};

export default PRINTABLES;
