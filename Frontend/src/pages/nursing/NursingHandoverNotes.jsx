import React, { useState, useEffect, useCallback } from "react";
import { useFormik } from "formik";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#f8fafc",
  card: "#ffffff",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#64748b",
  primary: "#0f766e",
  primaryL: "#f0fdfa",
  primaryMid: "#0d9488",
  green: "#16a34a", greenL: "#dcfce7", greenB: "#bbf7d0",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#1d4ed8", blueL: "#eff6ff", blueB: "#bfdbfe",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  slate: "#1e293b", slateMid: "#334155",
  pink: "#be185d", pinkL: "#fdf2f8",
  orange: "#ea580c", orangeL: "#fff7ed",
};

const fld = {
  padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8,
  fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#0f172a",
  outline: "none", background: "white", width: "100%", boxSizing: "border-box",
};
const sel = { ...fld, cursor: "pointer" };
const ta  = { ...fld, resize: "vertical", minHeight: 80 };
const lbl = {
  display: "block", fontSize: 11, fontWeight: 700, color: "#64748b",
  textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 5,
};

// ─── Patient type config ───────────────────────────────────────────────────────
const PATIENT_TYPES = [
  { key: "IPD",       label: "IPD",       icon: "pi-building",          color: C.blue,   admissionTypes: ["Planned","Emergency","Transfer","Day Care"] },
  { key: "DayCare",   label: "Day Care",  icon: "pi-sun",               color: C.amber,  admissionTypes: ["Daycare","Day Care"] },
  { key: "Emergency", label: "Emergency", icon: "pi-exclamation-circle", color: C.red,    admissionTypes: ["Emergency"] },
];

const TYPE_COLOR = {
  IPD:       { bg: C.blueL,   color: C.blue,   border: C.blueB   },
  DayCare:   { bg: C.amberL,  color: C.amber,  border: C.amberB  },
  Emergency: { bg: C.redL,    color: C.red,    border: C.redB    },
};

// ─── Section card ─────────────────────────────────────────────────────────────
function SectionCard({ icon, title, color = C.primary, children }) {
  return (
    <div style={{
      background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 14,
      marginBottom: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.04)",
    }}>
      <div style={{
        padding: "12px 20px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{
          width: 30, height: 30, borderRadius: 8, background: color + "18",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <i className={`pi ${icon}`} style={{ fontSize: 13, color }} />
        </span>
        <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>{title}</span>
      </div>
      <div style={{ padding: "18px 20px" }}>{children}</div>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={style}>
      {label && <label style={lbl}>{label}</label>}
      {children}
    </div>
  );
}

function PillGroup({ options, value, onChange, colorActive }) {
  const col = colorActive || C.primary;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map(v => {
        const active = value === v;
        return (
          <button key={v} type="button" onClick={() => onChange(v)} style={{
            padding: "7px 16px", borderRadius: 20,
            border: `1.5px solid ${active ? col : C.border}`,
            background: active ? col + "18" : "white",
            color: active ? col : C.muted,
            fontWeight: active ? 700 : 400,
            cursor: "pointer", fontSize: 13,
            fontFamily: "'DM Sans',sans-serif", transition: "all .12s",
          }}>{v}</button>
        );
      })}
    </div>
  );
}

