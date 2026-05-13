/**
 * TPACases.jsx — Insurance / TPA workflow for receptionist
 *
 * Stages match PatientBillModel.tpaClaimStatus enum:
 *   PENDING (incl. NOT_APPLICABLE) → SUBMITTED → APPROVED / PARTIAL_APPROVED / REJECTED
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { openPrint } from "../../Components/print/openPrint";
import "./reception-shared.css";
import "../../Components/clinical/clinical-forms.css";

const fmtCur = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// The PatientBill.tpaClaimStatus enum is:
//   NOT_APPLICABLE | PENDING | SUBMITTED | APPROVED | REJECTED | PARTIAL_APPROVED
// We use these values verbatim in the filter; the UI labels normalise display.
const STATUSES = ["PENDING", "SUBMITTED", "APPROVED", "PARTIAL_APPROVED", "REJECTED"];
const STATUS_LABEL = {
  PENDING:          "Pending",
  SUBMITTED:        "Submitted",
  APPROVED:         "Approved",
  PARTIAL_APPROVED: "Partial",
  REJECTED:         "Denied",
};
const STATUS_CLASS = {
  PENDING:          "pending",
  SUBMITTED:        "submitted",
  APPROVED:         "approved",
  PARTIAL_APPROVED: "submitted",
  REJECTED:         "denied",
};

/* Print the TPA pre-authorization letter via the unified print system. */
function printTPAAuth(bill) {
  const p = bill.patientId || {};
  const a = bill.admissionId || {};
  openPrint("tpa-authorization", {
    requestNo:           bill.tpaClaimNumber || bill.billNumber,
    date:                bill.tpaSubmittedAt || new Date().toISOString(),
    patientName:         p.fullName || bill.patientName,
    uhid:                p.UHID || bill.UHID,
    ipdNo:               a.ipdNo || bill.ipdNo,
    age:                 p.age,
    gender:              p.gender,
    policyNo:            bill.tpaPolicyNumber,
    tpaName:             bill.tpaName,
    tpaAddress:          bill.tpaAddress,
    insurerName:         bill.insurerName,
    corporateName:       bill.corporateName,
    tpaCardNo:           bill.tpaCardNumber,
    admissionDate:       a.admissionDate || bill.admissionDate,
    provisionalDiagnosis: a.provisionalDiagnosis || bill.diagnosis,
    icd10:               a.icd10,
    icd10Desc:           a.icd10Description,
    proposedProcedure:   bill.proposedProcedure,
    treatmentLine:       bill.treatmentLine || "Medical",
    pastHistory:         a.medicalHistory,
    comorbidities:       a.comorbidities,
    preExisting:         a.preExistingConditions,
    totalEstimated:      bill.tpaPayableAmount || bill.netAmount,
    doctorName:          bill.consultantName || a.attendingDoctor,
    doctorReg:           bill.consultantRegNo,
    doctorQualifications: bill.consultantQualifications,
  });
}

export default function TPACases() {
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("PENDING");
  const [search, setSearch] = useState("");
  const [actionBill, setActionBill] = useState(null);
  const [actionType, setActionType] = useState(null); // 'submit' | 'approve' | 'deny'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.BASE}/billing/tpa-cases`);
      setList(data?.data || []);
    } catch (e) { toast.error("Could not load TPA cases"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Treat NOT_APPLICABLE and missing status as "PENDING" so brand-new TPA bills
  // show up in the receptionist's queue.
  const normaliseStatus = (s) => (!s || s === "NOT_APPLICABLE") ? "PENDING" : s;

  const filtered = useMemo(() => {
    let r = list.filter(b => normaliseStatus(b.tpaClaimStatus) === tab);
    const s = search.trim().toLowerCase();
    if (s) r = r.filter(b =>
      (b.patientName || "").toLowerCase().includes(s) ||
      (b.UHID || "").toLowerCase().includes(s) ||
      (b.billNumber || "").toLowerCase().includes(s) ||
      (b.tpaClaimNumber || "").toLowerCase().includes(s)
    );
    return r;
  }, [list, tab, search]);

  const counts = STATUSES.reduce((acc, s) => {
    acc[s] = list.filter(b => normaliseStatus(b.tpaClaimStatus) === s).length;
    return acc;
  }, {});

  return (
    <div className="rx-page">
      <div className="rx-header">
        <div>
          <div className="rx-header-title"><i className="pi pi-shield" /> TPA / Insurance Cases</div>
          <div className="rx-header-meta">Pre-authorization · Approval · Claim settlement workflow</div>
        </div>
        <div className="rx-header-actions">
          <button className="rx-btn-ghost" onClick={load}><i className="pi pi-refresh" /> Refresh</button>
          <button className="rx-btn-primary" onClick={() => navigate("/reception")}>
            <i className="pi pi-arrow-left" /> Dashboard
          </button>
        </div>
      </div>

      <div className="rx-tabs">
        {STATUSES.map(s => (
          <button key={s} className={`rx-tab ${tab === s ? "rx-tab--active" : ""}`} onClick={() => setTab(s)}>
            {STATUS_LABEL[s] || s} <span className="rx-tab-count">{counts[s] || 0}</span>
          </button>
        ))}
      </div>

      <div className="rx-search">
        <i className="pi pi-search" />
        <input placeholder="Search by patient, UHID, bill #, claim #…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : filtered.length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">🛡️</span>
          No {tab.toLowerCase()} TPA cases
        </div>
      ) : filtered.map(bill => {
        const cls = STATUS_CLASS[bill.tpaClaimStatus] || "pending";
        const patientName = bill.patientName || bill.patient?.fullName || "Patient";
        const uhid        = bill.UHID || bill.patient?.UHID || "—";
        const grossAmt    = bill.netAmount || bill.netPayable || bill.totalAmount || 0;
        return (
          <div key={bill._id} className="rx-card">
            <div className="rx-card-main">
              <div className="rx-card-name">
                {patientName}
                <span className={`rx-card-stage rx-card-stage--${cls}`}>{STATUS_LABEL[bill.tpaClaimStatus] || bill.tpaClaimStatus || "Pending"}</span>
              </div>
              <div className="rx-card-meta">
                <span>UHID: <strong>{uhid}</strong></span>
                <span>Bill: <strong>{bill.billNumber || "—"}</strong></span>
                <span>TPA: <strong>{bill.tpa?.tpaName || bill.tpaName || "—"}</strong></span>
                {bill.tpaClaimNumber && <span>Claim #: <strong>{bill.tpaClaimNumber}</strong></span>}
                <span>Gross: <strong>{fmtCur(grossAmt)}</strong></span>
                <span>TPA portion: <strong>{fmtCur(bill.tpaPayableAmount)}</strong></span>
                {bill.tpaApprovedAmount > 0 && <span className="rx-text-success">Approved: <strong>{fmtCur(bill.tpaApprovedAmount)}</strong></span>}
              </div>
            </div>
            <div className="rx-card-actions">
              {(!bill.tpaClaimStatus || bill.tpaClaimStatus === "PENDING" || bill.tpaClaimStatus === "NOT_APPLICABLE") && (
                <button className="rx-action-btn rx-action-btn--primary"
                        onClick={() => { setActionBill(bill); setActionType("submit"); }}>
                  <i className="pi pi-send" /> Submit Pre-Auth
                </button>
              )}
              {bill.tpaClaimStatus === "SUBMITTED" && (
                <>
                  <button className="rx-action-btn rx-action-btn--success"
                          onClick={() => { setActionBill(bill); setActionType("approve"); }}>
                    <i className="pi pi-check" /> Mark Approved
                  </button>
                  <button className="rx-action-btn rx-action-btn--danger"
                          onClick={() => { setActionBill(bill); setActionType("deny"); }}>
                    <i className="pi pi-times" /> Mark Denied
                  </button>
                </>
              )}
              <button className="rx-action-btn" onClick={() => printTPAAuth(bill)}>
                <i className="pi pi-print" /> Print TPA Letter
              </button>
            </div>
          </div>
        );
      })}

      {actionBill && (
        <TPAActionModal
          bill={actionBill}
          type={actionType}
          onClose={() => { setActionBill(null); setActionType(null); }}
          onDone={() => { setActionBill(null); setActionType(null); load(); }}
        />
      )}
    </div>
  );
}

