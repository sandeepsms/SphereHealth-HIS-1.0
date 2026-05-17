/**
 * ReceptionBilling.jsx — Front-desk billing & payment collection
 *
 * URL: /reception-billing          → search a patient (UHID)
 *      /reception-billing/:uhid    → directly load that patient's bills
 *
 * Receptionist-focused — does NOT add clinical services (nurses/doctors do
 * that via auto-billing triggers). Receptionist sees the bill, accepts
 * payment (cash/UPI/card/cheque), prints receipt.
 *
 * API:
 *   GET  /api/billing/uhid/:UHID         → patient + bills[]
 *   GET  /api/billing/:billId            → full bill (items + payments)
 *   POST /api/billing/:billId/generate   → finalize a DRAFT bill
 *   POST /api/billing/:billId/payment    → {amount, paymentMode, transactionId?, receivedBy?}
 *   GET  /api/billing/collection-summary?date=YYYY-MM-DD
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { openPrint } from "../../Components/print/openPrint";
import { useAuth } from "../../context/AuthContext";
import "./reception-shared.css";

const fmtCur  = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const STATUS_CLASS = {
  DRAFT:     "pending",
  GENERATED: "submitted",
  PARTIAL:   "pending",
  PAID:      "cleared",
  CANCELLED: "revoked",
  REFUNDED:  "expired",
};

// Matches PaymentSchema.paymentMode enum on the backend. TPA_CLAIM is used
// when the TPA reimbursement settles a previously-pending share of a bill.
const PAYMENT_MODES = ["CASH", "UPI", "CARD", "CHEQUE", "ONLINE", "TPA_CLAIM"];
const ADVANCE_MODES = ["CASH", "UPI", "CARD", "CHEQUE", "ONLINE"];

/* Open /print/advance-receipt in a popup with the payload preloaded in
   sessionStorage. Matches the contract documented in PrintRouterPage.jsx.
   Single source of truth — both the success-state Print button and the
   per-row Reprint icon call this helper. */
function printAdvanceReceipt(advance, patient) {
  if (!advance || !patient) return;
  const payload = {
    receiptNo:    advance.receiptNumber,
    patientName:  [patient.title, patient.fullName].filter(Boolean).join(" "),
    uhid:         patient.UHID,
    ipdNo:        advance.admission?.admissionNumber || null,
    admissionDate: advance.admission?.admissionDate || null,
    bedNumber:    null,
    wardName:     null,
    date:         advance.paidAt || advance.createdAt || new Date().toISOString(),
    amount:       Number(advance.amount?.$numberDecimal ?? advance.amount) || 0,
    method:       advance.paymentMode,
    refNo:        advance.transactionId,
    depositPurpose: advance.remarks || "hospitalization advance",
  };
  try {
    sessionStorage.setItem("printPayload-advance-receipt", JSON.stringify(payload));
  } catch (e) {
    console.error("[print] sessionStorage write failed:", e?.message);
  }
  window.open("/print/advance-receipt", "_blank", "noopener,noreferrer,width=900,height=1100");
}

