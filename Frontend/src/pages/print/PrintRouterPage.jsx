// pages/print/PrintRouterPage.jsx
// Renders the right printable for the URL slug, with paper-size
// toolbar on top. The data is passed via:
//   1. sessionStorage key `printPayload-<slug>` (set by the caller
//      that opened this window), OR
//   2. query string `?data=<base64 JSON>` (small payloads only), OR
//   3. an empty stub when neither is present (renders the layout
//      with placeholder data — useful for design preview).

import React, { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import useHospitalSettings from "../../Components/print/useHospitalSettings";
import PrintPreviewPage from "../../Components/print/PrintPreviewPage";
import PRINTABLES from "../../Components/print/printables";
import "../../Components/print/print.css";

/* Demo data used when no payload is supplied (visual preview only). */
const DEMO = {
  "opd-receipt": {
    receiptNo: "OPD-2026-00042",
    patientName: "Demo Patient",
    uhid: "UH00000099", age: 32, gender: "Male",
    doctorName: "Dr. Sandeep Kumar", department: "General Medicine",
    visitDate: new Date().toISOString(),
    items: [
      { name: "Consultation Fee · General Medicine", qty: 1, rate: 500, amount: 500 },
      { name: "Blood Pressure Check", qty: 1, rate: 100, amount: 100 },
      { name: "ECG", description: "12-lead",       qty: 1, rate: 350, amount: 350 },
    ],
    discount: 50, tax: 0,
    paymentMethod: "upi", paymentRef: "UPI/24913XX",
  },
  "payment-receipt": {
    receiptNo: "PAY-2026-01108",
    patientName: "Demo Patient", uhid: "UH00000099", ipdNo: "IPD-2026-0042",
    amount: 5000,
    method: "card", refNo: "TXN-0099887", cardLast4: "4242",
    receivedBy: "Cashier · System Admin",
    purpose: "IPD running bill — partial payment",
    runningBalance: 12350,
  },
  "advance-receipt": {
    receiptNo: "ADV-2026-00012",
    patientName: "Demo Patient", uhid: "UH00000099", ipdNo: "IPD-2026-0042",
    admissionDate: new Date().toISOString(),
    bedNumber: "BIMS-1-MGW-B02", wardName: "Male General Ward",
    amount: 20000, method: "cash",
    depositPurpose: "general hospitalization advance",
    estimatedCost: 75000,
  },
};

function readPayload(slug) {
  try {
    const raw = sessionStorage.getItem(`printPayload-${slug}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

const PrintRouterPage = () => {
  const { slug = "" } = useParams();
  const [search] = useSearchParams();
  const cfg = PRINTABLES[slug];

  const payload = useMemo(() => {
    // 1) sessionStorage (preferred for large payloads)
    const fromSession = readPayload(slug);
    if (fromSession) return fromSession;
    // 2) ?data=base64(json)
    const q = search.get("data");
    if (q) {
      try { return JSON.parse(atob(q)); } catch { /* ignore */ }
    }
    // 3) demo fallback when preview mode is requested
    if (search.get("demo") === "1") return DEMO[slug] || {};
    return null;
  }, [slug, search]);

  const { settings, ready } = useHospitalSettings();

  if (!cfg) {
    return (
      <PrintPreviewPage toolbarTitle="Unknown printable">
        <div className="pr-page">
          <h2 style={{ color: "#dc2626" }}>Printable not found</h2>
          <p>No printable is registered for slug <code>{slug}</code>.</p>
          <p>Available: {Object.keys(PRINTABLES).map(k => <code key={k} style={{ marginRight: 8 }}>{k}</code>)}</p>
        </div>
      </PrintPreviewPage>
    );
  }

  const Component = cfg.component;
  if (!ready) {
    return (
      <PrintPreviewPage toolbarTitle="Loading…" defaultPaper={cfg.defaultPaper}>
        <div className="pr-page" style={{ textAlign: "center", color: "#64748b" }}>
          Loading hospital settings…
        </div>
      </PrintPreviewPage>
    );
  }
  return (
    <PrintPreviewPage toolbarTitle={cfg.title} defaultPaper={cfg.defaultPaper}>
      <Component settings={settings} receipt={payload || {}} />
    </PrintPreviewPage>
  );
};

export default PrintRouterPage;
