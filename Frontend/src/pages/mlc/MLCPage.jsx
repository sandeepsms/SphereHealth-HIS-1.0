/**
 * MLCPage — Doctor's MLC dashboard (/mlc)
 *
 * Doctors land here to:
 *   • See all MLCs they've cut / recorded (auto-scoped server-side)
 *   • Create a new MLC for any patient — either External (basic details
 *     of an MLC already cut elsewhere) or Internal (full new MLC)
 *   • Open a printable MLC report with the MLR-stamp watermark applied
 *
 * UI follows the system rx-* design language. All styling lives in
 * reception-shared.css + mlc.css — no inline styles for layout, only
 * data-driven attributes (e.g. radio selections).
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import mlcService from "../../Services/mlc/mlcService";
import patientService from "../../Services/patient/patientService";
import { doctorService } from "../../Services/doctors/doctorService";
import { useAuth } from "../../context/AuthContext";
import MLCStamp from "../../Components/mlc/MLCStamp";
import "../reception/reception-shared.css";
import "../../Components/clinical/clinical-forms.css";
import "./mlc.css";

const STATUS_TABS = [
  { key: "ALL",       label: "All MLCs",   icon: "pi-list" },
  { key: "Draft",     label: "Drafts",     icon: "pi-pencil" },
  { key: "Finalized", label: "Finalized",  icon: "pi-check" },
  { key: "Closed",    label: "Closed",     icon: "pi-flag" },
];

const MLC_TYPES = [
  "Assault",
  "Road Traffic Accident",
  "Burn",
  "Poisoning",
  "Suicide Attempt",
  "Sexual Assault",
  "Industrial Accident",
  "Self-inflicted",
  "Animal Bite",
  "Unnatural Death",
  "Other",
];

const INJURY_TYPES = [
  "Abrasion", "Contusion", "Laceration", "Incised", "Stab",
  "Firearm", "Burn", "Bite", "Fracture", "Other",
];

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default function MLCPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const isDoctor = user?.role === "Doctor";
  const canCreate = ["Doctor", "Admin"].includes(user?.role);

  const [list, setList]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState("ALL");
  const [search, setSearch]   = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [detailMlr, setDetailMlr] = useState(params.get("mlr") || null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await mlcService.list({ limit: 200 });
      setList(Array.isArray(r?.data) ? r.data : []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not load MLCs");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { ALL: list.length, Draft: 0, Finalized: 0, Closed: 0 };
    list.forEach((m) => { if (c[m.status] != null) c[m.status] += 1; });
    return c;
  }, [list]);

  const filtered = useMemo(() => {
    let r = list;
    if (tab !== "ALL") r = r.filter((m) => m.status === tab);
    const s = search.trim().toLowerCase();
    if (s) {
      r = r.filter((m) =>
        (m.mlrNumber   || "").toLowerCase().includes(s) ||
        (m.patientName || "").toLowerCase().includes(s) ||
        (m.UHID        || "").toLowerCase().includes(s) ||
        (m.doctorName  || "").toLowerCase().includes(s) ||
        (m.firNumber   || "").toLowerCase().includes(s) ||
        (m.mlcType     || "").toLowerCase().includes(s)
      );
    }
    return r;
  }, [list, tab, search]);

  /* ── Render ────────────────────────────────────────────────── */
  return (
    <div className="rx-page">
      <div className="rx-header rx-header--er">
        <div>
          <div className="rx-header-title">
            <i className="pi pi-shield" /> Medico-Legal Cases (MLC)
          </div>
          <div className="rx-header-meta">
            {isDoctor
              ? "Your MLR series · "
              : "Hospital-wide MLC register · "}
            {filtered.length} record{filtered.length === 1 ? "" : "s"}
            {search && <> matching “<strong>{search}</strong>”</>}
          </div>
        </div>
        <div className="rx-header-actions">
          <button className="rx-btn-ghost" onClick={load}>
            <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} /> Refresh
          </button>
          {canCreate && (
            <button className="rx-btn-primary rx-btn-primary--er"
                    onClick={() => { setEditing(null); setShowForm(true); }}>
              <i className="pi pi-plus" /> Cut / Record MLC
            </button>
          )}
          <button className="rx-btn-ghost" onClick={() => navigate(-1)}>
            <i className="pi pi-arrow-left" /> Back
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="rx-kpis">
        {STATUS_TABS.map((t) => (
          <div
            key={t.key}
            className={`rx-kpi ${tab === t.key ? "rx-kpi-tile--filtering" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <div className="rx-kpi-label">{t.label}</div>
            <div className="rx-kpi-value">{counts[t.key] || 0}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="rx-tabs">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            className={`rx-tab ${tab === t.key ? "rx-tab--active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <i className={`pi ${t.icon}`} /> {t.label}
            <span className="rx-tab-count">{counts[t.key] || 0}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="rx-search">
        <i className="pi pi-search" />
        <input
          placeholder="Search by MLR #, patient, UHID, doctor, FIR, type…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="rx-action-btn" onClick={() => setSearch("")}>
            <i className="pi pi-times" />
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
      ) : filtered.length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">⚖</span>
          {search
            ? <>No MLC found matching “<strong>{search}</strong>”.</>
            : tab === "ALL"
              ? "No medico-legal cases recorded yet."
              : <>No <strong>{tab}</strong> MLCs.</>}
          {canCreate && tab === "ALL" && !search && (
            <div className="rx-mt-10">
              <button className="rx-btn-primary rx-btn-primary--er"
                      onClick={() => { setEditing(null); setShowForm(true); }}>
                <i className="pi pi-plus" /> Record the first MLC
              </button>
            </div>
          )}
        </div>
      ) : (
        filtered.map((m) => (
          <MLCRow
            key={m._id}
            m={m}
            onView={() => setDetailMlr(m.mlrNumber)}
            onEdit={canCreate ? () => { setEditing(m); setShowForm(true); } : null}
          />
        ))
      )}

      {showForm && (
        <MLCFormModal
          existing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={(saved) => {
            setShowForm(false);
            setEditing(null);
            load();
            if (saved?.mlrNumber) setDetailMlr(saved.mlrNumber);
          }}
        />
      )}

      {detailMlr && (
        <MLCDetailModal
          mlrNumber={detailMlr}
          onClose={() => setDetailMlr(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/* ─────────── List row ─────────── */
function MLCRow({ m, onView, onEdit }) {
  const stageCls = m.status === "Draft"     ? "pending"
                : m.status === "Finalized"  ? "cleared"
                : m.status === "Closed"     ? "done"
                : "pending";
  const sourceCls = m.source === "Internal"
    ? "mlc-pill-source--internal"
    : "mlc-pill-source--external";

  return (
    <div className="rx-card rx-card-stripe--critical">
      <div className="rx-card-main">
        <div className="rx-card-name">
          <span className="mlc-mlr-large">{m.mlrNumber}</span>
          <span className={`rx-card-stage ${sourceCls}`}>
            {m.source === "Internal" ? "⚖ Internal" : "↗ External"}
          </span>
          <span className={`rx-card-stage rx-card-stage--${stageCls}`}>{m.status}</span>
          {m.mlcType && <span className="rx-mono-tag">{m.mlcType}</span>}
        </div>
        <div className="rx-card-meta">
          <span>Patient: <strong>{m.patientName || "—"}</strong></span>
          <span>UHID: <strong>{m.UHID}</strong></span>
          <span>Doctor: <strong>{m.doctorName}</strong></span>
          <span>Recorded: <strong>{fmtDateTime(m.createdAt)}</strong></span>
          {m.firNumber && <span>FIR: <strong>{m.firNumber}</strong></span>}
          {m.policeStation && <span>P.S.: <strong>{m.policeStation}</strong></span>}
        </div>
        {m.allegedHistory && (
          <div className="rx-card-meta rx-card-divider">
            <span><strong>History:</strong> {m.allegedHistory}</span>
          </div>
        )}
      </div>
      <div className="rx-card-actions">
        <button className="rx-action-btn rx-action-btn--primary" onClick={onView}>
          <i className="pi pi-eye" /> View / Print
        </button>
        {onEdit && m.status !== "Closed" && (
          <button className="rx-action-btn rx-action-btn--success" onClick={onEdit}>
            <i className="pi pi-pencil" /> Edit
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────── Form modal ─────────── */
function MLCFormModal({ existing, onClose, onSaved }) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  // Doctor list (admin needs to choose; doctor user gets auto-filled)
  const [doctors, setDoctors] = useState([]);
  // Patient search
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState([]);
  const [patientSearching, setPatientSearching] = useState(false);
  const debRef = useRef(null);

  // Form state — initialised from `existing` if editing
  const [form, setForm] = useState(() => ({
    source: "Internal",
    mlcType: "Other",
    informedPolice: false,
    smellOfAlcohol: false,
    disposition: "Under Observation",
    status: "Draft",
    injuries: [],
    vitals: {},
    externalDetails: {},
    ...existing,
  }));
  const [selectedPatient, setSelectedPatient] = useState(
    existing
      ? { _id: existing.patientId?._id || existing.patientId, UHID: existing.UHID, fullName: existing.patientName, age: existing.age, gender: existing.gender, contactNumber: existing.contactNumber }
      : null,
  );
  const [selectedDoctor, setSelectedDoctor] = useState(null);

  // Load doctors (admins) or self (doctor users)
  useEffect(() => {
    (async () => {
      try {
        if (user?.role === "Doctor") {
          // Doctor users can't pick — server enforces self
          setSelectedDoctor({ _id: "self", personalInfo: { fullName: user.fullName || user.firstName || "Self" } });
          return;
        }
        const r = await doctorService.getAllDoctors?.();
        const list = r?.data?.data || r?.data || r?.doctors || [];
        setDoctors(Array.isArray(list) ? list : []);
        if (existing?.doctorId) {
          const d = list.find(x => String(x._id) === String(existing.doctorId?._id || existing.doctorId));
          if (d) setSelectedDoctor(d);
        }
      } catch { /* non-fatal */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced patient search
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (selectedPatient) return;
    if (!patientQuery || patientQuery.trim().length < 2) { setPatientResults([]); return; }
    debRef.current = setTimeout(async () => {
      setPatientSearching(true);
      try {
        const r = await patientService.searchPatients(patientQuery.trim(), 20);
        setPatientResults(r?.data || r || []);
      } catch { /* silent */ }
      finally { setPatientSearching(false); }
    }, 250);
    return () => debRef.current && clearTimeout(debRef.current);
  }, [patientQuery, selectedPatient]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setNested = (parent, k, v) =>
    setForm((f) => ({ ...f, [parent]: { ...(f[parent] || {}), [k]: v } }));

  const addInjury = () =>
    setForm((f) => ({ ...f, injuries: [...(f.injuries || []), { region: "", type: "Abrasion", size: "", description: "", ageOfInjury: "" }] }));
  const updInjury = (i, k, v) =>
    setForm((f) => {
      const inj = [...(f.injuries || [])];
      inj[i] = { ...inj[i], [k]: v };
      return { ...f, injuries: inj };
    });
  const delInjury = (i) =>
    setForm((f) => ({ ...f, injuries: (f.injuries || []).filter((_, idx) => idx !== i) }));

  const save = async (statusOverride) => {
    if (!selectedPatient) { toast.warning("Pick a patient first"); return; }
    if (user?.role !== "Doctor" && !selectedDoctor) { toast.warning("Pick the doctor cutting the MLC"); return; }
    if (!form.mlcType) { toast.warning("MLC type is required"); return; }
    if (form.source === "External" && !form.externalDetails?.externalMlcNumber) {
      toast.warning("Enter the external MLC number");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        status: statusOverride || form.status || "Draft",
        patientId: selectedPatient._id,
        UHID: selectedPatient.UHID,
        ...(user?.role === "Doctor" ? {} : { doctorId: selectedDoctor?._id }),
      };
      let r;
      if (existing?._id) {
        r = await mlcService.update(existing._id, payload);
      } else {
        r = await mlcService.create(payload);
      }
      toast.success(existing ? "MLC updated" : `MLC recorded · MLR ${r?.data?.mlrNumber}`);
      onSaved(r?.data);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not save MLC");
    } finally { setSaving(false); }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal rx-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--er">
          <i className="pi pi-shield" />
          <span className="rx-modal-title">
            {existing ? `Edit MLC · ${existing.mlrNumber}` : "Cut / Record MLC"}
          </span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="rx-modal-body">
          {/* External vs Internal toggle */}
          {!existing && (
            <div className="mlc-toggle-pills">
              <div
                className={`mlc-toggle-pill ${form.source === "Internal" ? "mlc-toggle-pill--active" : ""}`}
                onClick={() => set("source", "Internal")}
              >
                <div className="mlc-toggle-pill-title">⚖ New / Internal MLC</div>
                <div className="mlc-toggle-pill-sub">
                  No MLC cut yet — record full incident + injury workup, this hospital issues the MLR.
                </div>
              </div>
              <div
                className={`mlc-toggle-pill mlc-toggle-pill--external ${form.source === "External" ? "mlc-toggle-pill--active" : ""}`}
                onClick={() => set("source", "External")}
              >
                <div className="mlc-toggle-pill-title">↗ External / Existing MLC</div>
                <div className="mlc-toggle-pill-sub">
                  MLC already cut elsewhere — just capture basic identifiers + local MLR for our records.
                </div>
              </div>
            </div>
          )}

          {/* Patient */}
          <div className="mlc-form-section">
            <div className="mlc-form-section-title">Patient</div>
            {selectedPatient ? (
              <div className="rx-mini-card">
                <div className="rx-mini-avatar">{(selectedPatient.fullName || "?")[0]?.toUpperCase()}</div>
                <div className="rx-mini-info">
                  <div className="rx-mini-name">
                    {selectedPatient.fullName}
                    <span className="rx-mono-tag">{selectedPatient.UHID}</span>
                  </div>
                  <div className="rx-mini-meta">
                    <span>{selectedPatient.gender || "—"}</span>
                    <span>{selectedPatient.age != null ? `${selectedPatient.age}y` : "—"}</span>
                    {selectedPatient.contactNumber && <span>📱 <strong>{selectedPatient.contactNumber}</strong></span>}
                  </div>
                </div>
                {!existing && (
                  <button className="rx-action-btn" onClick={() => { setSelectedPatient(null); setPatientQuery(""); }}>
                    <i className="pi pi-times" /> Change
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="rx-search">
                  <i className="pi pi-search" />
                  <input
                    placeholder="Search patient by name / UHID / mobile…"
                    value={patientQuery}
                    onChange={(e) => setPatientQuery(e.target.value)}
                    autoFocus
                  />
                  {patientSearching && <i className="pi pi-spin pi-spinner rx-spinner-info" />}
                </div>
                {patientResults.map((p) => (
                  <div
                    key={p._id}
                    className="rx-mini-card"
                    onClick={() => setSelectedPatient(p)}
                  >
                    <div className="rx-mini-avatar">{(p.fullName || "?")[0]?.toUpperCase()}</div>
                    <div className="rx-mini-info">
                      <div className="rx-mini-name">
                        {p.fullName}
                        <span className="rx-mono-tag">{p.UHID}</span>
                      </div>
                      <div className="rx-mini-meta">
                        {p.gender && <span>{p.gender}</span>}
                        {p.age != null && <span>{p.age}y</span>}
                        {p.contactNumber && <span>📱 <strong>{p.contactNumber}</strong></span>}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Doctor (admin/reception only) */}
          {user?.role !== "Doctor" && (
            <div className="mlc-form-section">
              <div className="mlc-form-section-title">Recording Doctor</div>
              <div className="his-field-group">
                <label className="his-label">Doctor cutting / recording the MLC *</label>
                <select
                  className="his-field"
                  value={selectedDoctor?._id || ""}
                  onChange={(e) => setSelectedDoctor(doctors.find(d => String(d._id) === e.target.value))}
                >
                  <option value="">— Select doctor —</option>
                  {doctors.map((d) => (
                    <option key={d._id} value={d._id}>
                      Dr. {d.personalInfo?.fullName || `${d.personalInfo?.firstName || ""} ${d.personalInfo?.lastName || ""}`}
                      {d.mlcPrefix ? ` · MLR series ${d.mlcPrefix}` : ""}
                    </option>
                  ))}
                </select>
                {selectedDoctor?.mlcPrefix && (
                  <div className="rx-text-subtle">
                    Next MLR will follow series <span className="mlc-prefix-pill">{selectedDoctor.mlcPrefix}xxxx</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* External basic details */}
          {form.source === "External" && (
            <div className="mlc-form-section">
              <div className="mlc-form-section-title">External MLC — Basic Details</div>
              <div className="mlc-section-grid">
                <div className="his-field-group">
                  <label className="his-label">External MLC Number *</label>
                  <input
                    className="his-field"
                    value={form.externalDetails?.externalMlcNumber || ""}
                    onChange={(e) => setNested("externalDetails", "externalMlcNumber", e.target.value)}
                    placeholder="e.g. AIIMS/MLC/2025/00342"
                  />
                </div>
                <div className="his-field-group">
                  <label className="his-label">Issuing Hospital / Authority</label>
                  <input
                    className="his-field"
                    value={form.externalDetails?.externalHospital || ""}
                    onChange={(e) => setNested("externalDetails", "externalHospital", e.target.value)}
                    placeholder="Hospital that cut the MLC"
                  />
                </div>
                <div className="his-field-group">
                  <label className="his-label">Date the External MLC was cut</label>
                  <input
                    className="his-field"
                    type="date"
                    value={form.externalDetails?.externalDate ? new Date(form.externalDetails.externalDate).toISOString().slice(0, 10) : ""}
                    onChange={(e) => setNested("externalDetails", "externalDate", e.target.value || null)}
                  />
                </div>
                <div className="his-field-group">
                  <label className="his-label">Remarks</label>
                  <input
                    className="his-field"
                    value={form.externalDetails?.remarks || ""}
                    onChange={(e) => setNested("externalDetails", "remarks", e.target.value)}
                    placeholder="Any extra notes"
                  />
                </div>
              </div>
            </div>
          )}

          {/* MLC type + incident */}
          <div className="mlc-form-section">
            <div className="mlc-form-section-title">Incident / Category</div>
            <div className="mlc-section-grid">
              <div className="his-field-group">
                <label className="his-label">MLC Type *</label>
                <select className="his-field" value={form.mlcType || "Other"} onChange={(e) => set("mlcType", e.target.value)}>
                  {MLC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="his-field-group">
                <label className="his-label">Incident Date</label>
                <input className="his-field" type="date"
                       value={form.incidentDate ? new Date(form.incidentDate).toISOString().slice(0, 10) : ""}
                       onChange={(e) => set("incidentDate", e.target.value || null)} />
              </div>
              <div className="his-field-group">
                <label className="his-label">Incident Time</label>
                <input className="his-field" value={form.incidentTime || ""} onChange={(e) => set("incidentTime", e.target.value)} placeholder="e.g. 10:45 PM" />
              </div>
              <div className="his-field-group">
                <label className="his-label">Place of Incident</label>
                <input className="his-field" value={form.incidentPlace || ""} onChange={(e) => set("incidentPlace", e.target.value)} placeholder="Location / address" />
              </div>
              <div className="his-field-group">
                <label className="his-label">Brought By</label>
                <input className="his-field" value={form.broughtBy || ""} onChange={(e) => set("broughtBy", e.target.value)} placeholder="Self / Relative / Police / Bystander" />
              </div>
              <div className="his-field-group">
                <label className="his-label">Brought-by Name</label>
                <input className="his-field" value={form.broughtByName || ""} onChange={(e) => set("broughtByName", e.target.value)} />
              </div>
              <div className="his-field-group">
                <label className="his-label">Brought-by Phone</label>
                <input className="his-field" value={form.broughtByPhone || ""} onChange={(e) => set("broughtByPhone", e.target.value)} />
              </div>
            </div>
            <div className="his-field-group">
              <label className="his-label">Alleged History (as narrated)</label>
              <textarea className="his-field" rows={2}
                        value={form.allegedHistory || ""}
                        onChange={(e) => set("allegedHistory", e.target.value)}
                        placeholder="Patient/attendant's narrative of what happened" />
            </div>
          </div>

          {/* Police */}
          <div className="mlc-form-section">
            <div className="mlc-form-section-title">Police Information</div>
            <div className="mlc-section-grid">
              <div className="his-field-group">
                <label className="his-label">
                  <input type="checkbox" checked={!!form.informedPolice} onChange={(e) => set("informedPolice", e.target.checked)} />
                  &nbsp;Police informed
                </label>
              </div>
              <div className="his-field-group">
                <label className="his-label">Police Station</label>
                <input className="his-field" value={form.policeStation || ""} onChange={(e) => set("policeStation", e.target.value)} />
              </div>
              <div className="his-field-group">
                <label className="his-label">FIR Number</label>
                <input className="his-field" value={form.firNumber || ""} onChange={(e) => set("firNumber", e.target.value)} />
              </div>
              <div className="his-field-group">
                <label className="his-label">Investigating Officer</label>
                <input className="his-field" value={form.investigatingOfficer || ""} onChange={(e) => set("investigatingOfficer", e.target.value)} />
              </div>
              <div className="his-field-group">
                <label className="his-label">Officer Contact</label>
                <input className="his-field" value={form.officerContact || ""} onChange={(e) => set("officerContact", e.target.value)} />
              </div>
            </div>
          </div>

          {/* Internal-only: clinical examination + injuries */}
          {form.source === "Internal" && (
            <>
              <div className="mlc-form-section">
                <div className="mlc-form-section-title">Clinical Examination</div>
                <div className="mlc-section-grid">
                  <div className="his-field-group">
                    <label className="his-label">General Condition</label>
                    <input className="his-field" value={form.generalCondition || ""} onChange={(e) => set("generalCondition", e.target.value)} />
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Consciousness</label>
                    <select className="his-field" value={form.consciousness || ""} onChange={(e) => set("consciousness", e.target.value)}>
                      <option value="">—</option>
                      <option>Alert</option>
                      <option>Drowsy</option>
                      <option>Stuporous</option>
                      <option>Unconscious</option>
                    </select>
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">
                      <input type="checkbox" checked={!!form.smellOfAlcohol} onChange={(e) => set("smellOfAlcohol", e.target.checked)} />
                      &nbsp;Smell of alcohol on breath
                    </label>
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">BP</label>
                    <input className="his-field" value={form.vitals?.bloodPressure || ""} onChange={(e) => setNested("vitals", "bloodPressure", e.target.value)} placeholder="120/80" />
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">Pulse (bpm)</label>
                    <input className="his-field" type="number" value={form.vitals?.pulse || ""} onChange={(e) => setNested("vitals", "pulse", Number(e.target.value) || undefined)} />
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">SpO₂ (%)</label>
                    <input className="his-field" type="number" value={form.vitals?.oxygenSaturation || ""} onChange={(e) => setNested("vitals", "oxygenSaturation", Number(e.target.value) || undefined)} />
                  </div>
                  <div className="his-field-group">
                    <label className="his-label">GCS</label>
                    <input className="his-field" type="number" value={form.vitals?.glasgowComaScale || ""} onChange={(e) => setNested("vitals", "glasgowComaScale", Number(e.target.value) || undefined)} />
                  </div>
                </div>
                <div className="his-field-group">
                  <label className="his-label">Examination Findings</label>
                  <textarea className="his-field" rows={2} value={form.examinationFindings || ""} onChange={(e) => set("examinationFindings", e.target.value)} />
                </div>
              </div>

              <div className="mlc-form-section">
                <div className="mlc-form-section-title">
                  Injuries
                  <button className="rx-action-btn rx-action-btn--primary" onClick={addInjury} style={{ float: "right" }}>
                    <i className="pi pi-plus" /> Add
                  </button>
                </div>
                {(form.injuries || []).length === 0 ? (
                  <div className="rx-text-subtle">No injuries documented yet.</div>
                ) : (
                  <table className="mlc-injuries-table">
                    <thead>
                      <tr>
                        <th>#</th><th>Region</th><th>Type</th><th>Size</th><th>Age</th><th>Description</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.injuries.map((inj, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td><input className="his-field" value={inj.region || ""} onChange={(e) => updInjury(i, "region", e.target.value)} placeholder="e.g. Right forearm" /></td>
                          <td>
                            <select className="his-field" value={inj.type || "Abrasion"} onChange={(e) => updInjury(i, "type", e.target.value)}>
                              {INJURY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </td>
                          <td><input className="his-field" value={inj.size || ""} onChange={(e) => updInjury(i, "size", e.target.value)} placeholder="3x2 cm" /></td>
                          <td><input className="his-field" value={inj.ageOfInjury || ""} onChange={(e) => updInjury(i, "ageOfInjury", e.target.value)} placeholder="Fresh / <24h" /></td>
                          <td><input className="his-field" value={inj.description || ""} onChange={(e) => updInjury(i, "description", e.target.value)} /></td>
                          <td><button className="rx-action-btn rx-action-btn--danger" onClick={() => delInjury(i)}><i className="pi pi-trash" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="mlc-form-section">
                <div className="mlc-form-section-title">Plan &amp; Opinion</div>
                <div className="his-field-group">
                  <label className="his-label">Investigations Advised</label>
                  <textarea className="his-field" rows={2} value={form.investigationsAdvised || ""} onChange={(e) => set("investigationsAdvised", e.target.value)} placeholder="X-ray, CT brain, blood alcohol level…" />
                </div>
                <div className="his-field-group">
                  <label className="his-label">Provisional Diagnosis</label>
                  <input className="his-field" value={form.provisionalDiagnosis || ""} onChange={(e) => set("provisionalDiagnosis", e.target.value)} />
                </div>
                <div className="his-field-group">
                  <label className="his-label">Doctor's Opinion</label>
                  <textarea className="his-field" rows={2} value={form.opinion || ""} onChange={(e) => set("opinion", e.target.value)} placeholder="Nature of injuries, simple/grievous, weapon used (if obvious), etc." />
                </div>
                <div className="his-field-group">
                  <label className="his-label">Disposition</label>
                  <select className="his-field" value={form.disposition || "Under Observation"} onChange={(e) => set("disposition", e.target.value)}>
                    <option>Under Observation</option>
                    <option>Admitted</option>
                    <option>Discharged</option>
                    <option>Referred</option>
                    <option>DOR</option>
                    <option>Absconded</option>
                    <option>Expired</option>
                  </select>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--neutral"
                  onClick={() => save("Draft")} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-save"}`} /> Save as Draft
          </button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--danger"
                  onClick={() => save("Finalized")} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check"}`} /> Finalize MLC
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── Detail / Print modal ─────────── */
function MLCDetailModal({ mlrNumber, onClose, onChanged }) {
  const [mlc, setMlc]       = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await mlcService.get(mlrNumber);
        setMlc(r?.data);
      } catch (e) {
        toast.error(e?.response?.data?.message || "Could not load MLC");
        onClose();
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mlrNumber]);

  const finalize = async () => {
    try {
      await mlcService.update(mlc._id, { status: "Finalized" });
      toast.success("MLC finalized");
      const r = await mlcService.get(mlrNumber);
      setMlc(r?.data);
      onChanged?.();
    } catch (e) { toast.error("Could not finalize"); }
  };
  const close = async () => {
    const reason = window.prompt("Close MLC — note the reason (e.g. case completed, police closure, expired):");
    if (!reason) return;
    try {
      await mlcService.update(mlc._id, { status: "Closed", closedReason: reason });
      toast.success("MLC closed");
      const r = await mlcService.get(mlrNumber);
      setMlc(r?.data);
      onChanged?.();
    } catch (e) { toast.error("Could not close"); }
  };
  const print = () => window.print();

  if (loading) {
    return (
      <div className="rx-modal-backdrop" onClick={onClose}>
        <div className="rx-modal" onClick={(e) => e.stopPropagation()}>
          <div className="rx-modal-body rx-empty">
            <i className="pi pi-spin pi-spinner rx-loader-icon" />
            <div className="rx-mt-10">Loading MLC…</div>
          </div>
        </div>
      </div>
    );
  }
  if (!mlc) return null;

  const canEdit = ["Doctor", "Admin"].includes(user?.role) && mlc.status !== "Closed";

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal rx-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--er">
          <i className="pi pi-shield" />
          <span className="rx-modal-title">
            MLR No. <span className="mlc-mlr-large">{mlc.mlrNumber}</span>
            <span className="rx-modal-sub">· {mlc.source} · {mlc.status}</span>
          </span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="rx-modal-body">
          {/* The stamp banner — included in print runs */}
          <MLCStamp mlrNumber={mlc.mlrNumber} variant="banner"
                    date={mlc.createdAt} doctor={mlc.doctorName} />

          <div className="mlc-form-section">
            <div className="mlc-form-section-title">Patient</div>
            <div className="rx-detail-grid">
              <Field label="Name"    value={mlc.patientName} />
              <Field label="UHID"    value={mlc.UHID} mono />
              <Field label="Age"     value={mlc.age != null ? `${mlc.age}y` : "—"} />
              <Field label="Gender"  value={mlc.gender} />
              <Field label="Contact" value={mlc.contactNumber} />
              <Field label="Doctor"  value={mlc.doctorName} />
            </div>
          </div>

          {mlc.source === "External" && mlc.externalDetails && (
            <div className="mlc-form-section">
              <div className="mlc-form-section-title">External MLC — Basic Details</div>
              <div className="rx-detail-grid">
                <Field label="External MLC #"  value={mlc.externalDetails.externalMlcNumber} mono />
                <Field label="Issuing Hospital" value={mlc.externalDetails.externalHospital} />
                <Field label="External Date"    value={fmtDate(mlc.externalDetails.externalDate)} />
                <Field label="Remarks"          value={mlc.externalDetails.remarks} wide />
              </div>
            </div>
          )}

          <div className="mlc-form-section">
            <div className="mlc-form-section-title">Incident</div>
            <div className="rx-detail-grid">
              <Field label="MLC Type"  value={mlc.mlcType} />
              <Field label="Date"      value={fmtDate(mlc.incidentDate)} />
              <Field label="Time"      value={mlc.incidentTime} />
              <Field label="Place"     value={mlc.incidentPlace} />
              <Field label="Brought By" value={[mlc.broughtBy, mlc.broughtByName].filter(Boolean).join(" — ")} />
              <Field label="Phone"     value={mlc.broughtByPhone} />
              <Field label="Alleged History" value={mlc.allegedHistory} wide />
            </div>
          </div>

          <div className="mlc-form-section">
            <div className="mlc-form-section-title">Police</div>
            <div className="rx-detail-grid">
              <Field label="Informed" value={mlc.informedPolice ? "Yes" : "No"} />
              <Field label="Station"  value={mlc.policeStation} />
              <Field label="FIR #"    value={mlc.firNumber} mono />
              <Field label="IO"       value={mlc.investigatingOfficer} />
              <Field label="Contact"  value={mlc.officerContact} />
            </div>
          </div>

          {mlc.source === "Internal" && (
            <>
              <div className="mlc-form-section">
                <div className="mlc-form-section-title">Clinical Examination</div>
                <div className="rx-detail-grid">
                  <Field label="General Condition" value={mlc.generalCondition} />
                  <Field label="Consciousness"     value={mlc.consciousness} />
                  <Field label="Alcohol Smell"     value={mlc.smellOfAlcohol ? "Yes" : "No"} />
                  <Field label="BP"                value={mlc.vitals?.bloodPressure} />
                  <Field label="Pulse"             value={mlc.vitals?.pulse ? `${mlc.vitals.pulse} bpm` : "—"} />
                  <Field label="SpO₂"              value={mlc.vitals?.oxygenSaturation ? `${mlc.vitals.oxygenSaturation}%` : "—"} />
                  <Field label="GCS"               value={mlc.vitals?.glasgowComaScale} />
                  <Field label="Findings"          value={mlc.examinationFindings} wide />
                </div>
              </div>

              {(mlc.injuries || []).length > 0 && (
                <div className="mlc-form-section">
                  <div className="mlc-form-section-title">Injuries</div>
                  <table className="mlc-injuries-table">
                    <thead>
                      <tr><th>#</th><th>Region</th><th>Type</th><th>Size</th><th>Age</th><th>Description</th></tr>
                    </thead>
                    <tbody>
                      {mlc.injuries.map((inj, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>{inj.region || "—"}</td>
                          <td>{inj.type}</td>
                          <td>{inj.size || "—"}</td>
                          <td>{inj.ageOfInjury || "—"}</td>
                          <td>{inj.description || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mlc-form-section">
                <div className="mlc-form-section-title">Plan &amp; Opinion</div>
                <div className="rx-detail-grid">
                  <Field label="Investigations"        value={mlc.investigationsAdvised} wide />
                  <Field label="Provisional Diagnosis" value={mlc.provisionalDiagnosis} />
                  <Field label="Opinion"               value={mlc.opinion} wide />
                  <Field label="Disposition"           value={mlc.disposition} />
                </div>
              </div>
            </>
          )}

          {mlc.status === "Closed" && mlc.closedReason && (
            <div className="rx-banner rx-banner--neutral">
              <strong>Closed:</strong> {mlc.closedReason} · {fmtDateTime(mlc.closedAt)}
            </div>
          )}
        </div>

        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Close</button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--neutral" onClick={print}>
            <i className="pi pi-print" /> Print
          </button>
          {canEdit && mlc.status === "Draft" && (
            <button className="rx-modal-btn-primary rx-modal-btn-primary--success" onClick={finalize}>
              <i className="pi pi-check" /> Finalize
            </button>
          )}
          {canEdit && mlc.status === "Finalized" && (
            <button className="rx-modal-btn-primary rx-modal-btn-primary--danger" onClick={close}>
              <i className="pi pi-flag" /> Close MLC
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono, wide }) {
  const display = (value == null || value === "" || value === "undefined undefined") ? "—" : value;
  return (
    <div className={`rx-field ${wide ? "rx-field--wide" : ""}`}>
      <div className="rx-field-label">{label}</div>
      <div className={`rx-field-value ${mono ? "rx-mono-tag" : ""}`}>{display}</div>
    </div>
  );
}
