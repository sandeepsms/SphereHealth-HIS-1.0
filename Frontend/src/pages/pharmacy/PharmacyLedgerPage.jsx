/**
 * PharmacyLedgerPage.jsx (R7hr-3)
 *
 * Pharmacist-scoped IPD ledger. Surfaces ONLY the pharmacy slice for a
 * single admission:
 *   - Patient header (name / UHID / IPD No / bed / consultant)
 *   - Day-wise medicines dispensed with per-day subtotal + per-bill rows
 *   - Pharmacy outstanding (running balance)
 *   - "Collect Payment" panel — Cash / Card / UPI with txn refs
 *   - "Take Advance Deposit" panel — patient credit pool
 *
 * Deliberately DOES NOT show: bed charges, doctor visits, nursing,
 * services, equipment, consumables, lab / radiology, full hospital
 * outstanding. The pharmacist never sees the complete hospital bill —
 * only what they can act on (medicines + payment + advance).
 *
 * Routed at /pharmacy/ledger/:admissionId. Query params (passed from
 * the Live Indents page) optionally seed patient details so the page
 * renders identity instantly while sales fetch in the background.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { fmtINR } from "../../Components/print/amountWords";

const C = {
  bg:     "#f8fafc",
  card:   "#ffffff",
  border: "#e2e8f0",
  text:   "#0f172a",
  muted:  "#64748b",
  orange: "#ea580c",
  green:  "#15803d",
  blue:   "#1d4ed8",
  red:    "#b91c1c",
  amber:  "#a16207",
};

const dec = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  if (typeof v === "object" && v.$numberDecimal) return parseFloat(v.$numberDecimal) || 0;
  return 0;
};

const dateKey = (d) => new Date(d).toLocaleDateString("en-CA"); // YYYY-MM-DD for sorting
const dateLabel = (d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", weekday: "short" });

export default function PharmacyLedgerPage() {
  const { admissionId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();

  // Patient identity (seeded from query string when available)
  const [patient, setPatient] = useState({
    UHID:            search.get("uhid") || "",
    patientName:     search.get("name") || "",
    admissionNumber: search.get("ipd")  || "",
    bed:             search.get("bed")  || "",
    consultant:      search.get("doc")  || "",
  });

  const [sales, setSales]       = useState([]);
  const [advances, setAdvances] = useState([]);
  const [loading, setLoading]   = useState(true);

  // Collect Payment modal state
  const [collect, setCollect]   = useState(null); // { sale, max }
  const [colAmt, setColAmt]     = useState("");
  const [colMode, setColMode]   = useState("Cash");
  const [colTxn, setColTxn]     = useState("");
  const [colSaving, setColSaving] = useState(false);

  // Take Advance modal state
  const [advOpen, setAdvOpen]   = useState(false);
  const [advAmt, setAdvAmt]     = useState("");
  const [advMode, setAdvMode]   = useState("Cash");
  const [advTxn, setAdvTxn]     = useState("");
  const [advSaving, setAdvSaving] = useState(false);

  const load = async () => {
    if (!patient.UHID) {
      // Without a UHID we can't pull sales (the credit endpoint groups
      // by admissionId but doesn't return the per-sale detail). Show
      // a banner and the back button.
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Pull all pharmacy sales for this UHID, then filter to this
      // admission. Avoids needing a new backend endpoint and keeps
      // the contract identical to the OPD Rx page's dup-dispense
      // lookup added in R7hp-4.
      const [salesR, advR] = await Promise.all([
        axios.get(`${API_ENDPOINTS.BASE}/pharmacy/sales`, { params: { uhid: patient.UHID, limit: 500 } }),
        axios.get(`${API_ENDPOINTS.BASE}/billing/advance/uhid/${encodeURIComponent(patient.UHID)}`).catch(() => ({ data: { data: [] } })),
      ]);
      const allSales = salesR?.data?.data || [];
      // Filter to this admission (sales carry admissionId) and exclude
      // cancelled rows so the ledger reflects active charges only.
      const adm = String(admissionId);
      const mine = allSales.filter(s =>
        String(s.admissionId || "") === adm && s.status !== "Cancelled"
      );
      setSales(mine);
      // /billing/advance/uhid/:uhid varies in shape across builds — could
      // return an array directly, { data: [...] }, { data: { items: [...] }},
      // or a single summary object. Normalise to an array so the reduce()
      // in totals never throws.
      const advRaw = advR?.data?.data ?? advR?.data ?? [];
      const advArr = Array.isArray(advRaw)
        ? advRaw
        : Array.isArray(advRaw?.items)    ? advRaw.items
        : Array.isArray(advRaw?.advances) ? advRaw.advances
        : Array.isArray(advRaw?.deposits) ? advRaw.deposits
        : advRaw && typeof advRaw === "object"
          ? [advRaw]   // single summary object — wrap so KPI shows it
          : [];
      setAdvances(advArr);
      // If patient identity wasn't passed, hydrate from the first sale.
      if (mine[0] && !patient.patientName) {
        setPatient(p => ({
          ...p,
          patientName: mine[0].patientName || p.patientName,
          admissionNumber: mine[0].admissionNumber || p.admissionNumber,
        }));
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message || "Failed to load pharmacy ledger");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [admissionId, patient.UHID]);

  /* ── Derived totals (pharmacy only) ─────────────────────────── */
  const totals = useMemo(() => {
    let billed = 0, paid = 0, outstanding = 0;
    for (const s of sales) {
      billed      += dec(s.grandTotal);
      paid        += dec(s.amountPaid);
      outstanding += dec(s.balanceDue);
    }
    const advanceBalance = advances.reduce((sum, a) => sum + dec(a.remainingAmount ?? a.balance ?? a.amount), 0);
    return { billed, paid, outstanding, advanceBalance };
  }, [sales, advances]);

  /* ── Group by day for day-wise view ─────────────────────────── */
  const byDay = useMemo(() => {
    const m = new Map();
    for (const s of sales) {
      const k = dateKey(s.createdAt);
      const cur = m.get(k) || { date: s.createdAt, sales: [], total: 0, paid: 0, due: 0 };
      cur.sales.push(s);
      cur.total += dec(s.grandTotal);
      cur.paid  += dec(s.amountPaid);
      cur.due   += dec(s.balanceDue);
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)));
  }, [sales]);

  /* ── Collect Payment submit ─────────────────────────────────── */
  const submitCollect = async () => {
    const amt = Number(colAmt);
    if (!Number.isFinite(amt) || amt <= 0) return toast.warn("Enter an amount > 0");
    if (collect && amt > collect.max + 0.01) return toast.warn(`Amount exceeds bill outstanding (${fmtINR(collect.max)})`);
    setColSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/pharmacy/sales/${collect.sale._id}/collect-credit`, {
        amount: amt, mode: colMode, txnRef: colTxn,
      });
      toast.success(`Collected ${fmtINR(amt)} via ${colMode}`);
      setCollect(null); setColAmt(""); setColTxn("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message);
    } finally { setColSaving(false); }
  };

  /* ── Take Advance Deposit submit ────────────────────────────── */
  const submitAdvance = async () => {
    const amt = Number(advAmt);
    if (!Number.isFinite(amt) || amt <= 0) return toast.warn("Enter an amount > 0");
    setAdvSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/billing/advance`, {
        UHID: patient.UHID,
        admissionId,
        amount: amt,
        paymentMode: advMode,
        paymentRef: advTxn,
        purpose: "Pharmacy advance",
        source: "Pharmacy",
      });
      toast.success(`Advance ${fmtINR(amt)} deposited`);
      setAdvOpen(false); setAdvAmt(""); setAdvTxn("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message);
    } finally { setAdvSaving(false); }
  };

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div style={{ padding: 18, background: C.bg, minHeight: "100vh" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
          <div>
            <button onClick={() => navigate(-1)} style={{
              padding: "5px 12px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`,
              borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600, marginBottom: 10,
            }}>
              <i className="pi pi-arrow-left" style={{ marginRight: 5 }} /> Back
            </button>
            <h1 style={{ margin: 0, fontSize: 22, color: C.text, fontWeight: 800 }}>
              <i className="pi pi-receipt" style={{ marginRight: 8, color: C.orange }} />
              Pharmacy Ledger
            </h1>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              Pharmacy charges only · Hospital-wide bill is not visible here
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setAdvOpen(true)} style={{
              padding: "9px 16px", background: "#fff", color: C.blue, border: `1.5px solid ${C.blue}`,
              borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer",
            }}>
              <i className="pi pi-plus-circle" style={{ marginRight: 6 }} /> Take Advance
            </button>
            <button onClick={load} style={{
              padding: "9px 14px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`,
              borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer",
            }}>
              <i className="pi pi-refresh" style={{ marginRight: 4 }} /> Refresh
            </button>
          </div>
        </div>

        {/* Patient banner */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14,
          marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14,
        }}>
          <div>
            <div style={{ fontSize: 9.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>Patient</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginTop: 2 }}>{patient.patientName || "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 9.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>UHID · IPD No</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
              {patient.UHID} · {patient.admissionNumber || "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>Bed</div>
            <div style={{ fontSize: 13, color: C.text, marginTop: 2 }}>{patient.bed || "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 9.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>Consultant</div>
            <div style={{ fontSize: 13, color: C.text, marginTop: 2 }}>{patient.consultant || "—"}</div>
          </div>
        </div>

        {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
          {[
            { label: "Pharmacy Billed",      value: totals.billed,      color: C.text,   icon: "pi-shopping-cart" },
            { label: "Collected (Pharmacy)", value: totals.paid,        color: C.green,  icon: "pi-check-circle" },
            { label: "Outstanding",          value: totals.outstanding, color: C.red,    icon: "pi-exclamation-triangle" },
            { label: "Advance Balance",      value: totals.advanceBalance, color: C.blue, icon: "pi-wallet" },
          ].map((k, i) => (
            <div key={i} style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14,
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, background: `${k.color}15`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <i className={`pi ${k.icon}`} style={{ fontSize: 18, color: k.color }} />
              </div>
              <div>
                <div style={{ fontSize: 9.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: k.color, marginTop: 2 }}>{fmtINR(k.value)}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Day-wise medicines */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
          <div style={{
            padding: "12px 16px", borderBottom: `1px solid ${C.border}`, background: "#fafbfc",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.text }}>
              <i className="pi pi-calendar" style={{ marginRight: 6, color: C.orange }} />
              Medicines Dispensed — Day-wise
            </h2>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
              {sales.length} bill{sales.length === 1 ? "" : "s"} · {byDay.length} day{byDay.length === 1 ? "" : "s"}
            </div>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: C.muted }}>Loading…</div>
          ) : byDay.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: C.muted, fontStyle: "italic" }}>
              No pharmacy charges for this admission yet.
            </div>
          ) : (
            byDay.map(day => (
              <div key={dateKey(day.date)} style={{ borderBottom: `1px solid ${C.border}` }}>
                <div style={{
                  padding: "10px 16px", background: "#fcfcfd",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  borderBottom: `1px dashed ${C.border}`,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                    <i className="pi pi-calendar-times" style={{ marginRight: 6, color: C.orange, fontSize: 11 }} />
                    {dateLabel(day.date)}
                  </div>
                  <div style={{ display: "flex", gap: 18, fontSize: 11, color: C.muted, fontWeight: 600 }}>
                    <span>Billed: <strong style={{ color: C.text }}>{fmtINR(day.total)}</strong></span>
                    <span>Paid: <strong style={{ color: C.green }}>{fmtINR(day.paid)}</strong></span>
                    {day.due > 0 && <span>Due: <strong style={{ color: C.red }}>{fmtINR(day.due)}</strong></span>}
                  </div>
                </div>
                {day.sales.map(sale => {
                  const due = dec(sale.balanceDue);
                  return (
                    <div key={sale._id} style={{ padding: "10px 16px", borderBottom: `1px dashed ${C.border}` }}>
                      <div style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        fontSize: 12, marginBottom: 6,
                      }}>
                        <div>
                          <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, color: C.text }}>
                            {sale.billNumber}
                          </span>
                          <span style={{ color: C.muted, marginLeft: 8 }}>
                            {new Date(sale.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span style={{
                            marginLeft: 8, padding: "1px 7px", borderRadius: 8, fontSize: 9.5, fontWeight: 700,
                            background: due > 0 ? "#fef3c7" : "#dcfce7",
                            color:      due > 0 ? "#a16207" : "#15803d",
                            textTransform: "uppercase", letterSpacing: ".3px",
                          }}>
                            {due > 0 ? "Partial" : "Paid"}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                          <span style={{ color: C.muted, fontSize: 11 }}>
                            Total <strong style={{ color: C.text }}>{fmtINR(sale.grandTotal)}</strong> ·
                            Paid <strong style={{ color: C.green, marginLeft: 4 }}>{fmtINR(sale.amountPaid)}</strong> ·
                            Due <strong style={{ color: due > 0 ? C.red : C.muted, marginLeft: 4 }}>{fmtINR(due)}</strong>
                          </span>
                          {due > 0 && (
                            <button onClick={() => { setCollect({ sale, max: due }); setColAmt(due.toFixed(2)); }} style={{
                              padding: "4px 12px", background: C.green, color: "#fff", border: "none",
                              borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                            }}>
                              <i className="pi pi-money-bill" style={{ marginRight: 4, fontSize: 10 }} /> Collect
                            </button>
                          )}
                        </div>
                      </div>
                      {Array.isArray(sale.items) && sale.items.length > 0 && (
                        <div style={{ paddingLeft: 14, fontSize: 11, color: C.muted, display: "flex", gap: 12, flexWrap: "wrap" }}>
                          {sale.items.map((it, i) => (
                            <span key={i} style={{ background: "#f1f5f9", padding: "2px 8px", borderRadius: 4 }}>
                              {it.drugName || it.itemName} × {it.quantity}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Collect Payment modal ── */}
      {collect && (
        <div onClick={() => !colSaving && setCollect(null)} style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 50,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 12, width: 460, maxWidth: "92vw", padding: 22,
          }}>
            <h3 style={{ margin: "0 0 4px 0", color: C.green, fontSize: 16 }}>
              <i className="pi pi-money-bill" style={{ marginRight: 6 }} />
              Collect Payment
            </h3>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
              Bill {collect.sale.billNumber} · Outstanding <strong>{fmtINR(collect.max)}</strong>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Amount</label>
                <input type="number" autoFocus value={colAmt} onChange={e => setColAmt(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 700, marginTop: 3 }} />
              </div>
              <div>
                <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Mode</label>
                <select value={colMode} onChange={e => setColMode(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3 }}>
                  {["Cash","Card","UPI","Mixed"].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              {colMode !== "Cash" && (
                <div>
                  <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                    {colMode === "Card" ? "Card last-4 / ref" : "Txn reference"}
                  </label>
                  <input value={colTxn} onChange={e => setColTxn(e.target.value.slice(0, 64))}
                    placeholder={colMode === "Card" ? "•••• 1234" : "UTR / VPA / PSP ref"}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3, fontFamily: "'DM Mono', monospace" }} />
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => setCollect(null)} disabled={colSaving} style={{
                padding: "8px 16px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: colSaving ? "not-allowed" : "pointer",
              }}>Cancel</button>
              <button onClick={submitCollect} disabled={colSaving} style={{
                padding: "8px 18px", background: C.green, color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: colSaving ? "not-allowed" : "pointer",
              }}>
                <i className={`pi ${colSaving ? "pi-spin pi-spinner" : "pi-check"}`} style={{ marginRight: 5 }} />
                {colSaving ? "Saving…" : "Collect"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Take Advance modal ── */}
      {advOpen && (
        <div onClick={() => !advSaving && setAdvOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 50,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 12, width: 460, maxWidth: "92vw", padding: 22,
          }}>
            <h3 style={{ margin: "0 0 4px 0", color: C.blue, fontSize: 16 }}>
              <i className="pi pi-wallet" style={{ marginRight: 6 }} />
              Take Advance Deposit
            </h3>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
              {patient.patientName} · UHID {patient.UHID} · Pharmacy advance pool
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Amount</label>
                <input type="number" autoFocus value={advAmt} onChange={e => setAdvAmt(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontWeight: 700, marginTop: 3 }} />
              </div>
              <div>
                <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Mode</label>
                <select value={advMode} onChange={e => setAdvMode(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3 }}>
                  {["Cash","Card","UPI","Mixed"].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              {advMode !== "Cash" && (
                <div>
                  <label style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                    {advMode === "Card" ? "Card last-4 / ref" : "Txn reference"}
                  </label>
                  <input value={advTxn} onChange={e => setAdvTxn(e.target.value.slice(0, 64))}
                    placeholder={advMode === "Card" ? "•••• 1234" : "UTR / VPA / PSP ref"}
                    style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, marginTop: 3, fontFamily: "'DM Mono', monospace" }} />
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => setAdvOpen(false)} disabled={advSaving} style={{
                padding: "8px 16px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: advSaving ? "not-allowed" : "pointer",
              }}>Cancel</button>
              <button onClick={submitAdvance} disabled={advSaving} style={{
                padding: "8px 18px", background: C.blue, color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: advSaving ? "not-allowed" : "pointer",
              }}>
                <i className={`pi ${advSaving ? "pi-spin pi-spinner" : "pi-check"}`} style={{ marginRight: 5 }} />
                {advSaving ? "Saving…" : "Deposit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
