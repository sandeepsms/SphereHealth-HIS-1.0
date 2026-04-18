import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { API_ENDPOINTS } from "../../config/api";
import { useHospitalSettings, buildAddress, buildContact } from "../../context/HospitalSettingsContext";

/* ── number → words ─────────────────────────────────────────────────────── */
function numWords(num) {
  const ones  = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine"];
  const teens = ["Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens  = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  if (!num || num === 0) return "Zero";
  const go = (n) => {
    if (n < 10)   return ones[n];
    if (n < 20)   return teens[n - 10];
    if (n < 100)  return (tens[Math.floor(n/10)] + " " + ones[n%10]).trim();
    if (n < 1000) return ones[Math.floor(n/100)] + " Hundred " + go(n % 100);
    if (n < 100000)   return go(Math.floor(n/1000))   + " Thousand " + go(n % 1000);
    if (n < 10000000) return go(Math.floor(n/100000)) + " Lakh "     + go(n % 100000);
    return go(Math.floor(n/10000000)) + " Crore " + go(n % 10000000);
  };
  return go(Math.floor(num)).trim();
}

const rs  = (n) => "₹" + (Number(n) || 0).toFixed(2);
const fmtD  = (d) => d ? new Date(d).toLocaleDateString("en-IN",{ day:"2-digit", month:"short", year:"numeric" }) : "—";
const fmtDT = (d) => d ? new Date(d).toLocaleString("en-IN",{ day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) : "—";

/* ── Component ──────────────────────────────────────────────────────────── */
export default function BillPrintPage() {
  const { billId } = useParams();
  const { settings: hs } = useHospitalSettings();   // hospital settings from context
  const [bill,    setBill]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const printed = useRef(false);

  useEffect(() => {
    if (!billId) return;
    fetch(`${API_ENDPOINTS.BASE}/billing/${billId}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(j => { setBill(j.data || j.bill || j); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [billId]);

  useEffect(() => {
    if (bill && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 1200);
    }
  }, [bill]);

  /* ── Loading ── */
  if (loading) return (
    <div style={CENTER}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={SPINNER} />
      <p style={{ marginTop:14, color:"#555" }}>Loading bill…</p>
    </div>
  );

  if (error || !bill) return (
    <div style={CENTER}>
      <p style={{ color:"red", fontWeight:600 }}>❌ {error || "Bill not found"}</p>
      <button onClick={() => window.close()} style={BTN_CLOSE}>Close</button>
    </div>
  );

  const pat  = bill.patient   || {};
  const adm  = bill.admission || {};
  const items    = bill.billItems || [];
  const payments = (bill.payments || []).filter(p => Number(p.amount) > 0);
  const statusColor = bill.billStatus === "PAID" ? "#15803d" : bill.billStatus === "PARTIAL" ? "#b45309" : "#b91c1c";
  const statusBg    = bill.billStatus === "PAID" ? "#dcfce7" : bill.billStatus === "PARTIAL" ? "#fef9c3" : "#fee2e2";

  return (
    <>
      {/* ── Global print CSS ───────────────────────────────────────── */}
      <style>{`
        @keyframes spin { to { transform:rotate(360deg); } }

        /* ── Screen ── */
        body { margin:0; background:#cbd5e1; }
        .bill-page {
          max-width: 794px;        /* A4 width at 96dpi */
          margin: 0 auto;
          background: #fff;
          font-family: 'Segoe UI', Arial, sans-serif;
          font-size: 13px;
          color: #1e293b;
          padding: 32px 36px 40px;
          box-sizing: border-box;
          min-height: 100vh;
        }
        .toolbar {
          background:#1e293b; color:#fff;
          display:flex; align-items:center; justify-content:space-between;
          padding:10px 24px; position:sticky; top:0; z-index:100;
        }

        /* ── Print ── */
        @media print {
          @page { size: A4 portrait; margin: 12mm 14mm; }

          /* Hide EVERYTHING on the page */
          body * { visibility: hidden !important; }

          /* Show ONLY bill-page and its children */
          .bill-page,
          .bill-page * { visibility: visible !important; }

          /* Position bill at top-left corner of the print area */
          .bill-page {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            min-height: unset !important;
            background: #fff !important;
          }

          /* No blank page */
          html, body { height: auto !important; overflow: visible !important; }
        }
      `}</style>

      {/* ── Screen toolbar (hidden on print) ─────────────────────── */}
      <div className="toolbar">
        <span style={{ fontWeight:700, fontSize:14 }}>
          🧾 {bill.billNumber || "Bill"} — {pat.fullName || bill.UHID}
        </span>
        <div style={{ display:"flex", gap:8 }}>
          <button style={BTN_PRINT} onClick={() => window.print()}>🖨️ Print</button>
          <button style={BTN_CLOSE} onClick={() => window.close()}>✕ Close</button>
        </div>
      </div>

      {/* ── Bill Page ─────────────────────────────────────────────── */}
      <div className="bill-page">

        {/* Header — uses Hospital Settings */}
        <table width="100%" style={{ borderCollapse:"collapse", marginBottom:10 }}>
          <tbody><tr>
            <td style={{ verticalAlign:"top" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                {hs.showLogoInPrint && hs.logo && (
                  <img src={hs.logo} alt="Logo"
                    style={{ height: Math.min(Number(hs.logoWidth) || 120, 70), maxWidth:140, objectFit:"contain" }} />
                )}
                <div>
                  <div style={{ fontSize:20, fontWeight:800, color:"#1e293b" }}>{hs.hospitalName}</div>
                  {hs.showTaglineInPrint && hs.tagline && (
                    <div style={{ fontSize:11.5, color:"#475569", marginTop:1 }}>{hs.tagline}</div>
                  )}
                  {buildAddress(hs) && (
                    <div style={{ fontSize:11.5, color:"#475569" }}>📍 {buildAddress(hs)}</div>
                  )}
                  {(hs.phone1 || hs.email) && (
                    <div style={{ fontSize:11.5, color:"#475569" }}>{buildContact(hs)}</div>
                  )}
                  {hs.gstin && <div style={{ fontSize:11, color:"#94a3b8" }}>GSTIN: {hs.gstin}</div>}
                </div>
              </div>
            </td>
            <td style={{ textAlign:"right", verticalAlign:"top" }}>
              <div style={{ fontSize:17, fontWeight:800, color: hs.printAccentColor || "#1d4ed8", letterSpacing:1 }}>PATIENT BILL</div>
              <div style={{ fontSize:12, fontWeight:600, marginTop:3 }}>Bill No: {bill.billNumber || "—"}</div>
              <div style={{ fontSize:11.5, color:"#475569" }}>Date: {fmtD(bill.billDate || bill.createdAt)}</div>
              <div style={{ marginTop:4, display:"flex", gap:4, justifyContent:"flex-end" }}>
                {hs.nabh && <span style={{ background:"#dcfce7", color:"#15803d", border:"1px solid #86efac", fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:10 }}>NABH</span>}
                {hs.nabl && <span style={{ background:"#dbeafe", color:"#1d4ed8", border:"1px solid #93c5fd", fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:10 }}>NABL</span>}
                <span style={{ background:statusBg, color:statusColor, padding:"2px 10px", borderRadius:12, fontSize:11, fontWeight:700, border:`1px solid ${statusColor}` }}>
                  {bill.billStatus || "—"}
                </span>
              </div>
            </td>
          </tr></tbody>
        </table>

        <div style={HR} />

        {/* Patient + Admission Info */}
        <table width="100%" style={{ borderCollapse:"collapse", marginBottom:10 }}>
          <tbody><tr>
            {/* Patient */}
            <td width="50%" style={{ verticalAlign:"top", paddingRight:12 }}>
              <div style={SECTION_TITLE}>PATIENT DETAILS</div>
              <table width="100%" style={{ borderCollapse:"collapse", fontSize:12 }}>
                <tbody>
                  {[
                    ["Name",         `${pat.title || ""} ${pat.fullName || "—"}`.trim()],
                    ["UHID",          bill.UHID || "—"],
                    ["Age / Gender", `${pat.age || "—"} yrs / ${pat.gender || "—"}`],
                    ["Contact",       pat.contactNumber || "—"],
                    ["Payment Type",  bill.paymentType || "—"],
                  ].map(([l, v]) => (
                    <tr key={l}>
                      <td style={ILABEL}>{l}</td>
                      <td style={IVAL}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </td>
            {/* Admission */}
            <td width="50%" style={{ verticalAlign:"top", paddingLeft:12, borderLeft:"1px solid #e2e8f0" }}>
              <div style={SECTION_TITLE}>ADMISSION DETAILS</div>
              <table width="100%" style={{ borderCollapse:"collapse", fontSize:12 }}>
                <tbody>
                  {[
                    ["Adm. No.",   adm.admissionNumber || "—"],
                    ["Visit No.",  adm.visitNumber     || "—"],
                    ["Visit Type", adm.admissionType   || bill.visitType || "—"],
                    ["Doctor",     adm.attendingDoctor || "—"],
                    ["Department", adm.department      || "—"],
                  ].map(([l, v]) => (
                    <tr key={l}>
                      <td style={ILABEL}>{l}</td>
                      <td style={IVAL}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </td>
          </tr></tbody>
        </table>

        <div style={HR} />

        {/* Itemised Charges */}
        <div style={SECTION_TITLE}>ITEMISED CHARGES</div>
        <table width="100%" style={{ borderCollapse:"collapse", fontSize:12, marginBottom:4 }}>
          <thead>
            <tr style={{ background:"#1e293b", color:"#fff" }}>
              <th style={{ ...TH, width:"4%"  }}>#</th>
              <th style={{ ...TH, width:"40%", textAlign:"left" }}>Service / Description</th>
              <th style={{ ...TH, width:"13%" }}>Category</th>
              <th style={{ ...TH, width:"7%"  }}>Qty</th>
              <th style={{ ...TH, width:"12%" }}>Rate</th>
              <th style={{ ...TH, width:"8%"  }}>Disc%</th>
              <th style={{ ...TH, width:"16%", textAlign:"right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign:"center", padding:12, color:"#888" }}>No items</td></tr>
            )}
            {items.map((item, i) => (
              <tr key={item._id || i} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                <td style={TD}>{i + 1}</td>
                <td style={{ ...TD, textAlign:"left" }}>
                  <span style={{ fontWeight:500 }}>{item.serviceName}</span>
                </td>
                <td style={TD}>
                  <span style={{ background:"#ede9fe", color:"#5b21b6", borderRadius:8, padding:"1px 6px", fontSize:10, fontWeight:600 }}>
                    {item.category}
                  </span>
                </td>
                <td style={TD}>{item.quantity}</td>
                <td style={TD}>{rs(item.unitPrice)}</td>
                <td style={TD}>{item.discountPercent || 0}%</td>
                <td style={{ ...TD, textAlign:"right", fontWeight:600 }}>{rs(item.netAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Summary section — right-aligned table */}
        <table width="100%" style={{ borderCollapse:"collapse", marginTop:8 }}>
          <tbody><tr>
            {/* Amount in words — left */}
            <td style={{ verticalAlign:"bottom", paddingRight:20 }}>
              <div style={{ fontSize:11.5, color:"#475569", fontStyle:"italic", padding:"8px 10px", background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:4 }}>
                <strong>Amount in Words:</strong><br />
                {numWords(bill.netAmount || 0)} Rupees Only
              </div>
            </td>
            {/* Summary box — right */}
            <td style={{ width:240, verticalAlign:"top" }}>
              <table width="100%" style={{ borderCollapse:"collapse", border:"1px solid #e2e8f0", borderRadius:4, overflow:"hidden", fontSize:12 }}>
                <tbody>
                  <tr style={{ borderBottom:"1px solid #f1f5f9" }}>
                    <td style={SL}>Gross Amount</td>
                    <td style={SR}>{rs(bill.grossAmount)}</td>
                  </tr>
                  {Number(bill.totalDiscount) > 0 && (
                    <tr style={{ borderBottom:"1px solid #f1f5f9", color:"#b91c1c" }}>
                      <td style={SL}>Discount</td>
                      <td style={SR}>− {rs(bill.totalDiscount)}</td>
                    </tr>
                  )}
                  {Number(bill.taxAmount) > 0 && (
                    <tr style={{ borderBottom:"1px solid #f1f5f9" }}>
                      <td style={SL}>Tax</td>
                      <td style={SR}>{rs(bill.taxAmount)}</td>
                    </tr>
                  )}
                  <tr style={{ background:"#1e293b", color:"#fff", fontWeight:700, fontSize:13 }}>
                    <td style={{ ...SL, color:"#fff" }}>NET TOTAL</td>
                    <td style={{ ...SR, color:"#fff" }}>{rs(bill.netAmount)}</td>
                  </tr>
                  {Number(bill.advancePaid) > 0 && (
                    <tr style={{ borderBottom:"1px solid #f1f5f9", color:"#15803d" }}>
                      <td style={SL}>Advance Paid</td>
                      <td style={SR}>{rs(bill.advancePaid)}</td>
                    </tr>
                  )}
                  <tr style={{ background:"#fef9c3", color:"#854d0e", fontWeight:700, fontSize:13 }}>
                    <td style={SL}>BALANCE DUE</td>
                    <td style={SR}>{rs(bill.balanceAmount)}</td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr></tbody>
        </table>

        {/* Payment History */}
        {payments.length > 0 && (
          <>
            <div style={{ ...HR, marginTop:12 }} />
            <div style={SECTION_TITLE}>PAYMENT HISTORY</div>
            <table width="100%" style={{ borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"#334155", color:"#fff" }}>
                  <th style={{ ...TH, width:"5%"  }}>#</th>
                  <th style={{ ...TH, width:"30%", textAlign:"left" }}>Date & Time</th>
                  <th style={{ ...TH, width:"20%" }}>Mode</th>
                  <th style={{ ...TH, width:"30%" }}>Transaction ID</th>
                  <th style={{ ...TH, width:"15%", textAlign:"right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={p._id || i} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                    <td style={TD}>{i + 1}</td>
                    <td style={{ ...TD, textAlign:"left" }}>{fmtDT(p.paidAt)}</td>
                    <td style={TD}>{p.paymentMode || p.method || "—"}</td>
                    <td style={TD}>{p.transactionId || "—"}</td>
                    <td style={{ ...TD, textAlign:"right", fontWeight:600, color:"#15803d" }}>{rs(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div style={{ ...HR, marginTop:12 }} />

        {/* Terms */}
        <div style={{ fontSize:11, color:"#64748b", marginBottom:20 }}>
          <strong>Terms & Conditions: </strong>
          {[hs.termsLine1, hs.termsLine2, hs.termsLine3].filter(Boolean).join(" ")}
        </div>

        {/* Signatures */}
        <table width="100%" style={{ borderCollapse:"collapse", fontSize:12, color:"#475569" }}>
          <tbody><tr>
            <td style={{ textAlign:"center", width:"33%" }}>
              <div style={{ borderBottom:"1px solid #94a3b8", width:150, margin:"0 auto 4px" }} />
              Patient / Attendant Signature
            </td>
            <td style={{ textAlign:"center", width:"34%", color: hs.printAccentColor || "#1d4ed8", fontWeight:600, fontSize:12 }}>
              {hs.billFooterNote || `Thank you for choosing ${hs.hospitalName}`}
            </td>
            <td style={{ textAlign:"center", width:"33%" }}>
              <div style={{ borderBottom:"1px solid #94a3b8", width:150, margin:"0 auto 4px" }} />
              Authorized Signatory
            </td>
          </tr></tbody>
        </table>

      </div>{/* end .bill-page */}
    </>
  );
}

/* ── Shared styles ──────────────────────────────────────────────────────── */
const CENTER   = { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#f0f2f5" };
const SPINNER  = { width:44, height:44, borderRadius:"50%", border:"4px solid #ddd", borderTop:"4px solid #2563eb", animation:"spin .9s linear infinite" };
const BTN_PRINT = { padding:"6px 18px", background:"#2563eb", color:"#fff", border:"none", borderRadius:6, cursor:"pointer", fontWeight:600, fontSize:13 };
const BTN_CLOSE = { padding:"6px 14px", background:"transparent", color:"#cbd5e1", border:"1px solid #475569", borderRadius:6, cursor:"pointer", fontWeight:600, fontSize:13 };
const HR           = { border:"none", borderTop:"1.5px solid #e2e8f0", margin:"10px 0" };
const SECTION_TITLE = { fontWeight:700, fontSize:11, color:"#64748b", letterSpacing:".8px", textTransform:"uppercase", marginBottom:6, marginTop:4 };
const ILABEL = { color:"#64748b", padding:"3px 10px 3px 0", width:"38%", fontSize:12 };
const IVAL   = { fontWeight:600, color:"#1e293b", fontSize:12 };
const TH  = { padding:"7px 8px", textAlign:"center", fontWeight:600, fontSize:11, letterSpacing:.4 };
const TD  = { padding:"6px 8px", textAlign:"center", borderBottom:"1px solid #f1f5f9", color:"#334155", fontSize:12 };
const SL  = { padding:"6px 10px", color:"inherit", borderBottom:"1px solid #f1f5f9" };
const SR  = { padding:"6px 10px", textAlign:"right", color:"inherit", borderBottom:"1px solid #f1f5f9", fontWeight:600, whiteSpace:"nowrap" };
