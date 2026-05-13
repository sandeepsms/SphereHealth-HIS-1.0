/**
 * VisitorPasses.jsx — NABH FMS.7 visitor management
 *
 * Issue, list, return, and revoke attendant passes for active admissions.
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { openPrint } from "../../Components/print/openPrint";
import { useAuth } from "../../context/AuthContext";
import "./reception-shared.css";
import "../../Components/clinical/clinical-forms.css";

const RELATIONS = ["Son", "Daughter", "Spouse", "Mother", "Father", "Brother", "Sister", "Friend", "Relative", "Other"];
const ID_TYPES  = ["Aadhaar", "PAN", "Voter ID", "Driving License", "Passport", "Other"];

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function VisitorPasses() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [list,       setList]       = useState([]);
  const [admissions, setAdmissions] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState("Active");
  const [search,     setSearch]     = useState("");
  const [issueOpen,  setIssueOpen]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, aRes] = await Promise.allSettled([
        axios.get(`${API_ENDPOINTS.BASE}/visitor-passes`),
        axios.get(`${API_ENDPOINTS.BASE}/admissions/active`),
      ]);
      if (pRes.status === "fulfilled") setList(pRes.value.data?.data || []);
      if (aRes.status === "fulfilled") {
        const data = aRes.value.data;
        setAdmissions(Array.isArray(data) ? data : (data?.admissions || data?.data || []));
      }
    } catch (e) { toast.error("Could not load passes"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let r = list.filter(p => p.status === tab);
    const s = search.trim().toLowerCase();
    if (s) r = r.filter(p =>
      (p.patientName || "").toLowerCase().includes(s) ||
      (p.attendantName || "").toLowerCase().includes(s) ||
      (p.passNumber || "").toLowerCase().includes(s)
    );
    return r;
  }, [list, tab, search]);

  const counts = {
    Active:   list.filter(p => p.status === "Active").length,
    Returned: list.filter(p => p.status === "Returned").length,
    Expired:  list.filter(p => p.status === "Expired").length,
    Revoked:  list.filter(p => p.status === "Revoked").length,
  };

  const onReturn = async (id) => {
    if (!window.confirm("Mark pass as returned?")) return;
    try { await axios.post(`${API_ENDPOINTS.BASE}/visitor-passes/${id}/return`); toast.success("Pass returned"); load(); }
    catch (e) { toast.error("Failed"); }
  };
  const onRevoke = async (id) => {
    const reason = window.prompt("Revoke reason?");
    if (reason === null) return;
    try { await axios.post(`${API_ENDPOINTS.BASE}/visitor-passes/${id}/revoke`, { reason }); toast.success("Pass revoked"); load(); }
    catch (e) { toast.error("Failed"); }
  };

  return (
    <div className="rx-page">
      <div className="rx-header">
        <div>
          <div className="rx-header-title"><i className="pi pi-id-card" /> Visitor Passes</div>
          <div className="rx-header-meta">NABH FMS.7 · Attendant management · Max 2 active passes per patient</div>
        </div>
        <div className="rx-header-actions">
          <button className="rx-btn-ghost" onClick={load}><i className="pi pi-refresh" /> Refresh</button>
          <button className="rx-btn-primary" onClick={() => setIssueOpen(true)}>
            <i className="pi pi-plus" /> Issue New Pass
          </button>
          <button className="rx-btn-ghost" onClick={() => navigate("/reception")}>
            <i className="pi pi-arrow-left" /> Dashboard
          </button>
        </div>
      </div>

      <div className="rx-tabs">
        {["Active", "Returned", "Expired", "Revoked"].map(s => (
          <button key={s} className={`rx-tab ${tab === s ? "rx-tab--active" : ""}`} onClick={() => setTab(s)}>
            {s} <span className="rx-tab-count">{counts[s]}</span>
          </button>
        ))}
      </div>

      <div className="rx-search">
        <i className="pi pi-search" />
        <input placeholder="Search by patient, attendant, or pass #…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : filtered.length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">🪪</span>
          No {tab.toLowerCase()} passes
        </div>
      ) : filtered.map(p => {
        const expired = new Date(p.validUntil) < new Date();
        const stageCls = p.status === "Active" ? (expired ? "expired" : "active") :
                         p.status === "Returned" ? "done" :
                         p.status === "Revoked"  ? "revoked" : "expired";
        return (
          <div key={p._id} className="rx-card">
            <div className="rx-card-main">
              <div className="rx-card-name">
                {p.passNumber}
                <span className={`rx-card-stage rx-card-stage--${stageCls}`}>{p.status}{p.status === "Active" && expired ? " · auto-expired" : ""}</span>
              </div>
              <div className="rx-card-meta">
                <span>Patient: <strong>{p.patientName}</strong></span>
                {p.bedNumber && <span>Bed: <strong>{p.bedNumber}</strong></span>}
                <span>Attendant: <strong>{p.attendantName}</strong> ({p.attendantRelation})</span>
                {p.attendantPhone && <span>📞 {p.attendantPhone}</span>}
                {p.idProofType && <span>{p.idProofType}: {p.idProofNumber}</span>}
                <span>Valid: {fmtDateTime(p.validFrom)} → {fmtDateTime(p.validUntil)}</span>
                <span>Issued by: <strong>{p.issuedBy}</strong></span>
              </div>
            </div>
            <div className="rx-card-actions">
              {p.status === "Active" && (
                <>
                  <button className="rx-action-btn" onClick={() => printPass(p)}>
                    <i className="pi pi-print" /> Print
                  </button>
                  <button className="rx-action-btn rx-action-btn--success" onClick={() => onReturn(p._id)}>
                    <i className="pi pi-check" /> Return
                  </button>
                  <button className="rx-action-btn rx-action-btn--danger" onClick={() => onRevoke(p._id)}>
                    <i className="pi pi-ban" /> Revoke
                  </button>
                </>
              )}
              {p.status === "Returned" && <button className="rx-action-btn" onClick={() => printPass(p)}><i className="pi pi-print" /> Print</button>}
            </div>
          </div>
        );
      })}

      {issueOpen && (
        <IssuePassModal
          admissions={admissions}
          onClose={() => setIssueOpen(false)}
          onIssued={(pass) => { setIssueOpen(false); load(); printPass(pass); }}
          userName={user?.fullName || user?.name || "Receptionist"}
        />
      )}
    </div>
  );
}

/* ─────────── Issue Pass Modal ─────────── */
function IssuePassModal({ admissions, onClose, onIssued, userName }) {
  const [admissionId, setAdmissionId] = useState("");
  const [attendantName, setAttendantName] = useState("");
  const [relation, setRelation] = useState("Son");
  const [phone, setPhone] = useState("");
  const [idType, setIdType] = useState("Aadhaar");
  const [idNumber, setIdNumber] = useState("");
  const [validHours, setValidHours] = useState(24);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!admissionId || !attendantName || !relation) {
      toast.warn("Fill required fields"); return;
    }
    setSaving(true);
    try {
      const { data } = await axios.post(`${API_ENDPOINTS.BASE}/visitor-passes`, {
        admissionId,
        attendantName,
        attendantRelation: relation,
        attendantPhone: phone,
        idProofType: idType,
        idProofNumber: idNumber,
        validHours: Number(validHours) || 24,
        issuedBy: userName,
      });
      toast.success(`Pass ${data.data.passNumber} issued`);
      onIssued(data.data);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not issue pass");
    } finally { setSaving(false); }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head">
          <i className="pi pi-id-card" />
          <span className="rx-modal-title">Issue Visitor Pass</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="his-field-group">
            <label className="his-label">Select Patient (admitted) <span className="rx-req">*</span></label>
            <select className="his-select" value={admissionId} onChange={e => setAdmissionId(e.target.value)}>
              <option value="">— Select admitted patient —</option>
              {admissions.map(a => (
                <option key={a._id} value={a._id}>
                  {a.patientName} · {a.UHID || ""} · Bed {a.bedNumber || "—"}
                </option>
              ))}
            </select>
          </div>
          <div className="rx-grid-2-fields">
            <div className="his-field-group">
              <label className="his-label">Attendant Name <span className="rx-req">*</span></label>
              <input className="his-field" value={attendantName} onChange={e => setAttendantName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="his-field-group">
              <label className="his-label">Relation</label>
              <select className="his-select" value={relation} onChange={e => setRelation(e.target.value)}>
                {RELATIONS.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div className="rx-grid-3-fields">
            <div className="his-field-group">
              <label className="his-label">Phone</label>
              <input className="his-field" value={phone} maxLength={10} onChange={e => setPhone(e.target.value.replace(/\D/g, ""))} placeholder="10-digit" />
            </div>
            <div className="his-field-group">
              <label className="his-label">ID Type</label>
              <select className="his-select" value={idType} onChange={e => setIdType(e.target.value)}>
                {ID_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="his-field-group">
              <label className="his-label">ID Number</label>
              <input className="his-field" value={idNumber} onChange={e => setIdNumber(e.target.value)} placeholder="last 4 digits ok" />
            </div>
          </div>
          <div className="his-field-group">
            <label className="his-label">Pass Valid For (hours)</label>
            <input className="his-field" type="number" value={validHours} onChange={e => setValidHours(e.target.value)} />
          </div>
          <div className="rx-banner rx-banner--info">
            🕐 Visiting hours: <strong>11 AM – 1 PM</strong> &amp; <strong>5 PM – 7 PM</strong>. ICU/NICU: max 1 visitor at a time, 10 min slots.
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="rx-modal-btn-primary" onClick={save} disabled={saving || !admissionId || !attendantName}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check"}`} /> Issue Pass &amp; Print
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── Print Pass ─────────── */
// FIX (audit P8-B5): HTML-escape every user-controlled value before
// concatenating into the print-window markup. The legacy template did
// raw interpolation — an attendant name like `<script>alert(1)</script>`
// or a patient name containing `<` would either execute or break the
// print. Tiny inline escaper avoids pulling a dependency.
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

/* Rewired through the unified CSS-driven print system so the visitor
 * pass picks up the hospital header/footer + paper-size selector. */
function printPass(p) {
  openPrint("visitor-pass", {
    passNo:        p.passNumber,
    patientName:   p.patientName,
    uhid:          p.patientUHID,
    bedNumber:     p.bedNumber,
    wardName:      p.wardName,
    floorNumber:   p.floorNumber,
    buildingName:  p.buildingName,
    issuedAt:      p.issuedAt || p.createdAt,
    validTill:     p.validUntil,
    visitorName:   p.attendantName,
    relation:      p.attendantRelation,
    mobile:        p.attendantPhone,
    idType:        p.idProofType,
    idNumber:      p.idProofNumber,
  });
}
