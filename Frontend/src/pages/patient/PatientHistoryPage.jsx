/**
 * PatientHistoryPage.jsx — Full visit timeline for any patient
 *
 * Workflow:
 *   1. Search by name / UHID / phone (or arrive with `?uhid=…` pre-filled)
 *   2. Pick the patient → fetch OPD visits + IPD admissions + Emergency
 *      visits in parallel
 *   3. Show:
 *      • Header card with patient identity, visit counters, last visit
 *      • Tabs to filter the unified timeline (All / OPD / IPD / ER)
 *      • Single chronological timeline (latest first)
 *
 * Uses the system rx-* design system (reception-shared.css) and drops the
 * PrimeReact theme that made the page look alien.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import patientService from "../../Services/patient/patientService";
import opdService from "../../Services/patient/opdService";
import { API_ENDPOINTS } from "../../config/api";
import "../reception/reception-shared.css";

/* ─── Formatters ─────────────────────────────────────────────── */
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const calcAge = (dob, fallback) => {
  if (fallback) return `${fallback} yrs`;
  if (!dob) return "—";
  const today = new Date(), b = new Date(dob);
  if (isNaN(b)) return "—";
  let a = today.getFullYear() - b.getFullYear();
  if (today.getMonth() < b.getMonth() || (today.getMonth() === b.getMonth() && today.getDate() < b.getDate())) a -= 1;
  return a < 0 ? "—" : `${a} yrs`;
};
const initials = (name = "") =>
  (name.trim().split(/\s+/).slice(0, 2).map(p => p[0] || "").join("") || "?").toUpperCase();

const docName = (d) => {
  if (!d) return "—";
  if (typeof d === "string") return d;
  const pi = d.personalInfo || {};
  const full = pi.fullName || [pi.firstName, pi.lastName].filter(Boolean).join(" ");
  return full ? `Dr. ${full}` : d.name || "—";
};
const deptName = (d) => {
  if (!d) return "—";
  if (typeof d === "string") return d;
  return d.departmentName || d.name || "—";
};

const TABS = [
  { key: "ALL",       label: "All",       icon: "pi-history" },
  { key: "OPD",       label: "OPD",       icon: "pi-user-plus" },
  { key: "IPD",       label: "IPD",       icon: "pi-home" },
  { key: "Emergency", label: "Emergency", icon: "pi-bolt" },
];

/* ─── Cross-route loaders ─────────────────────────────────────── */
const loadAdmissions = async (patientId, uhid) => {
  const BASE = API_ENDPOINTS.ADMISSIONS;
  const extract = (r) => {
    const d = r?.data?.admissions || r?.data?.data || r?.data;
    return Array.isArray(d) ? d : null;
  };
  try {
    const r = await axios.get(BASE, { params: { patientId, limit: 200 } });
    const d = extract(r);
    if (d) return d;
  } catch { /* fall through */ }
  if (uhid) {
    try {
      const r = await axios.get(BASE, { params: { UHID: uhid, limit: 200 } });
      const d = extract(r);
      if (d) return d;
    } catch { /* fall through */ }
  }
  return [];
};

const loadEmergencies = async (patientId) => {
  try {
    const r = await axios.get(`${API_ENDPOINTS.EMERGENCY}/patient/${patientId}`);
    const d = r?.data?.data || r?.data;
    return Array.isArray(d) ? d : [];
  } catch { return []; }
};

const loadOPDVisits = async (patientId) => {
  try {
    const r = await opdService.getPatientOPDHistory(patientId);
    const d = r?.data?.data || r?.data;
    return Array.isArray(d) ? d : [];
  } catch { return []; }
};

