/**
 * LabResultsEntry.jsx — Lab Tech / Radiologist manual data entry.
 *
 * URL: /lab-results
 *
 * Three pill tabs:
 *   1. Trend Sheet  — grid (rows = tests, cols = dates) modelled on
 *                      the user-supplied HTML template. Each cell
 *                      auto-classifies normal / borderline / critical
 *                      against the test's reference range.
 *                      Save sends the entire grid to
 *                      POST /api/lab-records/trends or PUT /:id.
 *   2. Reports      — single-instance form for imaging (X-ray/CT/MRI),
 *                      microbiology, histopath, ECG/echo, PFT, endoscopy.
 *                      Narrative findings + impression.
 *   3. History      — recent records browser (filter by UHID).
 *
 * Patient picker (UHID + name) lives at the top of the page so the
 * same picker drives all three tabs.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, TabStrip, Card, Table, Empty, Badge,
  PrimaryButton, Modal, Field, KPI, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
const authHdr = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("his_token")}` } });

const STATUS_BG = {
  normal:     { bg: "#d4edda", color: "#155724", border: "#c3e6cb" },
  borderline: { bg: "#fff3cd", color: "#856404", border: "#ffeeba" },
  critical:   { bg: "#f8d7da", color: "#721c24", border: "#f5c6cb" },
  "":         { bg: "#fafafa", color: "#1a1d23", border: C.border },
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";

/* Client-side classifier matching backend logic. */
function classify(value, refMin, refMax) {
  const n = parseFloat(value);
  if (isNaN(n) || refMin == null || refMax == null) return "";
  if (n < refMin * 0.8 || n > refMax * 1.2) return "critical";
  if (n < refMin || n > refMax) return "borderline";
  return "normal";
}

/* ──────────────────────────────────────────────────────────── */
export default function LabResultsEntry() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "trend");
  const [uhid, setUhid] = useState(params.get("uhid") || "");
  const [patient, setPatient] = useState(null);

  useEffect(() => {
    const nv = { tab };
    if (uhid) nv.uhid = uhid;
    if (params.get("tab") !== tab || params.get("uhid") !== (uhid || null)) {
      setParams(nv, { replace: true });
    }
  }, [tab, uhid]);

  // Resolve patient name from UHID (light lookup; falls back if no patient).
  useEffect(() => {
    if (!uhid || uhid.length < 4) { setPatient(null); return; }
    (async () => {
      try {
        // Reuse the reception patient search if available; fall back to
        // dietitian/patients which we know returns UHID + patientName.
        const r = await axios.get(`${API}/patients?UHID=${uhid}`, authHdr()).catch(() => null);
        const p = r?.data?.data?.[0] || r?.data?.[0];
        if (p) {
          setPatient({
            UHID: p.UHID,
            patientName: p.fullName || `${p.title || ""} ${p.firstName || ""} ${p.lastName || ""}`.trim(),
            age: p.age, gender: p.gender,
          });
        } else {
          setPatient(null);
        }
      } catch { setPatient(null); }
    })();
  }, [uhid]);

  return (
    <AdminPage>
      <Hero icon="pi-flask" color="blue"
        title="Lab Results Entry"
        subtitle="Manual data entry for trend sheets, imaging, microbiology, histopath" />

      {/* Patient picker — drives all three tabs */}
      <Card title="Patient" color={C.blue} icon="pi-user">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="UHID">
            <input value={uhid} onChange={(e) => setUhid(e.target.value)} placeholder="UH00000001"
              style={{ width: 200, padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontWeight: 700, fontFamily: "monospace" }} />
          </Field>
          {patient && (
            <div style={{ fontSize: 13.5, color: C.text, padding: "8px 12px", background: "#eff6ff", borderRadius: 7, border: "1px solid #bfdbfe" }}>
              <strong>{patient.patientName}</strong>
              {patient.age != null && <span style={{ color: C.muted, marginLeft: 8 }}>{patient.age} / {patient.gender || "—"}</span>}
            </div>
          )}
        </div>
      </Card>

      <div style={{ marginTop: 12 }}>
        <TabStrip
          value={tab} onChange={setTab}
          accent={C.blue} accentL="#eff6ff"
          tabs={[
            { id: "trend",   label: "Trend Sheet",      icon: "pi-table" },
            { id: "report",  label: "Imaging / Reports",icon: "pi-file" },
            { id: "history", label: "History",          icon: "pi-history" },
          ]}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        {tab === "trend"   && <TrendTab   uhid={uhid} patient={patient} />}
        {tab === "report"  && <ReportTab  uhid={uhid} patient={patient} />}
        {tab === "history" && <HistoryTab uhid={uhid} />}
      </div>
    </AdminPage>
  );
}

