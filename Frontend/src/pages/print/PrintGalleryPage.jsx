// pages/print/PrintGalleryPage.jsx
// Demo / preview gallery — lists every registered printable so admins
// can sanity-check the layout and test paper sizes before wiring the
// Print button into actual workflows.

import React from "react";
import PRINTABLES from "../../Components/print/printables";
import { openPrint } from "../../Components/print/openPrint";

const PrintGalleryPage = () => {
  const entries = Object.entries(PRINTABLES);
  return (
    <div style={{ padding: "20px 28px", background: "#f8fafc", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{
        background: "linear-gradient(135deg, #0f172a, #1e293b)",
        borderRadius: 14, padding: "18px 24px", color: "white",
        marginBottom: 18, display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <i className="pi pi-print" style={{ fontSize: 22 }} />
        </div>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Printables Gallery</div>
          <div style={{ fontSize: 12, opacity: .85 }}>
            Every receipt / form / bill the system can print. Header &amp; footer auto-pull from Hospital Settings.
          </div>
        </div>
      </div>

      <div style={{
        background: "#fff7ed", border: "1.5px solid #fdba74", borderRadius: 10,
        padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#9a3412",
        display: "flex", gap: 10, alignItems: "flex-start",
      }}>
        <i className="pi pi-info-circle" style={{ fontSize: 14, marginTop: 1 }} />
        <div>
          <strong>How it works:</strong> Each printable opens in a popup window with a paper-size selector (A4 / Half-A4 / A5)
          and a Print button. Clicking <em>Demo data</em> renders a sample so you can see the layout instantly. To wire a
          printable into a real workflow, call <code>openPrint("&lt;slug&gt;", payload)</code> from any button.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
        {entries.map(([slug, cfg]) => (
          <div key={slug} style={{
            background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 14,
            padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                width: 38, height: 38, borderRadius: 10,
                background: "#e0e7ff", color: "#4f46e5",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16,
              }}>
                <i className="pi pi-file" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{cfg.title}</div>
                <div style={{ fontSize: 10.5, color: "#64748b" }}>
                  <code>{slug}</code> · default {cfg.defaultPaper.toUpperCase()}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  // Use the demo flag so the router renders sample data
                  window.open(`/print/${slug}?demo=1&ts=${Date.now()}`,
                    `_print_${slug}`, "popup=yes,width=900,height=1100,resizable=yes,scrollbars=yes");
                }}
                style={{
                  flex: 1, padding: "8px 14px",
                  background: "#0f172a", color: "white",
                  border: "none", borderRadius: 8,
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  fontFamily: "inherit",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                <i className="pi pi-eye" /> Preview with demo data
              </button>
              <button
                onClick={() => openPrint(slug, null)}
                title="Open with empty payload — useful to verify the layout"
                style={{
                  padding: "8px 14px",
                  background: "white", color: "#0f172a",
                  border: "1.5px solid #e2e8f0", borderRadius: 8,
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Empty
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 20, padding: "14px 18px",
        background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 12,
      }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: "#0f172a" }}>
          <i className="pi pi-code" style={{ marginRight: 6, color: "#7c3aed" }} />
          Wire it from your component
        </div>
        <pre style={{
          background: "#0f172a", color: "#e2e8f0",
          padding: 12, borderRadius: 8, fontSize: 11.5,
          overflowX: "auto", margin: 0,
        }}>
{`import { openPrint } from "../../Components/print/openPrint";

<button onClick={() => openPrint("opd-receipt", {
  receiptNo: "OPD-2026-00042",
  patientName: "Jai Bhagwan",
  uhid: "UH00000001",
  doctorName: "Dr. Sandeep Kumar",
  items: [
    { name: "Consultation", qty: 1, rate: 500, amount: 500 },
    { name: "ECG",           qty: 1, rate: 350, amount: 350 },
  ],
  paymentMethod: "upi", paymentRef: "TXN-99887",
})}>
  Print OPD Receipt
</button>`}
        </pre>
      </div>
    </div>
  );
};

export default PrintGalleryPage;