/* ─── Page ────────────────────────────────────────────────────── */
export default function PatientHistoryPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [query, setQuery]               = useState(params.get("q") || "");
  const [searching, setSearching]       = useState(false);
  const [results, setResults]           = useState([]);
  const [searchDone, setSearchDone]     = useState(false);
  const debRef = useRef(null);

  const [selected, setSelected]         = useState(null);
  const [opd, setOpd]                   = useState([]);
  const [adm, setAdm]                   = useState([]);
  const [er,  setEr]                    = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [tab, setTab]                   = useState("ALL");

  /* ── Search (debounced) ───────────────────────────────────── */
  const runSearch = useCallback(async (q) => {
    if (q.trim().length < 2) { setResults([]); setSearchDone(false); return; }
    setSearching(true);
    try {
      const res = await patientService.searchPatients(q.trim(), 20);
      setResults(res?.data || res || []);
    } catch (e) {
      toast.error(e?.message || "Search failed");
    } finally {
      setSearching(false);
      setSearchDone(true);
    }
  }, []);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (selected) return; // don't bug-search while viewing a patient
    debRef.current = setTimeout(() => runSearch(query), 250);
    return () => debRef.current && clearTimeout(debRef.current);
  }, [query, selected, runSearch]);

  /* ── Pick a patient & load full history ───────────────────── */
  const selectPatient = useCallback(async (patient) => {
    setSelected(patient);
    setOpd([]); setAdm([]); setEr([]);
    setTab("ALL");
    setLoadingHistory(true);
    params.set("uhid", patient.UHID || "");
    setParams(params, { replace: true });
    try {
      const [opdList, admList, erList] = await Promise.all([
        loadOPDVisits(patient._id),
        loadAdmissions(patient._id, patient.UHID),
        loadEmergencies(patient._id),
      ]);
      setOpd(opdList);
      setAdm(admList);
      setEr(erList);
    } finally {
      setLoadingHistory(false);
    }
  }, [params, setParams]);

  /* ── Pre-load from ?uhid= query (deep link) ───────────────── */
  useEffect(() => {
    const uhid = params.get("uhid");
    if (!uhid || selected) return;
    (async () => {
      try {
        const { data } = await axios.get(`${API_ENDPOINTS.PATIENTS}/uhid/${uhid}`);
        const p = data?.data || data;
        if (p && p._id) selectPatient(p);
      } catch { /* silent */ }
    })();
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const back = () => {
    setSelected(null); setOpd([]); setAdm([]); setEr([]);
    params.delete("uhid");
    setParams(params, { replace: true });
  };

  /* ── Build unified timeline ───────────────────────────────── */
  const timeline = useMemo(() => {
    const items = [];
    opd.forEach((v) => items.push({
      kind: "OPD",
      date: v.visitDate || v.createdAt,
      data: v,
    }));
    adm.forEach((a) => items.push({
      kind: a.admissionType === "Day Care" || a.admissionType === "Daycare" ? "Daycare" :
            a.admissionType === "Emergency" ? "Emergency" : "IPD",
      date: a.admissionDate || a.admissionDateTime || a.createdAt,
      data: a,
    }));
    er.forEach((e) => items.push({
      kind: "Emergency",
      date: e.arrivalDate || e.arrivalDateTime || e.createdAt,
      data: e,
    }));
    return items
      .filter((x) => x.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [opd, adm, er]);

  const filtered = useMemo(() => {
    if (tab === "ALL") return timeline;
    if (tab === "IPD") return timeline.filter((x) => x.kind === "IPD" || x.kind === "Daycare");
    if (tab === "Emergency") return timeline.filter((x) => x.kind === "Emergency");
    return timeline.filter((x) => x.kind === tab);
  }, [timeline, tab]);

  /* ── Visit counters (from patient doc, fall back to live lists) ── */
  const counters = useMemo(() => {
    const p = selected || {};
    return {
      OPD:        p.totalOPDVisits        ?? opd.length,
      IPD:        p.totalIPDVisits        ?? adm.filter(a => a.admissionType !== "Day Care" && a.admissionType !== "Daycare" && a.admissionType !== "Emergency").length,
      Emergency:  p.totalEmergencyVisits  ?? Math.max(er.length, adm.filter(a => a.admissionType === "Emergency").length),
      Daycare:    p.totalDaycareVisits    ?? adm.filter(a => a.admissionType === "Day Care" || a.admissionType === "Daycare").length,
      Services:   p.totalServicesVisits   ?? 0,
    };
  }, [selected, opd, adm, er]);
  const totalVisits = counters.OPD + counters.IPD + counters.Emergency + counters.Daycare + counters.Services;

  return (
    <div className="rx-page">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="rx-header">
        <div>
          <div className="rx-header-title">
            <i className="pi pi-history" /> Patient Visit History
          </div>
          <div className="rx-header-meta">
            {selected
              ? <>Viewing complete visit timeline for <strong>{selected.fullName}</strong></>
              : <>Search any patient to view their complete OPD / IPD / Emergency visit timeline</>}
          </div>
        </div>
        <div className="rx-header-actions">
          {selected && (
            <button className="rx-btn-ghost" onClick={back}>
              <i className="pi pi-arrow-left" /> Back to Search
            </button>
          )}
          <button className="rx-btn-ghost" onClick={() => navigate(-1)}>
            <i className="pi pi-times" /> Close
          </button>
        </div>
      </div>

      {/* ── Search mode ───────────────────────────────────────── */}
      {!selected && (
        <>
          <div className="rx-search rx-mb-12">
            <i className="pi pi-search" />
            <input
              autoFocus
              placeholder="Search by name, UHID (e.g. UH0001), or 10-digit mobile…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {searching && <i className="pi pi-spin pi-spinner rx-spinner-info" />}
            {query && !searching && (
              <button className="rx-action-btn" onClick={() => setQuery("")}>
                <i className="pi pi-times" />
              </button>
            )}
          </div>

          {query.trim().length < 2 ? (
            <div className="rx-empty">
              <span className="rx-empty-icon">🔍</span>
              Start typing to find a patient.
              <div className="rx-empty-tip">Tip: minimum 2 characters — name, UHID, or mobile number.</div>
            </div>
          ) : searching ? (
            <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
          ) : searchDone && results.length === 0 ? (
            <div className="rx-empty">
              <span className="rx-empty-icon">😶</span>
              No patient found for <strong>"{query}"</strong>
            </div>
          ) : (
            results.map((p) => (
              <div
                key={p._id}
                className={`rx-mini-card ${p.gender === "Female" ? "is-female" : ""}`}
                onClick={() => selectPatient(p)}
              >
                <div className="rx-mini-avatar">{initials(p.fullName)}</div>
                <div className="rx-mini-info">
                  <div className="rx-mini-name">
                    {p.title} {p.fullName || "Unknown"}
                    {p.isMLC && <span className="rx-card-stage rx-card-stage--denied">MLC</span>}
                    {p.tpa && <span className="rx-card-stage rx-card-stage--submitted">TPA</span>}
                    <span className="rx-mono-tag">{p.UHID}</span>
                  </div>
                  <div className="rx-mini-meta">
                    <span>{p.gender || "—"}</span>
                    <span>{calcAge(p.dateOfBirth, p.age)}</span>
                    {p.contactNumber && <span>📱 <strong>{p.contactNumber}</strong></span>}
                    {p.bloodGroup && p.bloodGroup !== "Unknown" && p.bloodGroup !== "Not Known" && (
                      <span>🩸 <strong>{p.bloodGroup}</strong></span>
                    )}
                    {p.lastVisitDate && <span>Last: <strong>{fmtDate(p.lastVisitDate)}</strong></span>}
                  </div>
                </div>
                <button
                  className="rx-action-btn rx-action-btn--primary"
                  onClick={(e) => { e.stopPropagation(); selectPatient(p); }}
                >
                  <i className="pi pi-clock" /> View Timeline
                </button>
              </div>
            ))
          )}
        </>
      )}

      {/* ── Selected patient view ─────────────────────────────── */}
      {selected && (
        <>
          {/* Patient profile card */}
          <div className="rx-detail-card rx-mb-12">
            <div className="rx-detail-head">
              <div className="rx-mini-avatar">{initials(selected.fullName)}</div>
              <div className="rx-flex-1 rx-min-zero">
                <div className="rx-detail-head-title">
                  {selected.title} {selected.fullName}
                  {selected.isMLC && <span className="rx-card-stage rx-card-stage--denied">MLC</span>}
                  {selected.tpa && <span className="rx-card-stage rx-card-stage--submitted">TPA</span>}
                </div>
                <div className="rx-detail-head-sub">
                  <span className="rx-mono-tag">UHID {selected.UHID}</span>
                  &nbsp;·&nbsp;{selected.gender || "—"}
                  &nbsp;·&nbsp;{calcAge(selected.dateOfBirth, selected.age)}
                  {selected.contactNumber && <>&nbsp;·&nbsp;📱 {selected.contactNumber}</>}
                  {selected.bloodGroup && selected.bloodGroup !== "Unknown" && selected.bloodGroup !== "Not Known" && (
                    <>&nbsp;·&nbsp;🩸 {selected.bloodGroup}</>
                  )}
                  {selected.email && <>&nbsp;·&nbsp;{selected.email}</>}
                </div>
              </div>
            </div>

            <div className="rx-detail-body">
              {/* Counter strip */}
              <div className="rx-counter-row">
                <CounterTile label="OPD"        value={counters.OPD}        variant="opd" />
                <CounterTile label="IPD"        value={counters.IPD}        variant="ipd" />
                <CounterTile label="ER"         value={counters.Emergency}  variant="er"  />
                <CounterTile label="DAY"        value={counters.Daycare}    variant="opd" />
                <CounterTile label="SVC"        value={counters.Services}   variant="ipd" />
                <CounterTile label="TOTAL"      value={totalVisits}         variant="ipd" />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="rx-tabs">
            {TABS.map((t) => {
              const count = t.key === "ALL" ? timeline.length :
                            t.key === "IPD" ? timeline.filter(x => x.kind === "IPD" || x.kind === "Daycare").length :
                            timeline.filter(x => x.kind === t.key).length;
              return (
                <button
                  key={t.key}
                  className={`rx-tab ${tab === t.key ? "rx-tab--active" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  <i className={`pi ${t.icon}`} /> {t.label}
                  <span className="rx-tab-count">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Timeline */}
          {loadingHistory ? (
            <div className="rx-empty">
              <i className="pi pi-spin pi-spinner rx-loader-icon" />
              <div className="rx-mt-10">Building visit timeline…</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rx-empty">
              <span className="rx-empty-icon">📋</span>
              {tab === "ALL"
                ? "No visit records on file yet."
                : <>No <strong>{tab}</strong> visits on file.</>}
            </div>
          ) : (
            <div className="rx-timeline">
              {filtered.map((entry, idx) => (
                <TimelineItem key={`${entry.kind}-${idx}-${entry.date}`} entry={entry} latest={idx === 0} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Counter tile (matches PatientsTable view modal) ─────── */
function CounterTile({ label, value, variant }) {
  return (
    <div className="rx-counter-tile">
      <div className={`rx-counter-tile-value rx-counter-tile-value--${variant}`}>{value}</div>
      <div className="rx-counter-tile-label">{label} VISITS</div>
    </div>
  );
}

/* ─── Single timeline entry ────────────────────────────────── */
function TimelineItem({ entry, latest }) {
  const k = entry.kind;
  const cls =
    k === "OPD"        ? "rx-tl-item--opd" :
    k === "IPD"        ? "rx-tl-item--ipd" :
    k === "Daycare"    ? "rx-tl-item--bill" :
    k === "Emergency"  ? "rx-tl-item--emergency" : "";
  const typeCls =
    k === "OPD"        ? "rx-tl-type--opd" :
    k === "IPD"        ? "rx-tl-type--ipd" :
    k === "Daycare"    ? "rx-tl-type--ipd" :
                         "rx-tl-type--emergency";

  return (
    <div className={`rx-tl-item ${cls}`}>
      <div className="rx-tl-head">
        <span className={`rx-tl-type ${typeCls}`}>{k}</span>
        {latest && <span className="rx-card-stage rx-card-stage--active">Latest</span>}
        <span className="rx-tl-date">{fmtDateTime(entry.date)}</span>
      </div>
      {k === "OPD"       && <OPDBody     v={entry.data} />}
      {k === "IPD"       && <AdmBody     a={entry.data} />}
      {k === "Daycare"   && <AdmBody     a={entry.data} />}
      {k === "Emergency" && <ERBody      e={entry.data} />}
    </div>
  );
}

/* ─── Body renderers ───────────────────────────────────────── */
function OPDBody({ v }) {
  const dept = deptName(v.departmentId || v.department);
  const doc  = docName(v.doctorId || v.doctor) || v.consultantName || "—";
  const meds = v.prescribedMedications || [];
  const vitals = v.vitals || {};
  return (
    <div>
      <div className="rx-tl-meta">
        {v.visitNumber && <><strong>{v.visitNumber}</strong> · </>}
        {dept !== "—" && <>{dept} · </>}{doc}
        {v.status && <> · <em>{v.status}</em></>}
      </div>
      {v.chiefComplaint && (
        <div className="rx-tl-line"><span className="rx-tl-label">Complaint:</span> {v.chiefComplaint}</div>
      )}
      {v.provisionalDiagnosis && (
        <div className="rx-tl-line"><span className="rx-tl-label">Diagnosis:</span> {v.provisionalDiagnosis}</div>
      )}
      {meds.length > 0 && (
        <div className="rx-tl-line">
          <span className="rx-tl-label">Medications:</span>{" "}
          {meds.map(m => `${m.medicineName || m.name || ""} ${m.dosage || ""}`.trim()).filter(Boolean).join(" · ")}
        </div>
      )}
      {(vitals.bloodPressure || vitals.pulse || vitals.temperature || vitals.oxygenSaturation || vitals.weight) && (
        <div className="rx-tl-vitals">
          {vitals.bloodPressure   && <Vital k="BP"   v={vitals.bloodPressure} />}
          {vitals.pulse           && <Vital k="HR"   v={`${vitals.pulse} bpm`} />}
          {vitals.temperature     && <Vital k="Temp" v={`${vitals.temperature}°F`} />}
          {vitals.oxygenSaturation && <Vital k="SpO2" v={`${vitals.oxygenSaturation}%`} />}
          {vitals.weight          && <Vital k="Wt"   v={`${vitals.weight} kg`} />}
        </div>
      )}
      {v.followUpRequired && v.followUpDate && (
        <div className="rx-tl-line rx-text-warning">
          <span className="rx-tl-label">Follow-up:</span> {fmtDate(v.followUpDate)}
        </div>
      )}
    </div>
  );
}

function AdmBody({ a }) {
  const dept = deptName(a.department || a.departmentId);
  const bed  = a.bedId?.bedNumber || a.bedNumber || a.bedAssigned || "—";
  return (
    <div>
      <div className="rx-tl-meta">
        {a.admissionNumber && <><strong>{a.admissionNumber}</strong> · </>}
        {dept !== "—" && <>{dept} · </>}
        Bed: <strong>{bed}</strong>
        {a.attendingDoctor && <> · {a.attendingDoctor}</>}
        {a.status && <> · <em>{a.status}</em></>}
      </div>
      {a.diagnosis && (
        <div className="rx-tl-line"><span className="rx-tl-label">Diagnosis:</span> {a.diagnosis}</div>
      )}
      {a.dischargeDate && (
        <div className="rx-tl-line"><span className="rx-tl-label">Discharged:</span> {fmtDateTime(a.dischargeDate)}</div>
      )}
      {a.estimatedCost != null && (
        <div className="rx-tl-line"><span className="rx-tl-label">Estimated cost:</span> ₹{Number(a.estimatedCost).toLocaleString("en-IN")}</div>
      )}
      {a.totalCost != null && a.totalCost > 0 && (
        <div className="rx-tl-line"><span className="rx-tl-label">Total billed:</span> ₹{Number(a.totalCost).toLocaleString("en-IN")}</div>
      )}
    </div>
  );
}

function ERBody({ e }) {
  return (
    <div>
      <div className="rx-tl-meta">
        {e.emergencyNumber && <><strong>{e.emergencyNumber}</strong> · </>}
        Triage: <strong>{e.triageCategory || "—"}</strong>
        {e.modeOfArrival && <> · Arrival: {e.modeOfArrival}</>}
        {e.status && <> · <em>{e.status}</em></>}
      </div>
      {e.chiefComplaint && (
        <div className="rx-tl-line"><span className="rx-tl-label">Complaint:</span> {e.chiefComplaint}</div>
      )}
      {e.provisionalDiagnosis && (
        <div className="rx-tl-line"><span className="rx-tl-label">Diagnosis:</span> {e.provisionalDiagnosis}</div>
      )}
      {e.disposition && (
        <div className="rx-tl-line"><span className="rx-tl-label">Disposition:</span> {e.disposition}</div>
      )}
      {e.isMLC && (
        <div className="rx-tl-line rx-text-danger">MLC case</div>
      )}
    </div>
  );
}

function Vital({ k, v }) {
  return <span className="rx-vital-chip"><strong>{k}:</strong> {v}</span>;
}
