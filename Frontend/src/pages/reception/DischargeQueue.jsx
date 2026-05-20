/**
 * DischargeQueue.jsx — NABH discharge clearance for receptionist
 *
 * Workflow stages:
 *   DoctorApproved → BillCleared → GatePassIssued → Completed
 *
 * Receptionist clears the final bill and issues the gate pass.
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { openPrint } from "../../Components/print/openPrint";
import { useAuth } from "../../context/AuthContext";
import WhatsAppButton from "../../Components/whatsapp/WhatsAppButton";
import "./reception-shared.css";
import "../../Components/clinical/clinical-forms.css";

const fmtCur  = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function DischargeQueue() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [list,    setList]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState("DoctorApproved");
  const [search,  setSearch]  = useState("");
  const [clearing, setClearing] = useState(null); // admission being settled
  const [gateRow, setGateRow] = useState(null);   // admission ready for gate pass

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.BASE}/admissions/discharge-queue`);
      setList(data?.data || []);
    } catch (e) {
      // Surface error detail (E-06) — the user still sees a toast but
      // the server's reason lands in console for SOC tail.
      console.error("[DischargeQueue] load:", e?.response?.data?.message || e?.message);
      toast.error(e?.response?.data?.message || "Could not load discharge queue");
    }
    finally { setLoading(false); }
  }, []);
  // AbortController on the 30s polling loop — if the queue page
  // unmounts while a fetch is in flight, cancel it to avoid setState
  // on unmount (E-05).
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  // "Bill Cleared" bucket includes BOTH "BillCleared" (ready for gate pass)
  // and "GatePassIssued" (gate pass printed but admission not yet flipped to
  // Completed) so receptionists never lose track of mid-workflow admissions.
  const matchesTab = (a) => {
    const st = a.dischargeWorkflow?.stage;
    if (tab === "BillCleared") return st === "BillCleared" || st === "GatePassIssued";
    return st === tab;
  };

  const filtered = useMemo(() => {
    let r = list.filter(matchesTab);
    const s = search.trim().toLowerCase();
    if (s) r = r.filter(a =>
      (a.patientName || "").toLowerCase().includes(s) ||
      (a.UHID || "").toLowerCase().includes(s) ||
      (a.bedNumber || "").toLowerCase().includes(s)
    );
    return r;
  }, [list, tab, search]);

  const counts = {
    DoctorApproved:  list.filter(a => a.dischargeWorkflow?.stage === "DoctorApproved").length,
    BillCleared:     list.filter(a => ["BillCleared", "GatePassIssued"].includes(a.dischargeWorkflow?.stage)).length,
    Completed:       list.filter(a => a.dischargeWorkflow?.stage === "Completed").length,
  };

  return (
    <div className="rx-page">
      {/* Header */}
      <div className="rx-header">
        <div>
          <div className="rx-header-title"><i className="pi pi-sign-out" /> Discharge Queue</div>
          <div className="rx-header-meta">NABH COP.20 · Final-bill clearance before discharge</div>
        </div>
        <div className="rx-header-actions">
          <button className="rx-btn-ghost" onClick={load}><i className="pi pi-refresh" /> Refresh</button>
          <button className="rx-btn-primary" onClick={() => navigate("/reception")}>
            <i className="pi pi-arrow-left" /> Dashboard
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="rx-tabs">
        <button className={`rx-tab ${tab === "DoctorApproved" ? "rx-tab--active" : ""}`} onClick={() => setTab("DoctorApproved")}>
          <i className="pi pi-wallet" /> Pending Final Bill <span className="rx-tab-count">{counts.DoctorApproved}</span>
        </button>
        <button className={`rx-tab ${tab === "BillCleared" ? "rx-tab--active" : ""}`} onClick={() => setTab("BillCleared")}>
          <i className="pi pi-check" /> Bill Cleared — Ready <span className="rx-tab-count">{counts.BillCleared}</span>
        </button>
        <button className={`rx-tab ${tab === "Completed" ? "rx-tab--active" : ""}`} onClick={() => setTab("Completed")}>
          <i className="pi pi-flag" /> Discharged Today <span className="rx-tab-count">{counts.Completed}</span>
        </button>
      </div>

      {/* Search */}
      <div className="rx-search">
        <i className="pi pi-search" />
        <input placeholder="Search by name, UHID, or bed…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* List */}
      {loading ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : filtered.length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">📋</span>
          {tab === "DoctorApproved" ? "No discharge approvals from doctors yet." :
           tab === "BillCleared"    ? "No bills cleared — patients are still awaiting final billing." :
                                       "No discharges completed today."}
        </div>
      ) : filtered.map(adm => {
        const w = adm.dischargeWorkflow || {};
        const stageCls = w.stage === "DoctorApproved" ? "pending" :
                         w.stage === "BillCleared"    ? "cleared" :
                         w.stage === "Completed"      ? "done"    : "pending";
        return (
          <div key={adm._id} className="rx-card">
            <div className="rx-card-main">
              <div className="rx-card-name">
                {adm.patientName}
                <span className={`rx-card-stage rx-card-stage--${stageCls}`}>
                  {w.stage === "DoctorApproved" ? "Bill Pending" :
                   w.stage === "BillCleared"    ? "Ready for Gate Pass" :
                   w.stage === "Completed"      ? "Discharged" : w.stage}
                </span>
                {/* R7ar-P1-24/D9-aq-04: surface the post-discharge surplus
                    detected by the cascade. Cashier sees the chip → opens
                    the IPD ledger → routes the surplus through the standard
                    refund flow (which writes a CN + Day Book "Cash Out"). */}
                {Number(adm.dischargeOverage) > 0.5 && (
                  <span
                    className="rx-card-stage rx-card-stage--overage"
                    title={`Surplus ₹${Number(adm.dischargeOverage).toFixed(2)} owed to patient — open Live Ledger to refund`}
                  >
                    <i className="pi pi-exclamation-triangle" />{" "}
                    Refund Owed {fmtCur(adm.dischargeOverage)}
                  </span>
                )}
              </div>
              <div className="rx-card-meta">
                <span>UHID: <strong>{adm.UHID || "—"}</strong></span>
                <span>Bed: <strong>{adm.bedNumber || "—"}</strong></span>
                {/* `department` on Admission is a plain String; the populated
                    ref lives on `departmentId`. Fall back to the string if
                    the ref is missing on older rows. */}
                {(adm.departmentId?.departmentName || adm.department) && (
                  <span>Dept: <strong>{adm.departmentId?.departmentName || adm.department}</strong></span>
                )}
                <span>Doctor approved: <strong>{w.doctorApprovedBy || "Doctor"}</strong> @ {fmtDateTime(w.doctorApprovedAt)}</span>
                {w.finalBillAmount > 0 && <span>Bill: <strong>{fmtCur(w.finalBillAmount)}</strong></span>}
                {w.gatePassNumber && <span>Gate Pass: <strong>{w.gatePassNumber}</strong></span>}
              </div>
            </div>
            <div className="rx-card-actions">
              {/* Live Ledger — receptionist + accountant can always pop the
                  full charge breakdown for any admission in the queue, so
                  they can answer "what's on the bill?" before clearing. */}
              <button className="rx-action-btn" onClick={() => navigate(`/billing/ipd/${adm._id}`)}>
                <i className="pi pi-list" /> Live Ledger
              </button>
              {/* R7i: One-click jump to the complete patient file
                  (read-only paperless MRD). Available at every stage —
                  doctors / admin / MRD use this to review the entire
                  admission record (notes, MAR, vitals, labs, bills) without
                  having to dig through 8 different pages. */}
              <button className="rx-action-btn" onClick={() => navigate(`/patient-file/${adm.UHID}`)}>
                <i className="pi pi-folder-open" /> Medical Records
              </button>
              {w.stage === "DoctorApproved" && (
                <button className="rx-action-btn rx-action-btn--primary" onClick={() => setClearing(adm)}>
                  <i className="pi pi-wallet" /> Clear Final Bill
                </button>
              )}
              {w.stage === "BillCleared" && (
                <button className="rx-action-btn rx-action-btn--success" onClick={() => setGateRow(adm)}>
                  <i className="pi pi-id-card" /> Issue Gate Pass
                </button>
              )}
              {(w.stage === "BillCleared" || w.stage === "Completed") && (
                <button className="rx-action-btn" onClick={() => printDischargeSummary(adm)}>
                  <i className="pi pi-file" /> Discharge Summary
                </button>
              )}
              {(w.stage === "BillCleared" || w.stage === "Completed") && (
                <button className="rx-action-btn" onClick={() => printFinalBill(adm)}>
                  <i className="pi pi-receipt" /> Final Bill
                </button>
              )}
              {w.stage === "Completed" && (
                <button className="rx-action-btn" onClick={() => printGatePass(adm)}>
                  <i className="pi pi-print" /> Gate Pass
                </button>
              )}
              {adm.patientId?.contactNumber && (
                <WhatsAppButton
                  phone={adm.patientId.contactNumber}
                  patientName={adm.patientName}
                  context={{
                    attendantRelation: "family",
                    expectedTime: fmtDateTime(new Date()),
                  }}
                  defaultTemplate="discharge_intimation"
                  compact
                />
              )}
            </div>
          </div>
        );
      })}

      {/* Clear Bill Modal */}
      {clearing && (
        <ClearBillModal
          admission={clearing}
          onClose={() => setClearing(null)}
          onCleared={() => { setClearing(null); load(); }}
          userName={user?.fullName || user?.name || "Receptionist"}
        />
      )}

      {/* Issue Gate Pass Modal */}
      {gateRow && (
        <IssueGatePassModal
          admission={gateRow}
          onClose={() => setGateRow(null)}
          onIssued={(updated) => {
            setGateRow(null);
            load();
            printGatePass({ ...gateRow, dischargeWorkflow: updated });
          }}
          userName={user?.fullName || user?.name || "Receptionist"}
        />
      )}
    </div>
  );
}

