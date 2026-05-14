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
  const [todayCollection, setTodayCollection] = useState(null);

  const load = useCallback(async (uhidArg) => {
    if (!uhidArg) return;
    setLoading(true);
    setPatient(null); setBills([]); setActiveBill(null);
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.BILLING}/uhid/${uhidArg}`);
      const p = data?.patient || data?.data?.patient;
      const list = data?.bills || data?.data?.bills || [];
      if (!p) { toast.warning("No patient found for that UHID"); setLoading(false); return; }
      setPatient(p);
      setBills(list);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load bills");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (paramUhid) load(paramUhid); }, [paramUhid, load]);

  // Today's collection summary — small live tile.
  // Response shape: { success, date, summary: { totalCollected, totalGross, ... } }
  useEffect(() => {
    axios.get(`${API_ENDPOINTS.BILLING}/collection-summary?date=${new Date().toISOString().slice(0, 10)}`)
      .then(({ data }) => setTodayCollection(data?.summary || data?.data?.summary || null))
      .catch(() => {});
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

      {/* UHID search bar */}
      <div className="rx-search rx-mb-14">
        <i className="pi pi-id-card" />
        <input
          placeholder="Enter UHID (e.g. UH0001) and press Enter"
          value={uhid}
          onChange={e => setUhid(e.target.value)}
          onKeyDown={e => e.key === "Enter" && load(uhid)}
        />
        <button className="rx-btn-primary rx-btn-compact" onClick={() => load(uhid)}>
          <i className="pi pi-search" /> Load
        </button>
      </div>

      {loading ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : !patient ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">🧾</span>
          Enter a UHID above to view & manage that patient's bills.
        </div>
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
              <button className="rx-action-btn"
                      onClick={() => navigate(`/visit-history/${patient.UHID}`)}>
                <i className="pi pi-clock" /> History
              </button>
            </div>
          </div>

          {/* KPI strip */}
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
          </div>

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
                  onGenerate={() => generateBill(activeBill._id)}
                  onPay={() => setPayTarget(activeBill)}
                  onPrint={() => printReceipt(activeBill)}
                  onRefund={() => setRefundTarget(activeBill)}
                  onCancel={() => setCancelTarget(activeBill)}
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

function BillDetail({ bill, onGenerate, onPay, onPrint, onRefund, onCancel }) {
  const { can } = useAuth();
  const isDraft   = bill.billStatus === "DRAFT";
  const canPay    = ["GENERATED", "PARTIAL"].includes(bill.billStatus);
  const items     = bill.billItems || [];
  const payments  = bill.payments || [];
  const paidTotal = payments.reduce((s, p) => s + (p.amount || 0), 0);
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
        {isDraft && (
          <button className="rx-action-btn rx-action-btn--primary" onClick={onGenerate}>
            <i className="pi pi-check" /> Generate Bill
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