function TPAActionModal({ bill, type, onClose, onDone }) {
  const [claimNumber, setClaimNumber] = useState(bill.tpaClaimNumber || "");
  const [requestedAmount, setRequestedAmount] = useState(bill.tpaPayableAmount || 0);
  const [approvedAmount, setApprovedAmount] = useState(bill.tpaPayableAmount || 0);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      if (type === "submit") {
        await axios.post(`${API_ENDPOINTS.BASE}/billing/${bill._id}/tpa-preauth-submit`, {
          claimNumber, requestedAmount: Number(requestedAmount) || 0,
        });
        toast.success("Pre-auth submitted");
      } else if (type === "approve") {
        await axios.post(`${API_ENDPOINTS.BASE}/billing/${bill._id}/tpa-approve`, {
          approvedAmount: Number(approvedAmount) || 0,
        });
        toast.success("Approval recorded");
      } else if (type === "deny") {
        await axios.post(`${API_ENDPOINTS.BASE}/billing/${bill._id}/tpa-deny`, { reason });
        toast.success("Denial recorded");
      }
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Action failed");
    } finally { setSaving(false); }
  };

  const titles = { submit: "Submit Pre-Authorization", approve: "Mark Claim Approved", deny: "Mark Claim Denied" };
  const icons  = { submit: "pi-send", approve: "pi-check", deny: "pi-times" };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head">
          <i className={`pi ${icons[type]}`} />
          <span className="rx-modal-title">{titles[type]} — {bill.patientName}</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          {type === "submit" && (
            <>
              <div className="his-field-group">
                <label className="his-label">Claim Number</label>
                <input className="his-field" value={claimNumber} onChange={e => setClaimNumber(e.target.value)} placeholder="e.g. CLM-2026-001234" />
              </div>
              <div className="his-field-group">
                <label className="his-label">Requested Amount (₹)</label>
                <input className="his-field" type="number" value={requestedAmount} onChange={e => setRequestedAmount(e.target.value)} />
              </div>
              <div className="rx-banner rx-banner--info">
                📄 Checklist before submission: photo ID, insurance card, doctor's reasoning, estimated cost breakdown, pre-existing disease declaration.
              </div>
            </>
          )}
          {type === "approve" && (
            <>
              <div className="his-field-group">
                <label className="his-label">Approved Amount (₹)</label>
                <input className="his-field" type="number" value={approvedAmount} onChange={e => setApprovedAmount(e.target.value)} />
              </div>
              <div className="rx-banner rx-banner--success">
                ✓ Patient cashless validity activated up to this amount. Settlement will happen on discharge.
              </div>
            </>
          )}
          {type === "deny" && (
            <>
              <div className="his-field-group">
                <label className="his-label">Denial Reason</label>
                <textarea className="his-textarea" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Pre-existing exclusion, policy lapsed, exceeds sum insured…" rows={4} />
              </div>
              <div className="rx-banner rx-banner--danger">
                ⚠ Patient will need to settle in cash/card. Inform patient about the denial.
              </div>
            </>
          )}
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="rx-modal-btn-primary" onClick={save} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : icons[type]}`} /> Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