/* ─────────── Clear Final Bill Modal ─────────── */
const FINAL_PAY_MODES = ["CASH", "UPI", "CARD", "CHEQUE", "ONLINE", "TPA_CLAIM"];

function ClearBillModal({ admission, onClose, onCleared, userName }) {
  const w = admission.dischargeWorkflow || {};
  const [amount, setAmount] = useState(w.finalBillAmount || 0);
  const [billNumber, setBillNumber] = useState(w.finalBillNumber || "");
  const [paymentMode, setPaymentMode] = useState("CASH");
  const [transactionId, setTransactionId] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!Number(amount) || Number(amount) <= 0) {
      return toast.error("Enter the final amount settled");
    }
    if (["UPI", "CARD", "CHEQUE", "ONLINE", "TPA_CLAIM"].includes(paymentMode) && !transactionId.trim()) {
      if (!window.confirm(`No transaction reference for ${paymentMode}. Record anyway?`)) return;
    }
    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/admissions/${admission._id}/clear-final-bill`, {
        finalBillAmount: Number(amount) || 0,
        finalBillNumber: billNumber,
        clearedBy: userName,
        paymentMode,                              // forwarded to linked PatientBill.payments
        transactionId: transactionId || undefined,
      });
      toast.success("Final bill cleared — patient ready for gate pass");

      // ── Auto-print the per-payment receipt ───────────────────────
      // Same pattern as ReceptionBilling's PaymentModal — receptionist
      // hands a physical slip to the patient. Fires regardless of
      // payment mode (cash / UPI / card / cheque / online / TPA).
      try {
        openPrint("payment-receipt", {
          receiptNo:    `${billNumber || admission.admissionNumber}-FINAL`,
          patientName:  admission.patientName,
          uhid:         admission.UHID || admission.patientId?.UHID,
          ipdNo:        admission.admissionNumber,
          age:          admission.patientId?.age,
          gender:       admission.patientId?.gender,
          amount:       Number(amount) || 0,
          method:       paymentMode,
          refNo:        transactionId || "",
          receivedBy:   userName,
          paidAt:       new Date().toISOString(),
          purpose:      `Final bill settlement — admission ${admission.admissionNumber}`,
          billTotal:    Number(w.finalBillAmount) || Number(amount) || 0,
          runningBalance: 0,
          remarks:      "Discharge final settlement",
        });
      } catch (_) { /* don't block on print issues */ }

      // ── Refund-receipt — overage auto-detect ─────────────────────
      // If advance > final bill, the difference is owed back to the
      // patient. Fire a refund-receipt automatically so the cashier
      // has paper proof of the cash returned. Pulls the unspent
      // advance from the admission's UHID-level pool.
      try {
        const advanceRes = await axios.get(
          `${API_ENDPOINTS.BASE}/billing/advance/uhid/${admission.UHID || admission.patientId?.UHID}`,
        ).catch(() => null);
        const advances = advanceRes?.data?.data || advanceRes?.data?.advances || [];
        const unspent  = advances.reduce((s, a) => s + Number(a.balance || a.unspentAmount || 0), 0);
        const finalAmt = Number(w.finalBillAmount) || Number(amount) || 0;
        const overage  = unspent - finalAmt;
        if (overage > 0.5) {
          openPrint("refund-receipt", {
            receiptNo:    `${billNumber || admission.admissionNumber}-REFUND`,
            patientName:  admission.patientName,
            uhid:         admission.UHID || admission.patientId?.UHID,
            ipdNo:        admission.admissionNumber,
            amount:       overage,
            method:       paymentMode,                         // refund usually in same mode
            refNo:        "",
            reason:       `Unused advance after final settlement (advance ₹${unspent.toFixed(0)} − final ₹${finalAmt.toFixed(0)})`,
            sourceReceiptNo: advances[0]?.receiptNumber || "",
            sourceMethod: advances[0]?.paymentMode || "CASH",
            sourceAmount: advances.reduce((s, a) => s + Number(a.amount || 0), 0),
            runningBalance: 0,
            receivedBy:   userName,
            issuedAt:     new Date().toISOString(),
          });
          toast.info(`Refund of ₹${overage.toFixed(0)} owed to patient — slip printed`);
        }
      } catch (_) { /* refund detection is best-effort; final bill clearance still succeeds */ }

      onCleared();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not clear bill");
    } finally { setSaving(false); }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head">
          <i className="pi pi-wallet" />
          <span className="rx-modal-title">Clear Final Bill — {admission.patientName}</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="his-field-group">
            <label className="his-label">Final Bill Number</label>
            <input className="his-field" value={billNumber} onChange={e => setBillNumber(e.target.value)} placeholder="e.g. BILL-20260511-00012" />
          </div>
          <div className="his-field-group">
            <label className="his-label">Final Amount Settled (₹) *</label>
            <input className="his-field" type="number" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div className="his-field-group">
            <label className="his-label">Payment Mode *</label>
            <div className="rx-grid-6">
              {FINAL_PAY_MODES.map(m => (
                <button key={m} type="button"
                        className={`rx-slot ${paymentMode === m ? "rx-slot--selected" : ""}`}
                        onClick={() => setPaymentMode(m)}>
                  {m === "TPA_CLAIM" ? "TPA" : m}
                </button>
              ))}
            </div>
          </div>
          {paymentMode !== "CASH" && (
            <div className="his-field-group">
              <label className="his-label">{paymentMode === "UPI" ? "UPI Reference" : paymentMode === "CHEQUE" ? "Cheque Number" : paymentMode === "TPA_CLAIM" ? "Claim Reference" : "Transaction ID"}</label>
              <input className="his-field" value={transactionId} onChange={e => setTransactionId(e.target.value)}
                     placeholder={paymentMode === "UPI" ? "e.g. 412345678901" : "Reference / auth code"} />
            </div>
          )}
          <div className="rx-banner rx-banner--warning">
            <strong>NABH check:</strong> Confirm payment received via the selected mode before proceeding. The payment is logged on the patient's bill ledger for audit.
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="rx-modal-btn-primary" onClick={save} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check"}`} /> Mark Bill Cleared
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── Issue Gate Pass Modal ─────────── */
function IssueGatePassModal({ admission, onClose, onIssued, userName }) {
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axios.post(`${API_ENDPOINTS.BASE}/admissions/${admission._id}/issue-gate-pass`, {
        issuedBy: userName,
      });
      toast.success(`Gate pass ${data?.data?.gatePassNumber} issued — patient discharged`);
      onIssued(data?.data);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not issue gate pass");
    } finally { setSaving(false); }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head">
          <i className="pi pi-id-card" />
          <span className="rx-modal-title">Issue Gate Pass — {admission.patientName}</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <p className="rx-modal-para">
            This will generate a unique gate pass number, mark the admission as <strong>Discharged</strong>,
            and the patient/attendant will need this pass for hospital exit.
          </p>
          <div className="rx-banner rx-banner--success">
            ✓ Final bill cleared · ₹{(admission.dischargeWorkflow?.finalBillAmount || 0).toLocaleString("en-IN")}<br />
            ✓ Doctor approved · {admission.dischargeWorkflow?.doctorApprovedBy}<br />
            ✓ Bed will be released after gate pass issued
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="rx-modal-btn-primary" onClick={save} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check-circle"}`} /> Issue Gate Pass &amp; Discharge
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── Print Gate Pass ─────────── */
/* Wired to the unified print system — discharge summary + final bill. */
function printDischargeSummary(adm) {
  const p = adm.patientId || {};
  const w = adm.dischargeWorkflow || {};
  openPrint("discharge-summary", {
    summaryNo:      w.summaryNumber || `DS-${(adm.ipdNo || "").replace(/[^A-Z0-9]/gi, "")}`,
    patientName:    adm.patientName,
    uhid:           adm.UHID,
    ipdNo:          adm.ipdNo,
    age:            p.age,
    gender:         p.gender,
    admissionDate:  adm.admissionDate,
    dischargeDate:  w.dischargedAt || new Date().toISOString(),
    totalDays:      adm.totalDays,
    consultantName: adm.attendingDoctor || w.doctorApprovedBy,
    bedNumber:      adm.bedNumber,
    wardName:       adm.wardName,
    dischargeType:  w.dischargeType || "Normal",
    finalDiagnosis: adm.finalDiagnosis || adm.diagnosis,
    chiefComplaints: adm.chiefComplaints,
    conditionOnDischarge: w.conditionOnDischarge,
    dischargeMeds:  adm.dischargeMeds || [],
    advice:         adm.dischargeAdvice ? String(adm.dischargeAdvice).split("\n").filter(Boolean) : [],
    followUpDate:   adm.followUpDate,
    followUpDoctor: adm.attendingDoctor,
  });
}