export default function ReceptionBilling() {
  const { uhid: paramUhid } = useParams();
  const navigate = useNavigate();
  const [uhid, setUhid] = useState(paramUhid || "");
  const [patient, setPatient] = useState(null);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeBill, setActiveBill] = useState(null); // full bill detail
  const [billLoading, setBillLoading] = useState(false);
  const [payTarget, setPayTarget] = useState(null);
  const [refundTarget, setRefundTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [addSvcTarget, setAddSvcTarget] = useState(null);   // DRAFT bill currently being amended
  const [todayCollection, setTodayCollection] = useState(null);
  // ── Advance-deposit state — fetched alongside bills on every load.
  //    advances: full ledger; unspentAdv: aggregated remaining balance
  //    (drives the "Advance Credit" KPI + Apply-Advance button gate).
  //    showAdvDlg toggles the TakeAdvanceModal.
  const [advances,      setAdvances]      = useState([]);
  const [unspentAdv,    setUnspentAdv]    = useState(0);
  const [showAdvDlg,    setShowAdvDlg]    = useState(false);
  // ── Smart search + active-patient directory ────────────────────
  //   searchQ        — text in the search box (name / UHID / phone)
  //   searchResults  — live dropdown matches (debounced 250ms)
  //   searchOpen     — toggles the dropdown visibility
  //   directory      — patients of the currently selected type
  //   listType       — "ALL" / "OPD" / "IPD" / "Daycare" / "Emergency" / "Services"
  //   directoryLoading — spinner while the tab list refreshes
  const [searchQ,         setSearchQ]         = useState("");
  const [searchResults,   setSearchResults]   = useState([]);
  const [searchOpen,      setSearchOpen]      = useState(false);
  const [searchBusy,      setSearchBusy]      = useState(false);
  const [directory,       setDirectory]       = useState([]);
  const [listType,        setListType]        = useState("OPD");
  const [directoryLoading,setDirectoryLoading]= useState(false);
  const searchDebRef = React.useRef(null);

  const load = useCallback(async (uhidArg) => {
    if (!uhidArg) return;
    setLoading(true);
    setPatient(null); setBills([]); setActiveBill(null);
    setAdvances([]); setUnspentAdv(0);
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.BILLING}/uhid/${uhidArg}`);
      const p = data?.patient || data?.data?.patient;
      const list = data?.bills || data?.data?.bills || [];
      if (!p) { toast.warning("No patient found for that UHID"); setLoading(false); return; }
      setPatient(p);
      setBills(list);

      // Parallel fetch — never blocks bill rendering if it 5xxs.
      try {
        const adv = await axios.get(`${API_ENDPOINTS.BILLING}/advance/uhid/${encodeURIComponent(uhidArg)}`);
        setAdvances(adv?.data?.data?.advances || []);
        setUnspentAdv(Number(adv?.data?.data?.totalUnspent) || 0);
      } catch (e) {
        console.warn("[ReceptionBilling] advance load failed:", e?.message);
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load bills");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (paramUhid) load(paramUhid); }, [paramUhid, load]);

  // ── Live search — fires 250ms after the user stops typing. ─────
  // The /patients/search endpoint searches name + UHID + contact +
  // patientId + email simultaneously, so the cashier can type any
  // identifier without having to pick which one in advance.
  useEffect(() => {
    if (searchDebRef.current) clearTimeout(searchDebRef.current);
    const q = (searchQ || "").trim();
    if (q.length < 2) { setSearchResults([]); return; }
    const ac = new AbortController();
    searchDebRef.current = setTimeout(async () => {
      setSearchBusy(true);
      try {
        const { data } = await axios.get(
          `${API_ENDPOINTS.PATIENTS}/search?q=${encodeURIComponent(q)}&limit=12`,
          { signal: ac.signal },
        );
        if (!ac.signal.aborted) setSearchResults(data?.data || data || []);
      } catch (e) {
        if (!axios.isCancel(e)) console.warn("[ReceptionBilling] search:", e?.message);
      } finally {
        if (!ac.signal.aborted) setSearchBusy(false);
      }
    }, 250);
    return () => { ac.abort(); if (searchDebRef.current) clearTimeout(searchDebRef.current); };
  }, [searchQ]);

  // ── Directory loader — refreshed whenever listType changes. ────
  // Pulls active patients of the selected registrationType (or all,
  // sorted by createdAt desc). Limit 60 keeps the grid responsive on
  // larger hospitals while still showing everyone for a small site.
  useEffect(() => {
    const ac = new AbortController();
    setDirectoryLoading(true);
    const params = new URLSearchParams({ limit: "60" });
    if (listType !== "ALL") params.set("registrationType", listType);
    axios.get(`${API_ENDPOINTS.PATIENTS}?${params.toString()}`, { signal: ac.signal })
      .then(({ data }) => {
        if (ac.signal.aborted) return;
        const rows = data?.patients || data?.data || (Array.isArray(data) ? data : []);
        setDirectory(Array.isArray(rows) ? rows : []);
      })
      .catch((e) => { if (!axios.isCancel(e)) console.warn("[ReceptionBilling] directory:", e?.message); })
      .finally(() => { if (!ac.signal.aborted) setDirectoryLoading(false); });
    return () => ac.abort();
  }, [listType]);

  // Helper — load a patient row when the user clicks anywhere in the
  // search dropdown or directory grid. Updates URL too so a refresh
  // re-loads the same patient.
  const pickPatient = (p) => {
    if (!p?.UHID) return;
    setUhid(p.UHID);
    setSearchQ("");
    setSearchOpen(false);
    setSearchResults([]);
    load(p.UHID);
    navigate(`/reception-billing/${encodeURIComponent(p.UHID)}`, { replace: true });
  };

  // Today's collection summary — small live tile.
  // Response shape: { success, date, summary: { totalCollected, totalGross, ... } }
  // AbortController guards against the receptionist navigating away mid-
  // request (E-05 pattern). Failure now logs to console instead of being
  // silently swallowed (E-06) — the live tile just shows no data, but
  // the operator can see in DevTools that the API call failed.
  useEffect(() => {
    const ac = new AbortController();
    axios.get(`${API_ENDPOINTS.BILLING}/collection-summary?date=${new Date().toISOString().slice(0, 10)}`, { signal: ac.signal })
      .then(({ data }) => { if (!ac.signal.aborted) setTodayCollection(data?.summary || data?.data?.summary || null); })
      .catch((e) => { if (!axios.isCancel(e)) console.error("[ReceptionBilling] collection-summary:", e?.message); });
    return () => ac.abort();
  }, []);

  const loadBill = async (billId) => {
    setBillLoading(true);
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.BILLING}/${billId}`);
      setActiveBill(data?.data || data);
    } catch (e) {
      toast.error("Could not load bill");
    } finally { setBillLoading(false); }
  };

  const generateBill = async (billId) => {
    if (!window.confirm("Generate (finalize) this draft bill? After this, items cannot be removed.")) return;
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${billId}/generate`, { generatedBy: "Reception" });
      toast.success("Bill generated");
      await load(uhid);
      await loadBill(billId);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not generate bill");
    }
  };

  /* Open the unified printable system (CSS-driven, paper-size picker,
   * header/footer auto-pulled from Hospital Settings). The legacy
   * receiptHTML() path below is kept as a fallback if anyone needs it
   * but new code should always go through openPrint(). */
  const printReceipt = (bill) => {
    const items = (bill.billItems || []).map(it => ({
      name: it.serviceName || it.name,
      description: it.description,
      qty:  it.quantity || 1,
      rate: it.unitPrice,
      amount: it.netAmount,
    }));
    const lastPay = (bill.payments || []).slice(-1)[0];
    openPrint("opd-receipt", {
      receiptNo:   bill.billNumber,
      patientName: patient?.fullName,
      uhid:        patient?.UHID,
      age:         patient?.age,
      gender:      patient?.gender,
      doctorName:  bill.doctorName || bill.consultantName,
      department:  bill.department,
      visitDate:   bill.createdAt,
      items,
      discount:    bill.discountAmount,
      tax:         bill.taxAmount,
      paymentMethod: lastPay?.paymentMode,
      paymentRef:    lastPay?.transactionId,
    });
  };

  const totals = useMemo(() => {
    const sum = (k) => bills.reduce((s, b) => s + (b[k] || 0), 0);
    return {
      gross:    sum("netAmount"),
      due:      sum("balanceAmount"),
      paid:     sum("netAmount") - sum("balanceAmount"),
      bills:    bills.length,
      open:     bills.filter(b => ["GENERATED", "PARTIAL"].includes(b.billStatus)).length,
      drafts:   bills.filter(b => b.billStatus === "DRAFT").length,
    };
  }, [bills]);

  return (
    <div className="rx-page">
      <div className="rx-header">
        <div>
          <div className="rx-header-title"><i className="pi pi-receipt" /> Billing & Payments</div>
          <div className="rx-header-meta">
            Patient bills · Cash / UPI / Card collection · Receipt printing
            {todayCollection?.totalCollected != null && <> · Today: <strong className="rx-text-success-light">{fmtCur(todayCollection.totalCollected)}</strong></>}
          </div>
        </div>
        <div className="rx-header-actions">
          <button className="rx-btn-ghost" onClick={() => navigate("/patient-search")}>
            <i className="pi pi-search" /> Patient Search
          </button>
          <button className="rx-btn-ghost" onClick={() => navigate("/reception")}>
            <i className="pi pi-arrow-left" /> Dashboard
          </button>
        </div>
      </div>

      {/* Smart search bar — name / UHID / phone. Live dropdown of
          matches as the receptionist types (min 2 chars). */}
      <div style={{ position: "relative", marginBottom: 14 }}>
        <div className="rx-search" style={{ marginBottom: 0 }}>
          <i className="pi pi-search" />
          <input
            placeholder="Search by name, UHID, or mobile number…"
            value={searchQ}
            onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 180)}   // delay so click on dropdown registers
            onKeyDown={e => {
              if (e.key === "Enter") {
                if (searchResults.length === 1) pickPatient(searchResults[0]);
                else if ((searchQ || "").trim().toUpperCase().startsWith("UH")) {
                  load(searchQ.trim().toUpperCase());
                  setSearchOpen(false);
                }
              } else if (e.key === "Escape") {
                setSearchOpen(false);
              }
            }}
          />
          {searchBusy && <i className="pi pi-spin pi-spinner" style={{ color: "#94a3b8" }} />}
        </div>

        {searchOpen && searchQ.trim().length >= 2 && (
          <div className="rx-search-dropdown" style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)", maxHeight: 380,
            overflowY: "auto", zIndex: 50,
          }}>
            {searchResults.length === 0 && !searchBusy ? (
              <div style={{ padding: "16px 14px", color: "#94a3b8", fontSize: 13, textAlign: "center" }}>
                No patient matches "{searchQ}"
              </div>
            ) : (
              searchResults.map(p => (
                <button key={p._id}
                        onMouseDown={() => pickPatient(p)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          width: "100%", padding: "8px 12px", border: 0,
                          borderBottom: "1px solid #f1f5f9", background: "#fff",
                          cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                        onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    background: "linear-gradient(135deg, #0891b2, #06b6d4)",
                    color: "#fff", fontWeight: 800, fontSize: 12,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {String(p.fullName || "?").trim().split(/\s+/).slice(0,2).map(x => x[0] || "").join("").toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 13 }}>
                      {p.title ? `${p.title} ` : ""}{p.fullName}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span className="rx-mono-tag rx-mono-tag--subtle">{p.UHID}</span>
                      {p.contactNumber && <span>📱 {p.contactNumber}</span>}
                      {p.age != null && <span>{p.age}y · {p.gender || "—"}</span>}
                    </div>
                  </div>
                  {p.registrationType && (
                    <span className="rx-mode-pill" style={{ fontSize: 10, padding: "2px 8px" }}>
                      {p.registrationType}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : !patient ? (
        /* ── Active-patient directory ──────────────────────────────
           No patient picked yet. Show a tabbed list of currently
           active patients filtered by registration type so the
           cashier can click a row instead of typing a UHID. */
        <PatientDirectory
          listType={listType}
          setListType={setListType}
          rows={directory}
          loading={directoryLoading}
          onPick={pickPatient}
        />
      ) : (
        <>
          {/* Patient summary */}
          <div className="rx-card rx-mb-12">
            <div className="rx-card-main">
              <div className="rx-card-name">
                {patient.fullName}
                {patient.tpa && <span className="rx-card-stage rx-card-stage--submitted">TPA</span>}
                {patient.paymentType && <span className="rx-mono-tag">{patient.paymentType}</span>}
              </div>
              <div className="rx-card-meta">
                <span>UHID: <strong>{patient.UHID}</strong></span>
                {patient.contactNumber && <span>📱 <strong>{patient.contactNumber}</strong></span>}
                {patient.department && <span>Dept: <strong>{typeof patient.department === "object" ? patient.department.name : patient.department}</strong></span>}
                {patient.doctor && <span>Doctor: <strong>{typeof patient.doctor === "object" ? (patient.doctor.fullName || patient.doctor.personalInfo?.fullName) : patient.doctor}</strong></span>}
              </div>
            </div>
            <div className="rx-card-actions">
              <button className="rx-action-btn rx-action-btn--primary"
                      onClick={() => setShowAdvDlg(true)}
                      title="Take cash / UPI / card deposit before bills are generated">
                <i className="pi pi-wallet" /> Take Advance
              </button>
              <button className="rx-action-btn"
                      onClick={() => navigate(`/visit-history/${patient.UHID}`)}>
                <i className="pi pi-clock" /> History
              </button>
            </div>
          </div>

          {/* KPI strip — 5th tile (Advance Credit) only renders when
              the patient has an unspent deposit; otherwise the strip
              stays compact at 4 tiles. */}
          <div className="rx-kpis">
            <div className="rx-kpi rx-kpi--accent">
              <div className="rx-kpi-label">Total Bills</div>
              <div className="rx-kpi-value">{totals.bills}</div>
              <div className="rx-kpi-sub">{totals.drafts} draft · {totals.open} open</div>
            </div>
            <div className="rx-kpi rx-kpi--accent">
              <div className="rx-kpi-label">Total Billed</div>
              <div className="rx-kpi-value">{fmtCur(totals.gross)}</div>
            </div>
            <div className="rx-kpi rx-kpi--accent">
              <div className="rx-kpi-label">Collected</div>
              <div className="rx-kpi-value rx-text-success">{fmtCur(totals.paid)}</div>
            </div>
            <div className="rx-kpi rx-kpi--accent">
              <div className="rx-kpi-label">Outstanding</div>
              <div className={`rx-kpi-value ${totals.due > 0 ? "rx-text-danger" : "rx-text-success"}`}>{fmtCur(totals.due)}</div>
            </div>
            {unspentAdv > 0 && (
              <div className="rx-kpi rx-kpi--accent rx-kpi--credit"
                   title="Unspent advance deposits on this UHID. Click Apply on any open bill to consume.">
                <div className="rx-kpi-label">Advance Credit</div>
                <div className="rx-kpi-value rx-text-success">{fmtCur(unspentAdv)}</div>
                <div className="rx-kpi-sub">{advances.filter((a) => (a.remainingAmount || 0) > 0).length} deposit{advances.filter((a) => (a.remainingAmount || 0) > 0).length === 1 ? "" : "s"}</div>
              </div>
            )}
          </div>

          {/* ── Advance Deposits ledger ─────────────────────────────
              Shows every deposit (active + applied + refunded). Reprint
              icon on each non-void row. When a bill is selected on the
              right, "Apply Advance" button on its toolbar consumes from
              the oldest active deposit. */}
          {advances.length > 0 && (
            <div className="rx-card rx-mb-12" style={{ borderLeft: "4px solid #06b6d4", display: "block" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12, fontWeight: 800, color: "#06b6d4", textTransform: "uppercase", letterSpacing: 0.4 }}>
                <i className="pi pi-wallet" /> Advance Deposits
                <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: unspentAdv > 0 ? "#15803d" : "#64748b", background: unspentAdv > 0 ? "#f0fdf4" : "#f1f5f9", padding: "3px 10px", borderRadius: 999, border: `1px solid ${unspentAdv > 0 ? "#86efac" : "#e2e8f0"}`, letterSpacing: 0, textTransform: "none" }}>
                  {unspentAdv > 0 ? `Available: ${fmtCur(unspentAdv)}` : "Fully applied"}
                </span>
              </div>
              {advances.map((a) => {
                const isVoid = a.status === "REFUNDED" || a.status === "CANCELLED";
                return (
                  <div key={a._id} style={{
                    padding: "6px 0",
                    borderBottom: "1px dotted #f1f5f9",
                    opacity: a.status === "FULLY_APPLIED" ? 0.7 : (isVoid ? 0.45 : 1),
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "#475569" }}>
                      <span className="rx-mono-tag">{a.receiptNumber}</span>
                      <span className="rx-mode-pill">{a.paymentMode}</span>
                      {a.transactionId && <span className="rx-mono-tag rx-mono-tag--subtle">{a.transactionId}</span>}
                      <span style={{ color: "#94a3b8" }}>by {a.receivedBy}</span>
                      <span style={{ marginLeft: "auto", fontFamily: "'DM Mono', monospace", fontWeight: 800, color: "#0f172a", fontSize: 13 }}>
                        {fmtCur(a.amount)}
                        {a.remainingAmount > 0 && a.remainingAmount < Number(a.amount) && (
                          <span style={{ fontWeight: 600, fontSize: 11, color: "#15803d", marginLeft: 4 }}>
                            ({fmtCur(a.remainingAmount)} left)
                          </span>
                        )}
                      </span>
                      {!isVoid && (
                        <button
                          type="button"
                          onClick={() => printAdvanceReceipt(a, patient)}
                          title={`Reprint receipt ${a.receiptNumber}`}
                          style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <i className="pi pi-print" style={{ fontSize: 12 }} />
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3, paddingLeft: 4 }}>
                      {new Date(a.paidAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      {" · status: "}<strong>{a.status}</strong>
                      {a.appliedTo?.length > 0 && ` · applied to ${a.appliedTo.map((x) => x.billNumber).join(", ")}`}
                      {a.remarks && ` · ${a.remarks}`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Two-column layout: bill list | active bill details */}
          <div className="rx-split-list">
            {/* Bills column */}
            <div>
              {bills.length === 0 ? (
                <div className="rx-empty">
                  <span className="rx-empty-icon">📑</span>
                  No bills yet for this patient.
                </div>
              ) : bills.map(b => {
                const isActive = activeBill?._id === b._id;
                const cls = STATUS_CLASS[b.billStatus] || "pending";
                return (
                  <div key={b._id} className={`rx-bill-row ${isActive ? "rx-bill-row--active" : ""}`}
                       onClick={() => loadBill(b._id)}>
                    <div className="rx-min-zero">
                      <div className="rx-bill-row-line">
                        <span className="rx-bill-num">{b.billNumber || "DRAFT"}</span>
                        <span className={`rx-card-stage rx-card-stage--${cls}`}>{b.billStatus}</span>
                        {b.visitType && <span className="rx-mono-tag rx-mono-tag--subtle">{b.visitType}</span>}
                      </div>
                      <div className="rx-bill-amounts">
                        <span>Total: <strong>{fmtCur(b.netAmount)}</strong></span>
                        <span className="paid">Paid: <strong>{fmtCur((b.netAmount || 0) - (b.balanceAmount || 0))}</strong></span>
                        {b.balanceAmount > 0 && <span className="due">Due: <strong>{fmtCur(b.balanceAmount)}</strong></span>}
                      </div>
                      <div className="rx-bill-row-meta">
                        Created: {fmtDate(b.createdAt)} · {(b.billItems || []).length} item{(b.billItems || []).length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Active bill details */}
            <div>
              {billLoading ? (
                <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
              ) : !activeBill ? (
                <div className="rx-empty">
                  <span className="rx-empty-icon">👉</span>
                  Select a bill from the left to view items, payments and collect.
                </div>
              ) : (
                <BillDetail
                  bill={activeBill}
                  unspentAdv={unspentAdv}
                  onGenerate={() => generateBill(activeBill._id)}
                  onPay={() => setPayTarget(activeBill)}
                  onPrint={() => printReceipt(activeBill)}
                  onRefund={() => setRefundTarget(activeBill)}
                  onCancel={() => setCancelTarget(activeBill)}
                  onAddService={() => setAddSvcTarget(activeBill)}
                  onApplyAdvance={async () => {
                    const unspent = advances.filter((a) => (a.remainingAmount || 0) > 0);
                    if (unspent.length === 0) { toast.warning("No unspent advance available"); return; }
                    // FIFO — apply oldest first. Backend caps the amount at
                    // MIN(advance remaining, bill balance) so a single click
                    // is always safe.
                    const adv = unspent[unspent.length - 1];
                    try {
                      await axios.post(`${API_ENDPOINTS.BILLING}/advance/${adv._id}/apply`, { billId: activeBill._id });
                      toast.success("Advance applied to bill");
                      await load(uhid);
                      await loadBill(activeBill._id);
                    } catch (e) {
                      toast.error(e?.response?.data?.message || "Apply failed");
                    }
                  }}
                />
              )}
            </div>
          </div>
        </>
      )}

      {payTarget && (
        <PaymentModal
          bill={payTarget}
          onClose={() => setPayTarget(null)}
          onDone={async () => {
            const id = payTarget._id;
            setPayTarget(null);
            await load(uhid);
            await loadBill(id);
          }}
        />
      )}

      {showAdvDlg && patient && (
        <TakeAdvanceModal
          patient={patient}
          onClose={() => setShowAdvDlg(false)}
          onSaved={() => { setShowAdvDlg(false); load(uhid); }}
        />
      )}

      {addSvcTarget && (
        <AddServiceModal
          bill={addSvcTarget}
          onClose={() => setAddSvcTarget(null)}
          onChanged={async () => {
            // Keep modal open so the cashier can add multiple services
            // in one sitting; just refresh the underlying bill + totals.
            await load(uhid);
            await loadBill(addSvcTarget._id);
            // Re-sync the modal's `bill` prop so the running total updates.
            const r = await axios.get(`${API_ENDPOINTS.BILLING}/${addSvcTarget._id}`).catch(() => null);
            const fresh = r?.data?.data || r?.data;
            if (fresh) setAddSvcTarget(fresh);
          }}
        />
      )}

      {refundTarget && (
        <RefundModal
          bill={refundTarget}
          onClose={() => setRefundTarget(null)}
          onDone={async () => {
            const id = refundTarget._id;
            setRefundTarget(null);
            await load(uhid);
            await loadBill(id);
          }}
        />
      )}

      {cancelTarget && (
        <CancelBillModal
          bill={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={async () => {
            const id = cancelTarget._id;
            setCancelTarget(null);
            await load(uhid);
            await loadBill(id);
          }}
        />
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function BillDetail({ bill, unspentAdv = 0, onGenerate, onPay, onPrint, onRefund, onCancel, onApplyAdvance, onAddService }) {
  const { can } = useAuth();
  const isDraft   = bill.billStatus === "DRAFT";
  const canPay    = ["GENERATED", "PARTIAL"].includes(bill.billStatus);
  const items     = bill.billItems || [];
  const payments  = bill.payments || [];
  const paidTotal = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const canApply  = canPay && unspentAdv > 0 && Number(bill.balanceAmount) > 0;
  // Receptionist may collect payments but NOT issue refunds or cancel a
  // finalized bill — those need Accountant/Admin (billing.refund).
  // Backend already 403s the call; this hides the button so the UX matches.
  const canRefund = can("billing.refund") && paidTotal > 0 && bill.billStatus !== "CANCELLED";
  const canCancel = can("billing.refund") && !isDraft && paidTotal <= 0 && !["CANCELLED", "REFUNDED"].includes(bill.billStatus);

  return (
    <div className="rx-detail-card">
      <div className="rx-detail-head">
        <i className="pi pi-receipt rx-icon-info" />
        <div className="rx-flex-1">
          <div className="rx-detail-head-title">
            {bill.billNumber || "DRAFT BILL"}
            <span className={`rx-card-stage rx-card-stage--${STATUS_CLASS[bill.billStatus]} rx-ml-auto`}>{bill.billStatus}</span>
          </div>
          <div className="rx-detail-head-sub">{bill.visitType || "OPD"} · {items.length} item{items.length === 1 ? "" : "s"} · Created {fmtDate(bill.createdAt)}</div>
        </div>
        {isDraft && onAddService && (
          <button className="rx-action-btn rx-action-btn--success"
                  onClick={onAddService}
                  title="Add ECG, dressing, nebulisation, etc. to this draft">
            <i className="pi pi-plus" /> Add Service
          </button>
        )}
        {isDraft && (
          <button className="rx-action-btn rx-action-btn--primary" onClick={onGenerate}>
            <i className="pi pi-check" /> Generate Bill
          </button>
        )}
        {canApply && (
          <button className="rx-action-btn rx-action-btn--primary"
                  onClick={onApplyAdvance}
                  title={`Consume from the oldest unspent advance (${unspentAdv.toLocaleString("en-IN")} available)`}>
            <i className="pi pi-arrow-circle-down" /> Apply Advance
          </button>
        )}
        {canPay && (
          <button className="rx-action-btn rx-action-btn--success" onClick={onPay}>
            <i className="pi pi-wallet" /> Collect Payment
          </button>
        )}
        {!isDraft && (
          <button className="rx-action-btn" onClick={onPrint}>
            <i className="pi pi-print" /> Print
          </button>
        )}
        {canRefund && (
          <button className="rx-action-btn rx-action-btn--danger" onClick={onRefund} title="Refund a payment">
            <i className="pi pi-undo" /> Refund
          </button>
        )}
        {canCancel && (
          <button className="rx-action-btn" onClick={onCancel} title="Cancel this bill (only when nothing collected)">
            <i className="pi pi-ban" /> Cancel
          </button>
        )}
      </div>

      {/* Items */}
      <div className="rx-detail-body">
        <div className="rx-section-label">Items</div>
        {items.length === 0 ? (
          <div className="rx-empty-tip">No items on this bill yet.</div>
        ) : (
          <table className="rx-table">
            <thead>
              <tr>
                <th>Service</th>
                <th className="right">Qty</th>
                <th className="right">Unit Price</th>
                <th className="right">Discount</th>
                <th className="right">Net</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it._id || i}>
                  <td>
                    {it.serviceName || it.name}
                    {it.appliedTariff && <span className="rx-tariff-pill">{it.appliedTariff}</span>}
                  </td>
                  <td className="right">{it.quantity || 1}</td>
                  <td className="right">{fmtCur(it.unitPrice)}</td>
                  <td className="right rx-text-discount">{it.discountPercent ? `${it.discountPercent}%` : "—"}</td>
                  <td className="right bold">{fmtCur(it.netAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Totals */}
      <div className="rx-detail-totals">
        <div className="rx-grid-fit-120">
          <div>Gross: <strong>{fmtCur(bill.grossAmount)}</strong></div>
          <div>Discount: <strong className="rx-text-discount">{fmtCur(bill.totalDiscount)}</strong></div>
          <div>Tax: <strong>{fmtCur(bill.taxAmount)}</strong></div>
          <div>Net: <strong className="rx-text-strong">{fmtCur(bill.netAmount)}</strong></div>
          <div>Paid: <strong className="rx-text-success">{fmtCur((bill.netAmount || 0) - (bill.balanceAmount || 0))}</strong></div>
          <div>Balance: <strong className={bill.balanceAmount > 0 ? "rx-text-danger" : "rx-text-success"}>{fmtCur(bill.balanceAmount)}</strong></div>
        </div>
      </div>

      {/* Payments */}
      {payments.length > 0 && (
        <div className="rx-detail-payments">
          <div className="rx-section-label">Payments ({payments.length})</div>
          <table className="rx-table rx-table--sm">
            <thead>
              <tr>
                <th>Date</th>
                <th>Mode</th>
                <th>Txn / Ref</th>
                <th>By</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={p._id || i}>
                  <td>{fmtDateTime(p.paidAt)}</td>
                  <td><span className="rx-mode-pill">{p.paymentMode}</span></td>
                  <td>{p.transactionId || "—"}</td>
                  <td>{p.receivedBy || "—"}</td>
                  <td className="right bold rx-text-success">{fmtCur(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function PaymentModal({ bill, onClose, onDone }) {
  const [amount, setAmount] = useState(bill.balanceAmount || 0);
  const [mode, setMode] = useState("CASH");
  const [txnId, setTxnId] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (amt > (bill.balanceAmount || 0) + 0.5) {
      if (!window.confirm(`Amount ${fmtCur(amt)} exceeds balance ${fmtCur(bill.balanceAmount)}. Proceed anyway?`)) return;
    }
    if (["UPI", "CARD", "CHEQUE", "ONLINE"].includes(mode) && !txnId.trim()) {
      if (!window.confirm(`No transaction reference for ${mode} payment. Record anyway?`)) return;
    }
    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${bill._id}/payment`, {
        amount: amt, paymentMode: mode,
        transactionId: txnId || undefined,
        receivedBy: receivedBy || undefined,
        remarks: remarks || undefined,
      });
      toast.success(`${fmtCur(amt)} recorded via ${mode}`);
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Payment failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--success">
          <i className="pi pi-wallet" />
          <span className="rx-modal-title">Collect Payment — {bill.billNumber}</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="rx-banner rx-banner--success">
            💰 Balance Due: <strong>{fmtCur(bill.balanceAmount)}</strong> of <strong>{fmtCur(bill.netAmount)}</strong>
          </div>

          <div className="his-field-group">
            <label className="his-label">Amount (₹) *</label>
            <input className="his-field" type="number" min="0" step="0.01"
                   value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
          </div>

          <div className="his-field-group">
            <label className="his-label">Payment Mode *</label>
            <div className="rx-grid-5">
              {PAYMENT_MODES.map(m => (
                <button key={m} type="button"
                        className={`rx-slot ${mode === m ? "rx-slot--selected" : ""}`}
                        onClick={() => setMode(m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          {mode !== "CASH" && (
            <div className="his-field-group">
              <label className="his-label">{mode === "UPI" ? "UPI Reference / VPA" : mode === "CHEQUE" ? "Cheque Number" : "Transaction ID"}</label>
              <input className="his-field" value={txnId} onChange={e => setTxnId(e.target.value)}
                     placeholder={mode === "UPI" ? "e.g. 412345678901" : mode === "CHEQUE" ? "e.g. 000123" : "Auth / approval code"} />
            </div>
          )}

          <div className="rx-grid-2">
            <div className="his-field-group">
              <label className="his-label">Received By</label>
              <input className="his-field" value={receivedBy} onChange={e => setReceivedBy(e.target.value)} placeholder="Reception staff name" />
            </div>
            <div className="his-field-group">
              <label className="his-label">Remarks</label>
              <input className="his-field" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--success" onClick={submit} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check"}`} /> Record Payment
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function RefundModal({ bill, onClose, onDone }) {
  const paid = (bill.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  const [amount, setAmount] = useState(paid);
  const [mode, setMode] = useState("CASH");
  const [reason, setReason] = useState("");
  const [refundedBy, setRefundedBy] = useState("");
  const [txnId, setTxnId] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a refund amount");
    if (amt > paid + 0.5) return toast.error(`Cannot refund more than collected (${fmtCur(paid)})`);
    if (!reason.trim()) return toast.error("Refund reason is mandatory for audit");
    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${bill._id}/refund`, {
        amount: amt, mode, reason: reason.trim(),
        refundedBy: refundedBy || undefined,
        transactionId: txnId || undefined,
      });
      toast.success(`Refund ${fmtCur(amt)} recorded`);
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Refund failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--danger">
          <i className="pi pi-undo" />
          <span className="rx-modal-title">Refund — {bill.billNumber}</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="rx-banner rx-banner--danger">
            ⚠ Already collected: <strong>{fmtCur(paid)}</strong> · Refunds are permanently logged for NABH audit.
          </div>

          <div className="his-field-group">
            <label className="his-label">Refund Amount (₹) *</label>
            <input className="his-field" type="number" min="0" step="0.01"
                   value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
          </div>

          <div className="his-field-group">
            <label className="his-label">Refund Mode</label>
            <div className="rx-grid-5">
              {PAYMENT_MODES.map(m => (
                <button key={m} type="button"
                        className={`rx-slot ${mode === m ? "rx-slot--selected" : ""}`}
                        onClick={() => setMode(m)}>{m}</button>
              ))}
            </div>
          </div>

          <div className="his-field-group">
            <label className="his-label">Reason *</label>
            <textarea className="his-textarea" rows={3} value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="e.g. Service not rendered, duplicate charge, patient complaint…" />
          </div>

          <div className="rx-grid-2">
            <div className="his-field-group">
              <label className="his-label">Refunded By</label>
              <input className="his-field" value={refundedBy} onChange={e => setRefundedBy(e.target.value)} placeholder="Reception staff name" />
            </div>
            {mode !== "CASH" && (
              <div className="his-field-group">
                <label className="his-label">{mode === "UPI" ? "UPI Reference" : mode === "CHEQUE" ? "Cheque #" : "Transaction ID"}</label>
                <input className="his-field" value={txnId} onChange={e => setTxnId(e.target.value)} />
              </div>
            )}
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Keep Payment</button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--danger" onClick={submit} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-undo"}`} /> Confirm Refund
          </button>
        </div>
      </div>
    </div>
  );
}

function CancelBillModal({ bill, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [cancelledBy, setCancelledBy] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason.trim()) return toast.error("Cancellation reason is mandatory");
    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${bill._id}/cancel`, {
        reason: reason.trim(),
        cancelledBy: cancelledBy || undefined,
      });
      toast.success("Bill cancelled");
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Cancel failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--neutral">
          <i className="pi pi-ban" />
          <span className="rx-modal-title">Cancel Bill — {bill.billNumber}</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="rx-banner rx-banner--neutral">
            ⚠ Cancellation is permanent. Only allowed when no payment has been collected. For collected bills, issue a refund instead.
          </div>
          <div className="his-field-group">
            <label className="his-label">Cancellation Reason *</label>
            <textarea className="his-textarea" rows={3} value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="e.g. Duplicate bill, wrong patient, services not rendered" />
          </div>
          <div className="his-field-group">
            <label className="his-label">Cancelled By</label>
            <input className="his-field" value={cancelledBy} onChange={e => setCancelledBy(e.target.value)} placeholder="Reception staff name" />
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Keep Bill</button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--neutral" onClick={submit} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-ban"}`} /> Confirm Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */
/* Print receipt — opens a simple printable window                */

function receiptHTML(bill, patient) {
  const items = (bill.billItems || []).map(it => `
    <tr>
      <td>${escapeHtml(it.serviceName || it.name)}</td>
      <td style="text-align:right">${it.quantity || 1}</td>
      <td style="text-align:right">${fmtCur(it.unitPrice)}</td>
      <td style="text-align:right">${fmtCur(it.netAmount)}</td>
    </tr>`).join("");

  const payments = (bill.payments || []).map(p => `
    <tr>
      <td>${fmtDateTime(p.paidAt)}</td>
      <td>${escapeHtml(p.paymentMode || "")}</td>
      <td>${escapeHtml(p.transactionId || "—")}</td>
      <td style="text-align:right">${fmtCur(p.amount)}</td>
    </tr>`).join("");

  return `<!doctype html><html><head><title>Receipt ${bill.billNumber}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; color: #0f172a; font-size: 13px; }
    h1 { font-size: 22px; margin: 0; }
    .meta { color: #64748b; font-size: 11px; margin-bottom: 14px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 12px; }
    th, td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; }
    th { background: #f8fafc; font-weight: 700; }
    .totals { text-align: right; font-size: 13px; margin-top: 10px; }
    .totals .row { display:flex; justify-content:flex-end; gap:14px; margin-bottom:3px; }
    .totals strong { display:inline-block; min-width:120px; text-align:right; }
    .pill { display:inline-block; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700; background:#ecfeff; color:#0e7490; }
    .footer { margin-top: 24px; padding-top: 10px; border-top: 1px dashed #cbd5e1; font-size: 10px; color:#94a3b8; text-align:center; }
  </style></head><body>
    <h1>SphereHealth Hospital</h1>
    <div class="meta">NABH Accredited · Receipt of payment</div>
    <hr>
    <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
      <div>
        <strong>Patient:</strong> ${escapeHtml(patient?.fullName || "—")}<br>
        <strong>UHID:</strong> ${escapeHtml(patient?.UHID || "—")}<br>
        <strong>Mobile:</strong> ${escapeHtml(patient?.contactNumber || "—")}
      </div>
      <div style="text-align:right">
        <strong>Bill #:</strong> ${escapeHtml(bill.billNumber || "—")}<br>
        <strong>Status:</strong> <span class="pill">${escapeHtml(bill.billStatus || "")}</span><br>
        <strong>Date:</strong> ${fmtDate(bill.createdAt)}<br>
        <strong>Type:</strong> ${escapeHtml(bill.visitType || "OPD")}
      </div>
    </div>

    <table><thead><tr><th>Service</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Net</th></tr></thead>
    <tbody>${items}</tbody></table>

    <div class="totals">
      <div class="row"><span>Gross:</span><strong>${fmtCur(bill.grossAmount)}</strong></div>
      <div class="row"><span>Discount:</span><strong>− ${fmtCur(bill.totalDiscount)}</strong></div>
      <div class="row"><span>Tax:</span><strong>${fmtCur(bill.taxAmount)}</strong></div>
      <div class="row"><span><strong>Net Payable:</strong></span><strong>${fmtCur(bill.netAmount)}</strong></div>
      <div class="row" style="color:#15803d"><span>Paid:</span><strong>${fmtCur((bill.netAmount || 0) - (bill.balanceAmount || 0))}</strong></div>
      <div class="row" style="color:#b91c1c"><span><strong>Balance Due:</strong></span><strong>${fmtCur(bill.balanceAmount)}</strong></div>
    </div>

    ${payments ? `<h3 style="margin-top:18px; font-size:13px;">Payments</h3>
    <table><thead><tr><th>Date</th><th>Mode</th><th>Reference</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${payments}</tbody></table>` : ""}

    <div class="footer">
      Receipt generated by Reception · ${new Date().toLocaleString("en-IN")}<br>
      This is a computer-generated receipt. Thank you for choosing SphereHealth.
    </div>
  </body></html>`;
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

/* ═══════════════════════════════════════════════════════════════
   PatientDirectory — tabbed list of active patients by registration
   type. Renders when no patient is selected, so the cashier sees the
   day's customers right away (typical OPD volume) and clicks a row
   instead of typing a UHID.
═══════════════════════════════════════════════════════════════ */
function PatientDirectory({ listType, setListType, rows, loading, onPick }) {
  // Tabs mirror the registrationType enum on Patient model.
  const TYPES = [
    { key: "OPD",       label: "OPD",        icon: "pi-user-plus",     color: "#06b6d4" },
    { key: "IPD",       label: "IPD",        icon: "pi-home",          color: "#7c3aed" },
    { key: "Daycare",   label: "Day Care",   icon: "pi-sun",           color: "#d97706" },
    { key: "Emergency", label: "Emergency",  icon: "pi-bolt",          color: "#dc2626" },
    { key: "Services",  label: "Services",   icon: "pi-cog",           color: "#0e7490" },
    { key: "ALL",       label: "All Types",  icon: "pi-list",          color: "#475569" },
  ];

  return (
    <>
      {/* Tab strip */}
      <div style={{
        display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap",
        background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12,
        padding: 6,
      }}>
        {TYPES.map(t => {
          const active = listType === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setListType(t.key)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", border: 0, borderRadius: 8,
                background: active ? `linear-gradient(135deg, ${t.color}, ${t.color}dd)` : "transparent",
                color: active ? "#fff" : "#475569",
                fontFamily: "inherit", fontSize: 12, fontWeight: 700,
                cursor: "pointer", transition: "all 0.15s ease",
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#f1f5f9"; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <i className={`pi ${t.icon}`} style={{ fontSize: 12 }} /> {t.label}
            </button>
          );
        })}
        <span style={{
          marginLeft: "auto", padding: "8px 12px", fontSize: 11,
          fontWeight: 700, color: "#64748b", letterSpacing: 0.3,
        }}>
          {loading ? "Loading…" : `${rows.length} patient${rows.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* Patient grid */}
      {loading && rows.length === 0 ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : rows.length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">👥</span>
          No active {listType === "ALL" ? "" : listType} patients yet today.
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))",
          gap: 10,
        }}>
          {rows.map(p => (
            <button
              key={p._id}
              onClick={() => onPick(p)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px",
                background: "#fff", border: "1px solid #e2e8f0",
                borderRadius: 10, cursor: "pointer",
                fontFamily: "inherit", textAlign: "left",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = "#06b6d4";
                e.currentTarget.style.boxShadow = "0 4px 12px rgba(8, 145, 178, 0.12)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "#e2e8f0";
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.transform = "none";
              }}
            >
              <div style={{
                width: 38, height: 38, borderRadius: "50%",
                background: "linear-gradient(135deg, #0891b2, #06b6d4)",
                color: "#fff", fontWeight: 800, fontSize: 13,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                {String(p.fullName || "?").trim().split(/\s+/).slice(0,2).map(x => x[0] || "").join("").toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 700, color: "#0f172a", fontSize: 13,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {p.title ? `${p.title} ` : ""}{p.fullName}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 2 }}>
                  <span className="rx-mono-tag rx-mono-tag--subtle">{p.UHID}</span>
                  {p.contactNumber && <span>📱 {p.contactNumber}</span>}
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                  {p.age != null && `${p.age}y · `}{p.gender || ""}
                  {p.lastVisitDate && ` · Last visit ${new Date(p.lastVisitDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`}
                </div>
              </div>
              {p.registrationType && (
                <span className="rx-mode-pill" style={{ fontSize: 10, padding: "2px 8px", flexShrink: 0 }}>
                  {p.registrationType}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AddServiceModal — searchable ServiceMaster picker for DRAFT bills
   The receptionist taps "Add Service" on a DRAFT OPD bill mid-visit
   (e.g. patient needs an ECG, dressing, nebulisation). The modal:
     1. Live-searches /api/services?search=…&applicableTo=<visitType>
     2. Lists matching services with code · name · billingType · price
     3. Click "Add" → POST /api/billing/:billId/add-service
     4. Bill is reloaded behind the modal; running total updates.
     5. Modal stays open so multiple services can be added in one go.
   Backend gates additions to DRAFT bills only (audit F-05 lock); the
   button itself is only shown for DRAFT, so the UX never offers an
   action the server will reject.
═══════════════════════════════════════════════════════════════ */
function AddServiceModal({ bill, onClose, onChanged }) {
  const [query,    setQuery]    = useState("");
  const [results,  setResults]  = useState([]);
  const [domain,   setDomain]   = useState(bill.visitType || "OPD");
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState(null);
  const [savingId, setSavingId] = useState(null);
  const debRef = React.useRef(null);

  // Live-debounced search. Empty query loads the most-common 50 for
  // the chosen domain so the cashier can browse without typing.
  React.useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      setBusy(true);
      setErr(null);
      try {
        const params = new URLSearchParams({ limit: "60", isActive: "true" });
        if (query.trim().length >= 2) params.set("search", query.trim());
        if (domain && domain !== "ALL") params.set("applicableTo", domain);
        const { data } = await axios.get(`${API_ENDPOINTS.BASE}/services?${params.toString()}`);
        const list = data?.data || data?.services || [];
        setResults(Array.isArray(list) ? list : []);
      } catch (e) {
        setErr(e?.response?.data?.message || "Search failed");
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [query, domain]);

  const add = async (svc) => {
    setSavingId(svc._id);
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${bill._id}/add-service`, {
        serviceId: svc._id,
        quantity: 1,
      });
      toast.success(`${svc.serviceName} added`);
      onChanged && onChanged();
    } catch (e) {
      const msg = e?.response?.data?.message || "Could not add service";
      toast.error(msg);
    } finally {
      setSavingId(null);
    }
  };

  const billItemCount = (bill.billItems || []).length;
  const currentTotal  = Number(bill.netAmount) || 0;

  return (
    <div className="rx-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rx-modal" style={{ maxWidth: 720, maxHeight: "90vh" }}>
        <div className="rx-modal-head">
          <i className="pi pi-plus-circle" /> Add Service to Bill
          <button className="rx-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="rx-modal-body" style={{ padding: "12px 16px", gap: 10 }}>
          {/* Bill context bar */}
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#475569", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <strong>{bill.billNumber || "DRAFT"}</strong>
              {" · "}<span className="rx-mono-tag rx-mono-tag--subtle">{bill.visitType}</span>
              {" · "}{billItemCount} item{billItemCount === 1 ? "" : "s"}
            </div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 800, color: "#0f172a" }}>
              Running total: {fmtCur(currentTotal)}
            </div>
          </div>

          {/* Search bar + domain filter */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
            <div className="rx-search" style={{ marginBottom: 0, flex: 1 }}>
              <i className="pi pi-search" />
              <input autoFocus
                     value={query}
                     onChange={(e) => setQuery(e.target.value)}
                     placeholder="Search service name or code (e.g. ECG, dressing, NRS-001)…" />
            </div>
            <select value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 10, fontSize: 13, background: "#fff", minWidth: 110 }}
                    title="Filter by where the service is applicable">
              <option value="OPD">OPD</option>
              <option value="IPD">IPD</option>
              <option value="DAYCARE">Day Care</option>
              <option value="EMERGENCY">Emergency</option>
              <option value="ALL">All</option>
            </select>
          </div>

          {err && (
            <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#b91c1c", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
              {err}
            </div>
          )}

          {/* Result list */}
          <div style={{ maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
            {busy && results.length === 0 ? (
              <div style={{ textAlign: "center", color: "#94a3b8", padding: "20px 0", fontSize: 13 }}>
                <i className="pi pi-spin pi-spinner" /> Searching…
              </div>
            ) : results.length === 0 ? (
              <div style={{ textAlign: "center", color: "#94a3b8", padding: "20px 0", fontSize: 13 }}>
                No services match "{query || "(all)"}"
              </div>
            ) : results.map((s) => (
              <div key={s._id}
                   style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="rx-mono-tag">{s.serviceCode}</span>
                    <span style={{ fontWeight: 600, color: "#0f172a", fontSize: 13 }}>{s.serviceName}</span>
                    {s.isAutoCharged && <span className="rx-mode-pill" style={{ background: "#fff7ed", color: "#c2410c", borderColor: "#fed7aa" }}>AUTO</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {s.category} · {s.billingType} · {s.unitLabel || "unit"}
                    {s.domain && ` · ${s.domain}`}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 90, fontFamily: "'DM Mono', monospace", fontWeight: 800, color: "#0f172a", fontSize: 14 }}>
                  {fmtCur(s.defaultPrice)}
                </div>
                <button
                  className="rx-action-btn rx-action-btn--primary"
                  onClick={() => add(s)}
                  disabled={savingId === s._id}
                  title={`Add ${s.serviceName} to ${bill.billNumber || "draft"}`}
                  style={{ minWidth: 70 }}
                >
                  {savingId === s._id ? <><i className="pi pi-spin pi-spinner" /> </> : <><i className="pi pi-plus" /> Add</>}
                </button>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 8, padding: "8px 12px", background: "#ecfeff", color: "#0e7490", border: "1px solid #67e8f9", borderRadius: 8, fontSize: 11, lineHeight: 1.5 }}>
            <i className="pi pi-info-circle" /> Items can only be added while the bill is <strong>DRAFT</strong>.
            Once you click <strong>Generate Bill</strong>, it locks for the cashier &mdash; any later
            additions need the amendment workflow (Accountant tier).
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-action-btn rx-action-btn--primary" onClick={onClose}>
            <i className="pi pi-check" /> Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TakeAdvanceModal — cash/UPI/card deposit before bills exist
   Posts to /api/billing/advance, switches to success state with a
   Print Receipt button, then refreshes the parent on Done.
═══════════════════════════════════════════════════════════════ */
function TakeAdvanceModal({ patient, onClose, onSaved }) {
  const [amount, setAmount] = useState("");
  const [mode,   setMode]   = useState("CASH");
  const [txnId,  setTxnId]  = useState("");
  const [bank,   setBank]   = useState("");
  const [remarks,setRemarks]= useState("");
  const [err,    setErr]    = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAdv, setSavedAdv] = useState(null);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Enter a valid amount"); return; }
    if (mode !== "CASH" && !txnId) { setErr(`Transaction reference required for ${mode}`); return; }
    setErr(null);
    setSaving(true);
    try {
      const { data } = await axios.post(`${API_ENDPOINTS.BILLING}/advance`, {
        UHID: patient.UHID,
        amount: amt,
        paymentMode: mode,
        transactionId: txnId || null,
        bankName: bank || null,
        remarks: remarks || null,
      });
      setSavedAdv(data?.data || null);
    } catch (e) {
      setErr(e?.response?.data?.message || e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (savedAdv) {
    const amt = Number(savedAdv.amount?.$numberDecimal ?? savedAdv.amount) || 0;
    return (
      <div className="rx-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onSaved && onSaved(); }}>
        <div className="rx-modal">
          <div className="rx-modal-head" style={{ background: "linear-gradient(135deg, #15803d, #16a34a)" }}>
            <i className="pi pi-check-circle" style={{ color: "#bbf7d0" }} /> Advance Received
            <button className="rx-modal-close" onClick={() => onSaved && onSaved()}>✕</button>
          </div>
          <div className="rx-modal-body">
            <div style={{ background: "linear-gradient(135deg, #fef9c3, #fde68a)", border: "2px solid #facc15", borderRadius: 12, padding: "18px 20px", textAlign: "center" }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 800, color: "#92400e", letterSpacing: 0.5, textTransform: "uppercase" }}>{savedAdv.receiptNumber}</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 32, fontWeight: 900, color: "#713f12", lineHeight: 1.1, marginTop: 6 }}>{fmtCur(amt)}</div>
              <div style={{ fontSize: 12, color: "#92400e", marginTop: 4, fontWeight: 600 }}>
                {savedAdv.paymentMode}{savedAdv.transactionId ? ` · ref ${savedAdv.transactionId}` : ""}
              </div>
              <div style={{ fontSize: 12, color: "#92400e", marginTop: 4, fontWeight: 600 }}>
                from {patient.title ? patient.title + " " : ""}{patient.fullName} ({patient.UHID})
              </div>
            </div>
            <div style={{ marginTop: 12, padding: "10px 12px", background: "#ecfeff", color: "#0e7490", border: "1px solid #67e8f9", borderRadius: 8, fontSize: 11, lineHeight: 1.5 }}>
              <i className="pi pi-info-circle" /> This credit is now on the UHID with status <strong>ACTIVE</strong>.
              Click <strong>Apply Advance</strong> on any open bill to consume from it.
            </div>
          </div>
          <div className="rx-modal-foot">
            <button className="rx-action-btn" onClick={() => onSaved && onSaved()}>Done</button>
            <button className="rx-action-btn rx-action-btn--primary"
                    onClick={() => printAdvanceReceipt(savedAdv, patient)}>
              <i className="pi pi-print" /> Print Receipt
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rx-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rx-modal">
        <div className="rx-modal-head">
          <i className="pi pi-wallet" /> Take Advance Deposit
          <button className="rx-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="rx-modal-body">
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#0f172a" }}>
            <strong>{patient.title ? `${patient.title} ` : ""}{patient.fullName}</strong>
            <div style={{ fontSize: 11, color: "#64748b" }}>{patient.UHID} · {patient.contactNumber || "no phone"}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Amount (₹) *</div>
              <input type="number" min="1" autoFocus
                     value={amount}
                     onChange={(e) => setAmount(e.target.value)}
                     placeholder="e.g. 10000"
                     style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Payment Mode *</div>
              <select value={mode} onChange={(e) => setMode(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, background: "#fff" }}>
                {ADVANCE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {mode !== "CASH" && (
              <div style={{ gridColumn: "span 2" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>
                  {mode === "CHEQUE" ? "Cheque No" : mode === "CARD" ? "Card Auth / Last 4" : "Transaction Reference"} *
                </div>
                <input value={txnId} onChange={(e) => setTxnId(e.target.value)}
                       placeholder={mode === "UPI" ? "UPI ref id (12 digits)" : ""}
                       style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }} />
              </div>
            )}
            {(mode === "CHEQUE" || mode === "ONLINE") && (
              <div style={{ gridColumn: "span 2" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Bank Name</div>
                <input value={bank} onChange={(e) => setBank(e.target.value)}
                       placeholder="e.g. HDFC, SBI"
                       style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }} />
              </div>
            )}
            <div style={{ gridColumn: "span 2" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Remarks</div>
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)}
                     placeholder="e.g. IPD admission deposit"
                     style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }} />
            </div>
          </div>

          {err && <div style={{ marginTop: 10, padding: "8px 12px", background: "#fef2f2", color: "#b91c1c", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{err}</div>}

          <div style={{ marginTop: 12, padding: "10px 12px", background: "#ecfeff", color: "#0e7490", border: "1px solid #67e8f9", borderRadius: 8, fontSize: 11, lineHeight: 1.5 }}>
            <i className="pi pi-info-circle" /> Deposit lands on this UHID as <strong>ADV-YYYY-NNNNNN</strong> with
            status <strong>ACTIVE</strong>. Click <strong>Apply Advance</strong> on a generated bill to consume credit.
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-action-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="rx-action-btn rx-action-btn--primary"
                  onClick={submit}
                  disabled={saving || !amount || Number(amount) <= 0}>
            <i className="pi pi-check" /> {saving ? "Saving…" : "Save Deposit"}
          </button>
        </div>
      </div>
    </div>
  );
}
