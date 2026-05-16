/**
 * PatientsTable.jsx — All-patients directory page (/allpatient)
 *
 * Uses the system-wide rx-* design system (reception-shared.css) instead of
 * PrimeReact so it matches the rest of the receptionist / admin shell.
 *
 * Features:
 *   • Header with live total + actions (refresh, register)
 *   • Registration-type KPI tiles (OPD / IPD / ER / Daycare / Services)
 *   • Tab filter by registration type
 *   • Free-text search across name / UHID / phone / email
 *   • Compact table with all clinically-relevant columns
 *   • Drawer-style modals for view + delete
 *   • Re-uses PatientHistoryModal for the timeline view
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import patientService from "../Services/patient/patientService";
import PatientHistoryModal from "../Components/PatientHistoryModal";
import { useAuth } from "../context/AuthContext";
import "../pages/reception/reception-shared.css";
import "./clinical/clinical-forms.css";

const TABS = [
  { key: "ALL",       label: "All",       icon: "pi-users" },
  { key: "OPD",       label: "OPD",       icon: "pi-user-plus" },
  { key: "IPD",       label: "IPD",       icon: "pi-home" },
  { key: "Emergency", label: "Emergency", icon: "pi-bolt" },
  { key: "Daycare",   label: "Daycare",   icon: "pi-sun" },
  { key: "Services",  label: "Services",  icon: "pi-cog" },
];

const fmtDate = (d) => {
  if (!d) return "—";
  const x = new Date(d);
  if (isNaN(x)) return "—";
  return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}`;
};

const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const computeAge = (p) => {
  if (p.age) return p.age;
  if (!p.dateOfBirth) return null;
  const dob = new Date(p.dateOfBirth);
  if (isNaN(dob)) return null;
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
};

const fullAddress = (p) => {
  if (!p.address) return "";
  if (typeof p.address === "string") return p.address;
  return [
    p.address.completeAddress,
    p.address.city,
    p.address.district,
    p.address.state,
    p.address.pincode,
  ].filter(Boolean).join(", ");
};

const docLabel = (p) => {
  const d = p.doctor;
  if (!d) return "—";
  if (typeof d === "string") return d;
  const pi = d.personalInfo || {};
  const name = [pi.firstName, pi.lastName].filter(Boolean).join(" ");
  return name ? `Dr. ${name}` : "—";
};

const deptLabel = (p) => {
  if (!p.department) return "—";
  if (typeof p.department === "string") return p.department;
  return p.department.departmentName || "—";
};

const tpaLabel = (p) => {
  if (p.tpa && typeof p.tpa === "object") return p.tpa.tpaName || "TPA";
  if (p.tpa) return "TPA";
  return "Cash";
};

export default function PatientsTable() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canRegister = ["Admin", "Receptionist"].includes(user?.role);
  const canDelete   = user?.role === "Admin";

  const [patients, setPatients]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState("ALL");
  const [search, setSearch]       = useState("");
  const [page, setPage]           = useState(1);
  const ROWS_PER_PAGE             = 12;

  const [viewing, setViewing]     = useState(null);
  const [deleting, setDeleting]   = useState(null);
  const [historyFor, setHistoryFor] = useState(null);

  /* ── Fetch all patients ─────────────────────────────────── */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await patientService.getAllPatients();
      const raw = response?.data || response?.patients || response || [];
      const list = Array.isArray(raw) ? raw : raw.patients || [];
      setPatients(list);
    } catch (e) {
      toast.error("Could not load patient directory");
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  /* ── Derived data ───────────────────────────────────────── */
  const counts = useMemo(() => {
    const c = { ALL: patients.length, OPD: 0, IPD: 0, Emergency: 0, Daycare: 0, Services: 0 };
    patients.forEach((p) => {
      const t = p.registrationType || "OPD";
      if (c[t] != null) c[t] += 1;
    });
    return c;
  }, [patients]);

  const filtered = useMemo(() => {
    let r = patients;
    if (tab !== "ALL") r = r.filter((p) => (p.registrationType || "OPD") === tab);
    const s = search.trim().toLowerCase();
    if (s) {
      r = r.filter((p) =>
        (p.fullName || "").toLowerCase().includes(s) ||
        (p.UHID     || "").toLowerCase().includes(s) ||
        (p.contactNumber || "").toLowerCase().includes(s) ||
        (p.email    || "").toLowerCase().includes(s)
      );
    }
    return r;
  }, [patients, tab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  useEffect(() => { if (page > totalPages) setPage(1); }, [totalPages, page]);
  const pageRows = filtered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  /* ── Actions ────────────────────────────────────────────── */
  const handleEdit = (p) =>
    navigate(`/reception/register?patientId=${p._id}`);

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await patientService.deletePatient(deleting._id);
      toast.success("Patient deleted");
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Delete failed");
    }
  };

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div className="rx-page">
      {/* Header */}
      <div className="rx-header">
        <div>
          <div className="rx-header-title">
            <i className="pi pi-users" /> All Patients Directory
          </div>
          <div className="rx-header-meta">
            Showing <strong>{filtered.length}</strong> of <strong>{patients.length}</strong> patients
            {search && <> · matching “<strong>{search}</strong>”</>}
          </div>
        </div>
        <div className="rx-header-actions">
          <button className="rx-btn-ghost" onClick={() => navigate(-1)}>
            <i className="pi pi-arrow-left" /> Back
          </button>
          <button className="rx-btn-ghost" onClick={load}>
            <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} /> Refresh
          </button>
          {canRegister && (
            <button className="rx-btn-primary" onClick={() => navigate("/registration")}>
              <i className="pi pi-user-plus" /> Register Patient
            </button>
          )}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="rx-kpis">
        <div className="rx-kpi rx-kpi--accent">
          <div className="rx-kpi-label">Total Patients</div>
          <div className="rx-kpi-value">{counts.ALL}</div>
          <div className="rx-kpi-sub">across all registration types</div>
        </div>
        <div className="rx-kpi">
          <div className="rx-kpi-label rx-text-info">OPD</div>
          <div className="rx-kpi-value rx-text-info">{counts.OPD}</div>
        </div>
        <div className="rx-kpi">
          <div className="rx-kpi-label rx-text-primary">IPD</div>
          <div className="rx-kpi-value rx-text-primary">{counts.IPD}</div>
        </div>
        <div className="rx-kpi">
          <div className="rx-kpi-label rx-text-danger">Emergency</div>
          <div className="rx-kpi-value rx-text-danger">{counts.Emergency}</div>
        </div>
        <div className="rx-kpi">
          <div className="rx-kpi-label rx-text-warning">Daycare</div>
          <div className="rx-kpi-value rx-text-warning">{counts.Daycare}</div>
        </div>
        <div className="rx-kpi">
          <div className="rx-kpi-label rx-text-success">Services</div>
          <div className="rx-kpi-value rx-text-success">{counts.Services}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="rx-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`rx-tab ${tab === t.key ? "rx-tab--active" : ""}`}
            onClick={() => { setTab(t.key); setPage(1); }}
          >
            <i className={`pi ${t.icon}`} /> {t.label}
            <span className="rx-tab-count">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="rx-search">
        <i className="pi pi-search" />
        <input
          placeholder="Search by name, UHID, phone, or email…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          autoFocus
        />
        {search && (
          <button className="rx-action-btn" onClick={() => setSearch("")}>
            <i className="pi pi-times" />
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="rx-empty">
          <i className="pi pi-spin pi-spinner rx-loader-icon" />
          <div className="rx-mt-10">Loading patient directory…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rx-empty">
          <span className="rx-empty-icon">😶</span>
          {search
            ? <>No patients match “<strong>{search}</strong>”.</>
            : tab === "ALL"
              ? "No patients registered yet."
              : <>No <strong>{tab}</strong> patients in the directory.</>}
          {canRegister && (
            <div className="rx-mt-10">
              <button className="rx-btn-primary" onClick={() => navigate("/registration")}>
                <i className="pi pi-user-plus" /> Register First Patient
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="rx-table-wrap">
            <table className="rx-table rx-table--sm">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>UHID</th>
                  <th>Age / Sex</th>
                  <th>Contact</th>
                  <th>Type</th>
                  <th>Doctor</th>
                  <th>Department</th>
                  <th>Payment</th>
                  <th className="rx-text-strong">Visits</th>
                  <th>Last Visit</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => {
                  const age = computeAge(p);
                  const rt = p.registrationType || "OPD";
                  return (
                    <tr key={p._id || p.UHID}>
                      <td>
                        <div className="rx-cell-name">
                          {p.title ? <span className="rx-text-muted">{p.title} </span> : null}
                          <strong>{p.fullName || "—"}</strong>
                          {p.isMLC && <span className="rx-card-stage rx-card-stage--denied">MLC</span>}
                        </div>
                        {p.bloodGroup && p.bloodGroup !== "Unknown" && p.bloodGroup !== "Not Known" && (
                          <div className="rx-cell-sub">🩸 {p.bloodGroup}</div>
                        )}
                      </td>
                      <td><span className="rx-mono-tag">{p.UHID || "—"}</span></td>
                      <td>
                        {age != null ? `${age}y` : "—"}
                        {p.gender && <span className="rx-text-muted"> · {p.gender[0]}</span>}
                      </td>
                      <td>
                        <div>{p.contactNumber || "—"}</div>
                        {p.email && <div className="rx-cell-sub">{p.email}</div>}
                      </td>
                      <td><RegTypePill rt={rt} /></td>
                      <td>{docLabel(p)}</td>
                      <td>{deptLabel(p)}</td>
                      <td>
                        <span className={`rx-tariff-pill ${p.tpa ? "" : "rx-text-muted"}`}>
                          {tpaLabel(p)}
                        </span>
                      </td>
                      <td><VisitChips p={p} /></td>
                      <td>{fmtDate(p.lastVisitDate)}</td>
                      <td>
                        <div className="rx-flex-row">
                          <button
                            className="rx-action-btn rx-action-btn--primary"
                            title="View details"
                            onClick={() => setViewing(p)}
                          >
                            <i className="pi pi-eye" />
                          </button>
                          <button
                            className="rx-action-btn"
                            title="Visit history"
                            onClick={() => setHistoryFor(p._id)}
                          >
                            <i className="pi pi-history" />
                          </button>
                          {canRegister && (
                            <button
                              className="rx-action-btn rx-action-btn--success"
                              title="Edit"
                              onClick={() => handleEdit(p)}
                            >
                              <i className="pi pi-pencil" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              className="rx-action-btn rx-action-btn--danger"
                              title="Delete"
                              onClick={() => setDeleting(p)}
                            >
                              <i className="pi pi-trash" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="rx-pager">
            <span className="rx-text-subtle">
              Showing {(page - 1) * ROWS_PER_PAGE + 1}–{Math.min(page * ROWS_PER_PAGE, filtered.length)} of {filtered.length}
            </span>
            <div className="rx-flex-row">
              <button
                className="rx-action-btn"
                disabled={page <= 1}
                onClick={() => setPage((x) => Math.max(1, x - 1))}
              >
                <i className="pi pi-chevron-left" /> Prev
              </button>
              <span className="rx-pager-info">Page {page} / {totalPages}</span>
              <button
                className="rx-action-btn"
                disabled={page >= totalPages}
                onClick={() => setPage((x) => Math.min(totalPages, x + 1))}
              >
                Next <i className="pi pi-chevron-right" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* View modal */}
      {viewing && (
        <ViewPatientModal
          patient={viewing}
          onClose={() => setViewing(null)}
          onEdit={canRegister ? () => { handleEdit(viewing); setViewing(null); } : null}
          onViewHistory={() => { setHistoryFor(viewing._id); setViewing(null); }}
        />
      )}

      {/* Delete modal */}
      {deleting && (
        <DeletePatientModal
          patient={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}

      {/* History modal */}
      <PatientHistoryModal
        patientId={historyFor}
        visible={!!historyFor}
        onHide={() => setHistoryFor(null)}
      />
    </div>
  );
}

/* ─────────── Reg-type coloured pill ─────────── */
function RegTypePill({ rt }) {
  const map = {
    OPD:       { cls: "rx-card-stage--done",      label: "OPD" },
    IPD:       { cls: "rx-card-stage--submitted", label: "IPD" },
    Emergency: { cls: "rx-card-stage--denied",    label: "Emergency" },
    Daycare:   { cls: "rx-card-stage--pending",   label: "Daycare" },
    Services:  { cls: "rx-card-stage--approved",  label: "Services" },
  };
  const meta = map[rt] || map.OPD;
  return <span className={`rx-card-stage ${meta.cls}`}>{meta.label}</span>;
}

/* ─────────── Visit counts (chips) ─────────── */
function VisitChips({ p }) {
  const items = [
    ["O", p.totalOPDVisits        || 0, "opd"],
    ["I", p.totalIPDVisits        || 0, "ipd"],
    ["E", p.totalEmergencyVisits  || 0, "er"],
  ];
  return (
    <div className="rx-visit-chips">
      {items.map(([k, v, variant]) => (
        <span key={k} className={`rx-visit-chip rx-visit-chip--${variant}`} title={`${k} visits`}>
          <span className="rx-visit-chip-k">{k}</span>
          <span className="rx-visit-chip-v">{v}</span>
        </span>
      ))}
    </div>
  );
}

/* ─────────── View Patient Modal ─────────── */
function ViewPatientModal({ patient: p, onClose, onEdit, onViewHistory }) {
  const age = computeAge(p);
  const addr = fullAddress(p);

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal rx-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="rx-modal-head">
          <i className="pi pi-user" />
          <span className="rx-modal-title">
            {p.title} {p.fullName} <span className="rx-modal-sub">· UHID {p.UHID}</span>
          </span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="rx-modal-body">
          {/* Quick visit-counters strip */}
          <div className="rx-counter-row">
            <CounterTile label="OPD"       value={p.totalOPDVisits       || 0} variant="opd" />
            <CounterTile label="IPD"       value={p.totalIPDVisits       || 0} variant="ipd" />
            <CounterTile label="ER"        value={p.totalEmergencyVisits || 0} variant="er"  />
            <CounterTile label="DAY"       value={p.totalDaycareVisits   || 0} variant="opd" />
            <CounterTile label="SVC"       value={p.totalServicesVisits  || 0} variant="ipd" />
          </div>

          {/* Personal info */}
          <SectionHeading icon="pi-user" label="Personal Information" />
          <div className="rx-detail-grid">
            <Field label="Full Name"     value={`${p.title || ""} ${p.fullName || ""}`.trim()} />
            <Field label="UHID"          value={p.UHID} mono />
            <Field label="Phone"         value={p.contactNumber} />
            <Field label="Email"         value={p.email} />
            <Field label="Date of Birth" value={fmtDate(p.dateOfBirth)} />
            <Field label="Age"           value={age != null ? `${age} years` : "—"} />
            <Field label="Gender"        value={p.gender} />
            <Field label="Blood Group"   value={p.bloodGroup} />
            <Field label="Marital"       value={p.maritalStatus} />
            <Field label="Reg. Type"     value={<RegTypePill rt={p.registrationType || "OPD"} />} />
          </div>

          {/* Medical */}
          <SectionHeading icon="pi-heart" label="Medical & Visit Context" />
          <div className="rx-detail-grid">
            <Field label="Doctor"        value={docLabel(p)} />
            <Field label="Department"    value={deptLabel(p)} />
            <Field label="Payment"       value={tpaLabel(p)} />
            <Field label="Policy #"      value={p.policyNumber} />
            <Field label="Sum Insured"   value={p.sumInsured ? `₹${Number(p.sumInsured).toLocaleString("en-IN")}` : "—"} />
            <Field label="Last Visit"    value={fmtDateTime(p.lastVisitDate)} />
            <Field label="MLC"           value={p.isMLC ? "Yes" : "No"} />
            <Field
              label="Allergies"
              value={
                Array.isArray(p.knownAllergies)
                  ? (p.knownAllergies.length ? p.knownAllergies.join(", ") : "None")
                  : (p.knownAllergies || "None")
              }
              danger={
                (Array.isArray(p.knownAllergies) && p.knownAllergies.length > 0) ||
                (typeof p.knownAllergies === "string" && p.knownAllergies.trim() && p.knownAllergies.trim().toLowerCase() !== "none")
              }
              wide
            />
            <Field label="Address" value={addr || "—"} wide />
          </div>

          {/* Companion */}
          {(p.companionName || p.companionContact) && (
            <>
              <SectionHeading icon="pi-users" label="Companion / Next of Kin" />
              <div className="rx-detail-grid">
                <Field label="Name"     value={p.companionName} />
                <Field label="Relation" value={p.companionRelationship} />
                <Field label="Contact"  value={p.companionContact} />
              </div>
            </>
          )}
        </div>

        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Close</button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--neutral" onClick={onViewHistory}>
            <i className="pi pi-history" /> View Full History
          </button>
          {onEdit && (
            <button className="rx-modal-btn-primary rx-modal-btn-primary--success" onClick={onEdit}>
              <i className="pi pi-pencil" /> Edit Patient
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────── Delete Patient Modal ─────────── */
function DeletePatientModal({ patient, onCancel, onConfirm }) {
  return (
    <div className="rx-modal-backdrop" onClick={onCancel}>
      <div className="rx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--danger">
          <i className="pi pi-exclamation-triangle" />
          <span className="rx-modal-title">Delete Patient</span>
          <button className="rx-modal-close" onClick={onCancel}>×</button>
        </div>
        <div className="rx-modal-body">
          <p className="rx-modal-para">
            You are about to delete <strong>{patient.fullName}</strong> (UHID <span className="rx-mono-tag">{patient.UHID}</span>).
          </p>
          <div className="rx-banner rx-banner--danger">
            <strong>Warning:</strong> The patient is removed from the active directory.
            Existing visits, bills and clinical records remain intact for audit.
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--danger" onClick={onConfirm}>
            <i className="pi pi-trash" /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── Tiny UI helpers ─────────── */
function CounterTile({ label, value, variant }) {
  return (
    <div className="rx-counter-tile">
      <div className={`rx-counter-tile-value rx-counter-tile-value--${variant}`}>{value}</div>
      <div className="rx-counter-tile-label">{label} VISITS</div>
    </div>
  );
}

function SectionHeading({ icon, label }) {
  return (
    <div className="rx-section-label">
      <i className={`pi ${icon}`} /> {label}
    </div>
  );
}

function Field({ label, value, mono, danger, wide }) {
  const display = (value == null || value === "" || value === "undefined undefined") ? "—" : value;
  return (
    <div className={`rx-field ${wide ? "rx-field--wide" : ""}`}>
      <div className="rx-field-label">{label}</div>
      <div className={`rx-field-value ${mono ? "rx-mono-tag" : ""} ${danger ? "rx-text-danger" : ""}`}>
        {display}
      </div>
    </div>
  );
}