// ─── Patient card in sidebar ───────────────────────────────────────────────────
function PatientCard({ adm, selected, onClick }) {
  const tc = TYPE_COLOR[adm._typeKey] || TYPE_COLOR.IPD;
  const name = adm.patientName || "Unknown";
  const uhid = adm.UHID || "—";
  const bed  = adm.bedNumber || "—";
  const ward = adm.wardId?.wardName || adm.wardName || "—";
  const days = adm.admissionDate
    ? Math.max(1, Math.ceil((Date.now() - new Date(adm.admissionDate)) / 86400000))
    : "?";

  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px 14px",
        borderRadius: 10,
        border: `1.5px solid ${selected ? C.primary : C.border}`,
        background: selected ? C.primaryL : "white",
        cursor: "pointer",
        transition: "all .12s",
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 700, fontSize: 13, color: selected ? C.primary : C.text,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{name}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{uhid}</div>
        </div>
        <span style={{
          background: tc.bg, color: tc.color, border: `1px solid ${tc.border}`,
          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
          whiteSpace: "nowrap", flexShrink: 0, marginLeft: 6,
        }}>D{days}</span>
      </div>
      <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {bed !== "—" && (
          <span style={{ fontSize: 10, color: C.muted, background: "#f1f5f9", padding: "2px 7px", borderRadius: 6 }}>
            🛏 {bed}
          </span>
        )}
        {ward !== "—" && (
          <span style={{ fontSize: 10, color: C.muted, background: "#f1f5f9", padding: "2px 7px", borderRadius: 6 }}>
            {ward}
          </span>
        )}
        {adm.department && (
          <span style={{ fontSize: 10, color: C.muted, background: "#f1f5f9", padding: "2px 7px", borderRadius: 6 }}>
            {adm.department}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function PatientSidebar({ activeType, onTypeChange, patients, loading, selectedId, onSelect, search, onSearch }) {
  return (
    <div style={{
      width: 280, flexShrink: 0,
      background: "white",
      border: `1.5px solid ${C.border}`,
      borderRadius: 14,
      display: "flex", flexDirection: "column",
      height: "calc(100vh - 100px)",
      position: "sticky", top: 88,
      overflow: "hidden",
      boxShadow: "0 1px 6px rgba(0,0,0,.06)",
    }}>
      {/* Sidebar header */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, background: "#f8fafc" }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 10 }}>Select Patient</div>

        {/* Type tabs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {PATIENT_TYPES.map(pt => {
            const active = activeType === pt.key;
            return (
              <button key={pt.key} type="button" onClick={() => onTypeChange(pt.key)} style={{
                padding: "8px 12px", borderRadius: 8, border: "none",
                background: active ? pt.color + "15" : "transparent",
                color: active ? pt.color : C.muted,
                fontWeight: active ? 700 : 500,
                cursor: "pointer", fontSize: 13,
                fontFamily: "'DM Sans',sans-serif",
                display: "flex", alignItems: "center", gap: 8,
                textAlign: "left", transition: "all .12s",
                borderLeft: `3px solid ${active ? pt.color : "transparent"}`,
              }}>
                <i className={`pi ${pt.icon}`} style={{ fontSize: 13 }} />
                {pt.label}
                {active && (
                  <span style={{
                    marginLeft: "auto", background: pt.color + "20", color: pt.color,
                    fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
                  }}>
                    {patients.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ position: "relative" }}>
          <i className="pi pi-search" style={{
            position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
            fontSize: 12, color: C.muted, pointerEvents: "none",
          }} />
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search name / UHID…"
            style={{ ...fld, paddingLeft: 32, fontSize: 12 }}
          />
        </div>
      </div>

      {/* Patient list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: C.muted }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              border: `3px solid ${C.border}`, borderTopColor: C.primary,
              animation: "spin 1s linear infinite", margin: "0 auto 10px",
            }} />
            <div style={{ fontSize: 12 }}>Loading patients…</div>
          </div>
        ) : patients.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 12px", color: C.muted }}>
            <i className="pi pi-users" style={{ fontSize: 28, display: "block", marginBottom: 8, opacity: .4 }} />
            <div style={{ fontSize: 12 }}>No active patients found</div>
          </div>
        ) : (
          patients.map(adm => (
            <PatientCard
              key={adm._id}
              adm={adm}
              selected={selectedId === adm._id}
              onClick={() => onSelect(adm)}
            />
          ))
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
const NursingHandoverNotes = () => {
  const [activeType, setActiveType]       = useState("IPD");
  const [allPatients, setAllPatients]     = useState([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [selectedAdm, setSelectedAdm]    = useState(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [saved, setSaved]                = useState(false);
  const [saving, setSaving]              = useState(false);

  const formik = useFormik({
    initialValues: {
      uhid: "", admissionNo: "", name: "", ageSex: "", wardBed: "", diagnosis: "",
      fromShift: "", toShift: "", date: new Date().toISOString().slice(0, 10),
      time: new Date().toTimeString().slice(0, 5),
      outgoing: "", incoming: "",
      condition: "", consciousness: "",
      intakeIV: "", oral: "", urine: "", drain: "", stool: "",
      pending: "", notes: "",
      doctorInformed: "", outgoingSignature: "", incomingSignature: "",
      handoverTimestamp: "",
      pulse: "", bp: "", rr: "", temp: "", spo2: "", vitalTime: "",
    },
    onSubmit: async (values) => {
      setSaving(true);
      await new Promise(r => setTimeout(r, 600)); // replace with real API call
      console.log("Handover submitted:", values);
      setSaved(true);
      setSaving(false);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const shiftOptions  = ["Morning", "Evening", "Night"];
  const intakeOptions = ["Nil", "<500 ml", "500–1000 ml", ">1000 ml"];
  const simpleOptions = ["Nil", "Poor", "Adequate"];
  const urineOptions  = ["Adequate", "Low", "Nil"];

  const currentShift = () => {
    const h = new Date().getHours();
    if (h >= 7 && h < 15) return "Morning";
    if (h >= 15 && h < 23) return "Evening";
    return "Night";
  };

  const fmtDate = () =>
    new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

  // ── Fetch patients from API ───────────────────────────────────────────────────
  const loadPatients = useCallback(async (type) => {
    setPatientsLoading(true);
    setAllPatients([]);
    try {
      const token = localStorage.getItem("his_token");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      let params = { status: "Active", limit: 200 };
      if (type === "DayCare")   params.admissionType = "Daycare";
      if (type === "Emergency") params.admissionType = "Emergency";
      // IPD = everything active that is NOT daycare/emergency
      const res = await axios.get(API_ENDPOINTS.ADMISSIONS, { params, headers });
      let list = Array.isArray(res.data) ? res.data : res.data?.data || res.data?.admissions || [];

      // For IPD: exclude DayCare and Emergency records
      if (type === "IPD") {
        list = list.filter(a => !["Daycare","Day Care","Emergency"].includes(a.admissionType));
      }

      setAllPatients(list.map(a => ({ ...a, _typeKey: type })));
    } catch (e) {
      setAllPatients([]);
    } finally {
      setPatientsLoading(false);
    }
  }, []);

  useEffect(() => { loadPatients(activeType); }, [activeType, loadPatients]);

  // ── When patient selected: populate form ──────────────────────────────────────
  const selectPatient = (adm) => {
    setSelectedAdm(adm);
    const pt = adm.patientId || {};
    const dob = pt.dateOfBirth || adm.dateOfBirth;
    const age = dob
      ? Math.floor((Date.now() - new Date(dob)) / (365.25 * 86400000))
      : pt.age || adm.age || "";
    const gender = (pt.gender || adm.gender || "").charAt(0).toUpperCase();
    const bed  = adm.bedId?.bedNumber || adm.bedNumber || "";
    const ward = adm.wardId?.wardName || adm.wardName || "";

    formik.setValues({
      ...formik.values,
      uhid:        adm.UHID || "",
      admissionNo: adm.admissionNumber || adm._id?.slice(-6).toUpperCase() || "",
      name:        adm.patientName || pt.fullName || "",
      ageSex:      age ? `${age} / ${gender || "M"}` : "",
      wardBed:     [ward, bed].filter(Boolean).join(" / "),
      diagnosis:   adm.reasonForAdmission || adm.provisionalDiagnosis || "",
    });
  };

  // ── Filtered sidebar list ─────────────────────────────────────────────────────
  const filteredPatients = allPatients.filter(a => {
    if (!sidebarSearch.trim()) return true;
    const s = sidebarSearch.toLowerCase();
    return (
      (a.patientName || "").toLowerCase().includes(s) ||
      (a.UHID || "").toLowerCase().includes(s) ||
      (a.bedNumber || "").toLowerCase().includes(s)
    );
  });

  const activePtCfg = PATIENT_TYPES.find(p => p.key === activeType);

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'DM Sans',sans-serif" }}>

      {/* ── Sticky header ── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "linear-gradient(135deg,#1e293b,#0f766e)",
        padding: "16px 28px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        boxShadow: "0 4px 20px rgba(15,118,110,.2)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: "rgba(255,255,255,.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="pi pi-file-edit" style={{ fontSize: 19, color: "#fff" }} />
          </div>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 18, letterSpacing: "-.3px" }}>
              Nursing Handover Notes
            </div>
            <div style={{ color: "rgba(255,255,255,.65)", fontSize: 12, marginTop: 1, display: "flex", alignItems: "center", gap: 8 }}>
              <i className="pi pi-calendar" style={{ fontSize: 10 }} />{fmtDate()}
              <span style={{ opacity: .4 }}>·</span>
              <i className="pi pi-clock" style={{ fontSize: 10 }} />{currentShift()} Shift
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {selectedAdm && (
            <div style={{
              background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.2)",
              borderRadius: 10, padding: "7px 14px",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: activePtCfg?.color || C.primary,
                flexShrink: 0,
              }} />
              <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
                {selectedAdm.patientName}
              </span>
              <span style={{ color: "rgba(255,255,255,.5)", fontSize: 11 }}>
                · {selectedAdm.UHID}
              </span>
            </div>
          )}
          <div style={{
            background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.25)",
            borderRadius: 20, padding: "5px 14px", fontSize: 11, fontWeight: 700, color: "#fff",
          }}>
            NABH Compliant
          </div>
        </div>
      </div>

      {/* ── Two-pane layout ── */}
      <div style={{ display: "flex", gap: 20, padding: "20px 24px", alignItems: "flex-start" }}>

        {/* ── Sidebar ── */}
        <PatientSidebar
          activeType={activeType}
          onTypeChange={(t) => { setActiveType(t); setSelectedAdm(null); setSidebarSearch(""); }}
          patients={filteredPatients}
          loading={patientsLoading}
          selectedId={selectedAdm?._id}
          onSelect={selectPatient}
          search={sidebarSearch}
          onSearch={setSidebarSearch}
        />

        {/* ── Form area ── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* No patient selected hint */}
          {!selectedAdm && (
            <div style={{
              background: "white", border: `1.5px dashed ${C.border}`, borderRadius: 14,
              padding: "48px 24px", textAlign: "center", marginBottom: 16,
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: 14,
                background: activePtCfg ? activePtCfg.color + "15" : C.primaryL,
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 14px",
              }}>
                <i className={`pi ${activePtCfg?.icon || "pi-user"}`}
                  style={{ fontSize: 22, color: activePtCfg?.color || C.primary }} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 6 }}>
                Select a {activeType} Patient
              </div>
              <div style={{ fontSize: 13, color: C.muted }}>
                Choose a patient from the {activeType} list on the left to begin the handover note.
              </div>
            </div>
          )}

          <form onSubmit={formik.handleSubmit}>

            {/* 1. Patient Identification */}
            <SectionCard icon="pi-id-card" title="Patient Identification" color={C.primary}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
                <Field label="UHID">
                  <input name="uhid" value={formik.values.uhid} onChange={formik.handleChange} placeholder="e.g. SH-26-000001" style={fld} />
                </Field>
                <Field label="Admission No">
                  <input name="admissionNo" value={formik.values.admissionNo} onChange={formik.handleChange} placeholder="Admission No" style={fld} />
                </Field>
                <Field label="Patient Name">
                  <input name="name" value={formik.values.name} onChange={formik.handleChange} placeholder="Full name" style={fld} />
                </Field>
                <Field label="Age / Sex">
                  <input name="ageSex" value={formik.values.ageSex} onChange={formik.handleChange} placeholder="e.g. 45 / Male" style={fld} />
                </Field>
                <Field label="Ward / Bed">
                  <input name="wardBed" value={formik.values.wardBed} onChange={formik.handleChange} placeholder="e.g. Ward 3 / Bed 12" style={fld} />
                </Field>
                <Field label="Diagnosis">
                  <input name="diagnosis" value={formik.values.diagnosis} onChange={formik.handleChange} placeholder="Primary diagnosis" style={fld} />
                </Field>
              </div>

              {/* Patient type badge */}
              {selectedAdm && (
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[
                    { label: "Type", value: selectedAdm.admissionType || activeType },
                    { label: "Status", value: selectedAdm.status || "Active" },
                    { label: "Doctor", value: selectedAdm.attendingDoctor || "—" },
                    { label: "Dept", value: selectedAdm.department || "—" },
                  ].map(({ label, value }) => (
                    <div key={label} style={{
                      background: "#f1f5f9", borderRadius: 8, padding: "5px 10px",
                      fontSize: 11, color: C.muted,
                    }}>
                      <span style={{ fontWeight: 700, color: C.slateMid }}>{label}: </span>
                      {value}
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* 2. Shift Transition */}
            <SectionCard icon="pi-arrows-h" title="Shift Transition" color={C.blue}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
                <Field label="From Shift">
                  <select value={formik.values.fromShift} onChange={e => formik.setFieldValue("fromShift", e.target.value)} style={sel}>
                    <option value="">Select shift…</option>
                    {shiftOptions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="To Shift">
                  <select value={formik.values.toShift} onChange={e => formik.setFieldValue("toShift", e.target.value)} style={sel}>
                    <option value="">Select shift…</option>
                    {shiftOptions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Date">
                  <input type="date" value={formik.values.date} onChange={e => formik.setFieldValue("date", e.target.value)} style={fld} />
                </Field>
                <Field label="Time">
                  <input type="time" value={formik.values.time} onChange={e => formik.setFieldValue("time", e.target.value)} style={fld} />
                </Field>
                <Field label="Outgoing Nurse">
                  <input placeholder="Outgoing nurse name" value={formik.values.outgoing} onChange={e => formik.setFieldValue("outgoing", e.target.value)} style={fld} />
                </Field>
                <Field label="Incoming Nurse">
                  <input placeholder="Incoming nurse name" value={formik.values.incoming} onChange={e => formik.setFieldValue("incoming", e.target.value)} style={fld} />
                </Field>
              </div>
            </SectionCard>

            {/* 3. Patient Status */}
            <SectionCard icon="pi-heart" title="Patient Status" color={C.red}>
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <label style={{ ...lbl, marginBottom: 10 }}>Condition</label>
                  <PillGroup
                    options={["Stable", "Observation", "Critical"]}
                    value={formik.values.condition}
                    onChange={v => formik.setFieldValue("condition", v)}
                    colorActive={
                      formik.values.condition === "Critical" ? C.red :
                      formik.values.condition === "Observation" ? C.amber : C.green
                    }
                  />
                </div>
                <div>
                  <label style={{ ...lbl, marginBottom: 10 }}>Level of Consciousness</label>
                  <PillGroup
                    options={["Conscious", "Drowsy", "Unconscious"]}
                    value={formik.values.consciousness}
                    onChange={v => formik.setFieldValue("consciousness", v)}
                    colorActive={
                      formik.values.consciousness === "Unconscious" ? C.red :
                      formik.values.consciousness === "Drowsy" ? C.amber : C.primary
                    }
                  />
                </div>
              </div>
            </SectionCard>

            {/* 4. Vitals at Handover */}
            <SectionCard icon="pi-chart-line" title="Vitals at Handover" color={C.purple}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Pulse (bpm)", "BP (mmHg)", "RR (/min)", "Temp (°F)", "SpO₂ (%)", "Time"].map(h => (
                        <th key={h} style={{
                          padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 700,
                          color: C.muted, textTransform: "uppercase", letterSpacing: ".5px",
                          borderBottom: `2px solid ${C.border}`, whiteSpace: "nowrap",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {[
                        { name: "pulse", placeholder: "72" },
                        { name: "bp", placeholder: "120/80" },
                        { name: "rr", placeholder: "16" },
                        { name: "temp", placeholder: "98.6" },
                        { name: "spo2", placeholder: "98" },
                        { name: "vitalTime", placeholder: "HH:MM" },
                      ].map(({ name, placeholder }) => (
                        <td key={name} style={{ padding: "10px 6px" }}>
                          <input name={name} value={formik.values[name]} onChange={formik.handleChange} placeholder={placeholder} style={{ ...fld, minWidth: 80 }} />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </SectionCard>

            {/* 5. Intake & Output */}
            <SectionCard icon="pi-filter" title="Intake & Output" color={C.amber}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
                {[
                  { label: "IV Intake",    key: "intakeIV", opts: intakeOptions },
                  { label: "Oral Intake",  key: "oral",     opts: simpleOptions },
                  { label: "Urine Output", key: "urine",    opts: urineOptions  },
                  { label: "Drain",        key: "drain",    opts: simpleOptions },
                  { label: "Stool",        key: "stool",    opts: simpleOptions },
                ].map(({ label, key, opts }) => (
                  <Field key={key} label={label}>
                    <select value={formik.values[key]} onChange={e => formik.setFieldValue(key, e.target.value)} style={sel}>
                      <option value="">Select…</option>
                      {opts.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
            </SectionCard>

            {/* 6. Pending Tasks */}
            <SectionCard icon="pi-list-check" title="Pending Tasks" color={C.amber}>
              <div>
                <label style={{ ...lbl, marginBottom: 10 }}>Task Type</label>
                <PillGroup
                  options={["No Task", "Dressing", "Medication", "Doctor Review"]}
                  value={formik.values.pending}
                  onChange={v => formik.setFieldValue("pending", v)}
                />
              </div>
              <div style={{ marginTop: 16 }}>
                <label style={lbl}>Additional Instructions / Notes</label>
                <textarea value={formik.values.notes} onChange={e => formik.setFieldValue("notes", e.target.value)} placeholder="Describe pending tasks, instructions for incoming shift…" style={ta} />
              </div>
            </SectionCard>

            {/* 7. Verification & Sign-off */}
            <SectionCard icon="pi-verified" title="Verification & Sign-off" color={C.slate}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14 }}>
                <Field label="Outgoing Nurse Signature">
                  <input placeholder="Full name or digital signature" style={fld} onChange={e => formik.setFieldValue("outgoingSignature", e.target.value)} />
                </Field>
                <Field label="Incoming Nurse Signature">
                  <input placeholder="Full name or digital signature" style={fld} onChange={e => formik.setFieldValue("incomingSignature", e.target.value)} />
                </Field>
                <Field label="Doctor Informed">
                  <select value={formik.values.doctorInformed} onChange={e => formik.setFieldValue("doctorInformed", e.target.value)} style={sel}>
                    <option value="">Select…</option>
                    <option value="Not Required">Not Required</option>
                    <option value="Yes">Yes</option>
                  </select>
                </Field>
                <Field label="Handover Timestamp">
                  <input type="datetime-local" style={fld} onChange={e => formik.setFieldValue("handoverTimestamp", e.target.value)} />
                </Field>
              </div>
            </SectionCard>

            {/* Save button */}
            <button type="submit" disabled={saving} style={{
              width: "100%", padding: "14px 24px", borderRadius: 12, border: "none",
              background: saved
                ? `linear-gradient(135deg,${C.green},#15803d)`
                : `linear-gradient(135deg,${C.primary},${C.primaryMid})`,
              color: "#fff", fontWeight: 800, fontSize: 15, cursor: saving ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              fontFamily: "'DM Sans',sans-serif",
              boxShadow: `0 4px 16px rgba(15,118,110,.3)`,
              letterSpacing: "-.2px", marginBottom: 32, opacity: saving ? .8 : 1,
              transition: "background .3s",
            }}>
              <i className={`pi ${saving ? "pi-spin pi-spinner" : saved ? "pi-check" : "pi-save"}`} style={{ fontSize: 16 }} />
              {saving ? "Saving…" : saved ? "Saved!" : "Save Handover Notes"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default NursingHandoverNotes;