function printFinalBill(adm) {
  const p = adm.patientId || {};
  const w = adm.dischargeWorkflow || {};
  openPrint("final-bill", {
    // dischargeWorkflow stores the bill number under `finalBillNumber`
    // (see backend admissionController.clearFinalBill). The previous
    // `w.billNumber` read was always undefined — the printed bill had
    // a blank bill-number field for every discharge.
    billNo:         w.finalBillNumber,
    patientName:    adm.patientName,
    uhid:           adm.UHID,
    ipdNo:          adm.ipdNo,
    age:            p.age,
    gender:         p.gender,
    admissionDate:  adm.admissionDate,
    dischargeDate:  w.dischargedAt || new Date().toISOString(),
    totalDays:      adm.totalDays,
    consultantName: adm.attendingDoctor,
    bedNumber:      adm.bedNumber,
    wardName:       adm.wardName,
    finalDiagnosis: adm.finalDiagnosis || adm.diagnosis,
    tpaName:        adm.tpaName || (adm.scheme === "Cashless" ? "TPA" : "Self-paying"),
    items:          w.billItems || adm.billItems || [],
    discount:       w.discount,
    tax:            w.tax,
    advanceReceived:w.advanceReceived,
    payments:       w.payments || [],
  });
}

function printGatePass(admission) {
  const w = admission.dischargeWorkflow || {};
  const html = `<!doctype html><html><head><meta charset="utf-8"/>
    <title>Gate Pass ${w.gatePassNumber || ""}</title>
    <style>
      *{box-sizing:border-box;font-family:'DM Sans',Arial,sans-serif}
      body{margin:0;padding:24px;color:#0f172a}
      .wrap{max-width:560px;margin:0 auto;border:3px solid #0e7490;border-radius:14px;overflow:hidden}
      .hd{padding:18px;background:linear-gradient(135deg,#0891b2,#0e7490);color:#fff;text-align:center}
      .hd-title{font-size:22px;font-weight:900;margin:0}
      .hd-sub{font-size:11px;opacity:.85;margin-top:4px}
      .body{padding:22px}
      .pass-no{font-size:30px;font-weight:900;text-align:center;letter-spacing:3px;color:#0e7490;font-family:'DM Mono',monospace;margin:10px 0 20px}
      table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px}
      td{padding:6px 0}
      td.lbl{color:#64748b;width:40%}
      td.val{font-weight:700}
      .footer{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:24px}
      .sign{text-align:center}
      .sign-line{border-top:1px solid #94a3b8;margin-top:40px}
      .sign-label{font-size:10px;color:#64748b;font-weight:700;margin-top:4px}
      .note{margin-top:12px;text-align:center;font-size:10px;color:#94a3b8}
      @media print{body{padding:0} .wrap{border:0}}
    </style></head><body><div class="wrap">
      <div class="hd">
        <div class="hd-title">DISCHARGE GATE PASS</div>
        <div class="hd-sub">${new Date().toLocaleString("en-IN", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
      </div>
      <div class="body">
        <div class="pass-no">${w.gatePassNumber || "—"}</div>
        <table>
          <tr><td class="lbl">Patient Name</td><td class="val">${admission.patientName}</td></tr>
          <tr><td class="lbl">UHID</td><td class="val" style="font-family:'DM Mono',monospace">${admission.UHID || "—"}</td></tr>
          <tr><td class="lbl">Bed / Ward</td><td class="val">${admission.bedNumber || "—"} / ${admission.wardName || "—"}</td></tr>
          <tr><td class="lbl">Admitted on</td><td class="val">${admission.admissionDate ? new Date(admission.admissionDate).toLocaleDateString("en-IN") : "—"}</td></tr>
          <tr><td class="lbl">Discharged on</td><td class="val">${new Date().toLocaleDateString("en-IN")}</td></tr>
          <tr><td class="lbl">Final Bill</td><td class="val">₹${(w.finalBillAmount || 0).toLocaleString("en-IN")}</td></tr>
          <tr><td class="lbl">Approved by</td><td class="val">${w.doctorApprovedBy || "Doctor"}</td></tr>
          <tr><td class="lbl">Bill Cleared by</td><td class="val">${w.billClearedBy || "Reception"}</td></tr>
          <tr><td class="lbl">Pass Issued by</td><td class="val">${w.gatePassIssuedBy || "Reception"}</td></tr>
        </table>
        <div class="footer">
          <div class="sign"><div class="sign-line"></div><div class="sign-label">Patient / Attendant</div></div>
          <div class="sign"><div class="sign-line"></div><div class="sign-label">Reception</div></div>
        </div>
        <div class="note">Present this pass at the security gate. Hospital is not responsible after exit.</div>
      </div>
    </div></body></html>`;
  const w2 = window.open("", "_blank", "width=700,height=720");
  if (!w2) { alert("Please allow popups"); return; }
  w2.document.write(html); w2.document.close();
  w2.onload = () => setTimeout(() => w2.print(), 200);
}