/* ══════════════════════════════════════════════════════════════
   TREND TAB — grid like the HTML template
══════════════════════════════════════════════════════════════ */
function TrendTab({ uhid, patient }) {
  const { can } = useAuth();
  const canWrite = can("lab.records.write");
  const [panels, setPanels] = useState({});
  const [panelKey, setPanelKey] = useState("CBC");
  const [tests, setTests] = useState([]);
  const [dates, setDates] = useState([todayISO()]);
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [existing, setExisting] = useState([]);
  const [saving, setSaving] = useState(false);

  // Load panels once.
  useEffect(() => {
    axios.get(`${API}/lab-records/panels`, authHdr()).then(r => setPanels(r.data?.data || {}));
  }, []);

  // Apply the chosen panel — only when we're not editing an existing trend.
  useEffect(() => {
    if (editingId) return;
    const p = panels[panelKey];
    if (!p) return;
    setTests(p.tests.map(t => ({ ...t, readings: dates.map(d => ({ date: d, value: "", status: "" })) })));
  }, [panelKey, panels, editingId, dates.length]);

  // List trends for this patient so the user can pick an existing one to edit.
  useEffect(() => {
    if (!uhid) { setExisting([]); return; }
    axios.get(`${API}/lab-records/trends?UHID=${uhid}`, authHdr())
      .then(r => setExisting(r.data?.data || []))
      .catch(() => setExisting([]));
  }, [uhid]);

  const loadExisting = (t) => {
    setEditingId(t._id);
    setPanelKey(t.panelType || "CUSTOM");
    setTests(t.tests || []);
    setDates((t.dates || []).map(d => new Date(d).toISOString().slice(0,10)));
    setNotes(t.notes || "");
  };

  const newSheet = () => {
    setEditingId(null);
    setPanelKey("CBC");
    setDates([todayISO()]);
    setNotes("");
  };

  const addDate = () => {
    const last = dates[dates.length - 1] || todayISO();
    const next = new Date(last); next.setDate(next.getDate() + 1);
    const nextStr = next.toISOString().slice(0,10);
    setDates([...dates, nextStr]);
    setTests(prev => prev.map(t => ({ ...t, readings: [...t.readings, { date: nextStr, value: "", status: "" }] })));
  };
  const removeDate = (i) => {
    if (dates.length <= 1) return;
    setDates(dates.filter((_, j) => j !== i));
    setTests(prev => prev.map(t => ({ ...t, readings: t.readings.filter((_, j) => j !== i) })));
  };
  const updateDate = (i, value) => {
    const nd = [...dates]; nd[i] = value; setDates(nd);
    setTests(prev => prev.map(t => ({ ...t, readings: t.readings.map((r, j) => j === i ? { ...r, date: value } : r) })));
  };

  const addTestRow = () => {
    const newRow = { name: "", unit: "", refMin: null, refMax: null, readings: dates.map(d => ({ date: d, value: "", status: "" })) };
    setTests([...tests, newRow]);
  };
  const removeTestRow = (i) => setTests(tests.filter((_, j) => j !== i));
  const updateTest = (i, patch) => setTests(prev => prev.map((t, j) => j === i ? { ...t, ...patch } : t));
  const updateCell = (ti, ri, value) => setTests(prev => prev.map((t, j) => {
    if (j !== ti) return t;
    const readings = t.readings.map((r, k) => k === ri ? { ...r, value, status: classify(value, t.refMin, t.refMax) } : r);
    return { ...t, readings };
  }));

  const save = async () => {
    if (!uhid) { toast.error("Pick a patient first"); return; }
    if (!canWrite) { toast.error("Read-only"); return; }
    setSaving(true);
    try {
      const body = {
        UHID: uhid,
        patientName: patient?.patientName || "",
        panelType: panelKey,
        panelName: panels[panelKey]?.label || panelKey,
        tests, dates: dates.map(d => new Date(d)), notes,
        status: "reported",
      };
      if (editingId) {
        await axios.put(`${API}/lab-records/trends/${editingId}`, body, authHdr());
        toast.success("Trend sheet updated.");
      } else {
        const r = await axios.post(`${API}/lab-records/trends`, body, authHdr());
        setEditingId(r.data?.data?._id);
        toast.success("Trend sheet saved.");
      }
      // Refresh existing list
      const r = await axios.get(`${API}/lab-records/trends?UHID=${uhid}`, authHdr());
      setExisting(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Save failed");
    }
    setSaving(false);
  };

  if (!uhid) return <Card title="No patient selected" color={C.muted} icon="pi-info-circle"><div style={{ padding: 16, color: C.muted, textAlign: "center" }}>Enter a UHID above to start a trend sheet.</div></Card>;

  return (
    <>
      <Card title="Choose panel / load existing" color={C.blue} icon="pi-list"
        right={
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={newSheet}
              style={{ padding: "6px 14px", borderRadius: 7, border: `1.5px solid ${C.blue}`, background: editingId ? C.blue + "15" : "#fff", color: C.blue, fontWeight: 800, fontSize: 11.5, cursor: "pointer" }}>
              <i className="pi pi-plus" style={{ marginRight: 4 }} />New sheet
            </button>
          </div>
        }>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginRight: 4 }}>PRESET:</span>
          {Object.entries(panels).map(([k, p]) => (
            <button key={k} onClick={() => { setEditingId(null); setPanelKey(k); }}
              style={{ padding: "5px 12px", borderRadius: 999, border: `1.5px solid ${panelKey === k && !editingId ? C.blue : C.border}`, background: panelKey === k && !editingId ? C.blue + "15" : "#fff", color: panelKey === k && !editingId ? C.blue : C.muted, fontWeight: 700, fontSize: 11.5, cursor: "pointer" }}>
              {k}
            </button>
          ))}
        </div>
        {existing.length > 0 && (
          <div style={{ marginTop: 10, padding: "8px 10px", background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 4 }}>EDIT EXISTING ({existing.length}):</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {existing.map(t => (
                <button key={t._id} onClick={() => loadExisting(t)}
                  style={{ padding: "4px 10px", borderRadius: 6, border: `1.5px solid ${editingId === t._id ? C.green : C.border}`, background: editingId === t._id ? "#f0fdf4" : "#fff", color: editingId === t._id ? "#15803d" : C.text, fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
                  {t.panelName || t.panelType} · {fmtDate(t.createdAt)} · {t.tests?.length || 0} tests
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Grid */}
      <div style={{ marginTop: 12 }}>
        <Card title={`${editingId ? "Editing" : "New"} — ${panels[panelKey]?.label || panelKey}`} color={C.blue} icon="pi-table"
          right={
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={addDate} style={{ padding: "6px 12px", borderRadius: 7, border: `1.5px solid ${C.green}`, background: "#fff", color: C.green, fontWeight: 800, fontSize: 11.5, cursor: "pointer" }}>+ Day</button>
              <button onClick={addTestRow} style={{ padding: "6px 12px", borderRadius: 7, border: `1.5px solid ${C.blue}`, background: "#fff", color: C.blue, fontWeight: 800, fontSize: 11.5, cursor: "pointer" }}>+ Test</button>
            </div>
          }>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f2f2f2", borderBottom: `2px solid ${C.border}` }}>
                  <th style={{ padding: "8px 10px", textAlign: "left", minWidth: 200, position: "sticky", left: 0, background: "#f2f2f2", zIndex: 1 }}>Test</th>
                  <th style={{ padding: "8px 6px", width: 60 }}>Unit</th>
                  <th style={{ padding: "8px 6px", width: 80 }}>Ref Min</th>
                  <th style={{ padding: "8px 6px", width: 80 }}>Ref Max</th>
                  {dates.map((d, i) => (
                    <th key={i} style={{ padding: "6px", minWidth: 110 }}>
                      <input type="date" value={d} onChange={(e) => updateDate(i, e.target.value)}
                        style={{ width: "100%", padding: 4, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11.5, fontWeight: 700 }} />
                      {dates.length > 1 && (
                        <button onClick={() => removeDate(i)} title="Remove column"
                          style={{ marginTop: 2, padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.red}40`, background: "#fff", color: C.red, fontSize: 9, fontWeight: 700, cursor: "pointer", width: "100%" }}>× day</button>
                      )}
                    </th>
                  ))}
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {tests.map((t, ti) => (
                  <tr key={ti} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: 4, position: "sticky", left: 0, background: "#fff" }}>
                      <input value={t.name} onChange={(e) => updateTest(ti, { name: e.target.value })} placeholder="Test name"
                        style={{ width: "100%", padding: "5px 7px", border: `1px solid ${C.border}`, borderRadius: 4, fontWeight: 700, fontSize: 12 }} />
                    </td>
                    <td style={{ padding: 4 }}>
                      <input value={t.unit || ""} onChange={(e) => updateTest(ti, { unit: e.target.value })}
                        style={{ width: "100%", padding: "5px 6px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11 }} />
                    </td>
                    <td style={{ padding: 4 }}>
                      <input type="number" step="any" value={t.refMin ?? ""} onChange={(e) => updateTest(ti, { refMin: e.target.value === "" ? null : Number(e.target.value) })}
                        style={{ width: "100%", padding: "5px 6px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11 }} />
                    </td>
                    <td style={{ padding: 4 }}>
                      <input type="number" step="any" value={t.refMax ?? ""} onChange={(e) => updateTest(ti, { refMax: e.target.value === "" ? null : Number(e.target.value) })}
                        style={{ width: "100%", padding: "5px 6px", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11 }} />
                    </td>
                    {t.readings.map((r, ri) => {
                      const s = classify(r.value, t.refMin, t.refMax);
                      const bg = STATUS_BG[s] || STATUS_BG[""];
                      return (
                        <td key={ri} style={{ padding: 4, background: bg.bg, transition: "background .15s" }}>
                          <input value={r.value || ""} onChange={(e) => updateCell(ti, ri, e.target.value)}
                            placeholder="—"
                            style={{ width: "100%", padding: "5px 6px", border: `1px solid ${bg.border}`, borderRadius: 4, fontWeight: s === "critical" ? 800 : 600, fontSize: 12, color: bg.color, background: "transparent", textAlign: "center" }} />
                        </td>
                      );
                    })}
                    <td style={{ padding: 4 }}>
                      <button onClick={() => removeTestRow(ti)} title="Delete row"
                        style={{ padding: "4px 7px", border: `1px solid ${C.red}40`, background: "#fff", color: C.red, fontWeight: 700, fontSize: 10, borderRadius: 4, cursor: "pointer" }}>×</button>
                    </td>
                  </tr>
                ))}
                {tests.length === 0 && (
                  <tr><td colSpan={dates.length + 5} style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: 12 }}>
                    No tests yet. Pick a preset or click + Test.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div style={{ marginTop: 10, display: "flex", gap: 12, fontSize: 11, color: C.muted, alignItems: "center" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 14, height: 14, background: STATUS_BG.normal.bg, border: `1px solid ${STATUS_BG.normal.border}`, borderRadius: 3 }} /> Normal
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 14, height: 14, background: STATUS_BG.borderline.bg, border: `1px solid ${STATUS_BG.borderline.border}`, borderRadius: 3 }} /> Borderline (outside ref ± 20%)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 14, height: 14, background: STATUS_BG.critical.bg, border: `1px solid ${STATUS_BG.critical.border}`, borderRadius: 3 }} /> Critical (&lt; min × 0.8 or &gt; max × 1.2)
            </span>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Notes" color={C.muted} icon="pi-pencil">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Lab-tech notes — repeat sample on D4 due to haemolysis, etc."
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} />
          {canWrite && (
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <PrimaryButton label={editingId ? "Update sheet" : "Save sheet"} icon={editingId ? "pi-save" : "pi-check"} color={C.blue} onClick={save} busy={saving} />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   REPORT TAB — imaging / micro / histopath single-form
══════════════════════════════════════════════════════════════ */
function ReportTab({ uhid, patient }) {
  const { can } = useAuth();
  const canWrite = can("lab.records.write");
  const [types, setTypes] = useState([]);
  const [existing, setExisting] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    reportType: "imaging-xray", testName: "", bodyPart: "",
    reportDate: todayISO(),
    clinicalDetails: "", findings: "", impression: "", recommendations: "",
    specimen: "", organism: "", sensitivity: "",
    status: "reported",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get(`${API}/lab-records/report-types`, authHdr()).then(r => setTypes(r.data?.data || []));
  }, []);
  useEffect(() => {
    if (!uhid) { setExisting([]); return; }
    axios.get(`${API}/lab-records/reports?UHID=${uhid}`, authHdr())
      .then(r => setExisting(r.data?.data || []))
      .catch(() => setExisting([]));
  }, [uhid]);

  const reset = () => {
    setEditingId(null);
    setForm({
      reportType: "imaging-xray", testName: "", bodyPart: "",
      reportDate: todayISO(),
      clinicalDetails: "", findings: "", impression: "", recommendations: "",
      specimen: "", organism: "", sensitivity: "",
      status: "reported",
    });
  };

  const loadExisting = (r) => {
    setEditingId(r._id);
    setForm({
      reportType: r.reportType, testName: r.testName, bodyPart: r.bodyPart || "",
      reportDate: (r.reportDate || "").slice(0, 10) || todayISO(),
      clinicalDetails: r.clinicalDetails || "", findings: r.findings || "",
      impression: r.impression || "", recommendations: r.recommendations || "",
      specimen: r.specimen || "", organism: r.organism || "", sensitivity: r.sensitivity || "",
      status: r.status,
    });
  };

  const save = async () => {
    if (!uhid) { toast.error("Pick a patient first"); return; }
    if (!form.testName) { toast.error("Test name required"); return; }
    setSaving(true);
    try {
      const body = { ...form, UHID: uhid, patientName: patient?.patientName || "" };
      if (editingId) {
        await axios.put(`${API}/lab-records/reports/${editingId}`, body, authHdr());
        toast.success("Report updated.");
      } else {
        const r = await axios.post(`${API}/lab-records/reports`, body, authHdr());
        setEditingId(r.data?.data?._id);
        toast.success("Report saved.");
      }
      const r = await axios.get(`${API}/lab-records/reports?UHID=${uhid}`, authHdr());
      setExisting(r.data?.data || []);
    } catch (e) { toast.error(e?.response?.data?.message || "Save failed"); }
    setSaving(false);
  };

  if (!uhid) return <Card title="No patient selected" color={C.muted} icon="pi-info-circle"><div style={{ padding: 16, color: C.muted, textAlign: "center" }}>Enter a UHID above to add a report.</div></Card>;

  const u = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isImaging  = (form.reportType || "").startsWith("imaging");
  const isMicro    = form.reportType === "microbiology";
  const isPath     = form.reportType === "histopath" || form.reportType === "cytology";

  return (
    <>
      {existing.length > 0 && (
        <Card title={`Existing reports for ${uhid} (${existing.length})`} color={C.muted} icon="pi-history"
          right={<button onClick={reset} style={{ padding: "5px 12px", borderRadius: 7, border: `1.5px solid ${C.blue}`, background: "#fff", color: C.blue, fontWeight: 800, fontSize: 11.5, cursor: "pointer" }}>+ New report</button>}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {existing.map(r => (
              <button key={r._id} onClick={() => loadExisting(r)}
                style={{ padding: "5px 10px", borderRadius: 6, border: `1.5px solid ${editingId === r._id ? C.green : C.border}`, background: editingId === r._id ? "#f0fdf4" : "#fff", color: editingId === r._id ? "#15803d" : C.text, fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
                {r.testName} · {fmtDate(r.reportDate)}
              </button>
            ))}
          </div>
        </Card>
      )}

      <div style={{ marginTop: 12 }}>
        <Card title={editingId ? "Edit report" : "New report"} color={C.blue} icon="pi-file">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 10 }}>
            <Field label="Report type">
              <select value={form.reportType} onChange={(e) => u("reportType", e.target.value)}
                style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
                {Object.entries(types.reduce((acc, t) => {
                  acc[t.group] = acc[t.group] || []; acc[t.group].push(t); return acc;
                }, {})).map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label="Test / study name">
              <input value={form.testName} onChange={(e) => u("testName", e.target.value)}
                placeholder={isImaging ? "X-ray Chest PA / USG Abdomen / CT Brain plain" : "Test or study name"}
                style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
            </Field>
            <Field label="Date">
              <input type="date" value={form.reportDate} max={todayISO()} onChange={(e) => u("reportDate", e.target.value)}
                style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
            </Field>
          </div>

          {isImaging && (
            <Field label="Body part / region">
              <input value={form.bodyPart} onChange={(e) => u("bodyPart", e.target.value)}
                placeholder="Chest / Abdomen / Brain / Pelvis / Spine"
                style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, marginTop: 10 }} />
            </Field>
          )}

          {(isMicro || isPath) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
              <Field label="Specimen / source">
                <input value={form.specimen} onChange={(e) => u("specimen", e.target.value)}
                  placeholder={isMicro ? "Blood / Urine / Sputum / Wound swab" : "Tissue from..."}
                  style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
              </Field>
              {isMicro && (
                <Field label="Organism isolated">
                  <input value={form.organism} onChange={(e) => u("organism", e.target.value)}
                    placeholder="E.coli / S.aureus / No growth"
                    style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
                </Field>
              )}
            </div>
          )}

          <Field label="Clinical details (referring info)">
            <textarea value={form.clinicalDetails} onChange={(e) => u("clinicalDetails", e.target.value)} rows={2}
              placeholder="Brief clinical context from the referring doctor"
              style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} />
          </Field>

          <Field label="Findings">
            <textarea value={form.findings} onChange={(e) => u("findings", e.target.value)} rows={6}
              placeholder={isImaging ? "Detailed imaging findings — organ-by-organ description" : isMicro ? "Growth pattern, colony morphology, gram stain" : "Microscopic findings"}
              style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit", lineHeight: 1.5 }} />
          </Field>

          {isMicro && (
            <Field label="Antibiotic sensitivity">
              <textarea value={form.sensitivity} onChange={(e) => u("sensitivity", e.target.value)} rows={4}
                placeholder="Sensitive to: Ceftriaxone, Amikacin&#10;Resistant to: Ampicillin, Cotrimoxazole"
                style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "monospace" }} />
            </Field>
          )}

          <Field label="Impression / diagnosis">
            <textarea value={form.impression} onChange={(e) => u("impression", e.target.value)} rows={3}
              placeholder="Final diagnostic conclusion"
              style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontFamily: "inherit", fontWeight: 600 }} />
          </Field>

          <Field label="Recommendations / suggested follow-up">
            <textarea value={form.recommendations} onChange={(e) => u("recommendations", e.target.value)} rows={2}
              style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} />
          </Field>

          {canWrite && (
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
              <PrimaryButton label={editingId ? "Update report" : "Save report"} icon={editingId ? "pi-save" : "pi-check"} color={C.blue} onClick={save} busy={saving} />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   HISTORY TAB — combined list
══════════════════════════════════════════════════════════════ */
function HistoryTab({ uhid }) {
  const [trends, setTrends] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const params = uhid ? `?UHID=${uhid}` : "";
      const [t, r] = await Promise.all([
        axios.get(`${API}/lab-records/trends${params}`, authHdr()).then(x => x.data?.data || []),
        axios.get(`${API}/lab-records/reports${params}`, authHdr()).then(x => x.data?.data || []),
      ]);
      setTrends(t); setReports(r);
    } catch {}
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [uhid]);

  return (
    <>
      <Card title={`Trend sheets (${trends.length})`} color={C.blue} icon="pi-table"
        right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.blue} onClick={refresh} busy={loading} />}>
        {trends.length === 0 ? (
          <Empty icon="pi-table" text={uhid ? "No trend sheets for this patient." : "No trend sheets yet."} />
        ) : (
          <Table cols={[
            { label: "Date" }, { label: "Patient" }, { label: "Panel" },
            { label: "Tests", align: "right" }, { label: "Days", align: "right" }, { label: "Status" }, { label: "Created by" },
          ]}>
            {trends.map((t, i) => (
              <tr key={i}>
                <td style={{ fontSize: 12 }}>{fmtDate(t.createdAt)}</td>
                <td style={{ fontWeight: 700 }}>{t.patientName}<div style={{ color: C.muted, fontSize: 11 }}>{t.UHID}</div></td>
                <td>{t.panelName || t.panelType}</td>
                <td style={{ textAlign: "right" }}>{t.tests?.length || 0}</td>
                <td style={{ textAlign: "right" }}>{t.dates?.length || 0}</td>
                <td><Badge value={(t.status || "").toUpperCase()} /></td>
                <td style={{ color: C.muted, fontSize: 12 }}>{t.createdByName || "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div style={{ marginTop: 14 }}>
        <Card title={`Reports (${reports.length})`} color={C.purple} icon="pi-file">
          {reports.length === 0 ? (
            <Empty icon="pi-file" text={uhid ? "No reports for this patient." : "No reports yet."} />
          ) : (
            <Table cols={[
              { label: "Date" }, { label: "Patient" }, { label: "Type" }, { label: "Test" },
              { label: "Impression" }, { label: "Status" }, { label: "Reported by" },
            ]}>
              {reports.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12 }}>{fmtDate(r.reportDate)}</td>
                  <td style={{ fontWeight: 700 }}>{r.patientName}<div style={{ color: C.muted, fontSize: 11 }}>{r.UHID}</div></td>
                  <td><Badge value={r.reportType.replace(/-/g, " ")} /></td>
                  <td>{r.testName}</td>
                  <td style={{ fontSize: 12, maxWidth: 300 }}>{(r.impression || "").slice(0, 120) || "—"}</td>
                  <td><Badge value={(r.status || "").toUpperCase()} /></td>
                  <td style={{ color: C.muted, fontSize: 12 }}>{r.reportedByName || "—"}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
