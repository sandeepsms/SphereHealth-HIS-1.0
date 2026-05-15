/**
 * DieticianConsole.jsx — Dietician workspace.
 *
 * URL: /dietitian   (query ?tab=patients|assessment|library)
 *
 * Three tabs:
 *   1. Patient List   — active IPD admissions + OPD diet-referrals.
 *                        Click a row → opens Assessment tab for that UHID.
 *   2. Assessment     — full nutritional assessment form + template picker
 *                        + customisations → POST /api/dietitian/plan.
 *   3. Plan Library   — browse 17 seeded templates by category, see full
 *                        meal schedule, copy / use as base for a patient.
 *
 * All backend calls hit /api/dietitian/* (gated behind diet.read / diet.write).
 */
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, TabStrip, KPI, Card, Table, EmptyRow, Badge, Modal, Field,
  PrimaryButton, SearchInput, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
const authHdr = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("his_token")}` } });

const CATEGORY_LABELS = {
  "weight-loss":     "Weight Loss",
  "cardiac":         "Cardiac",
  "renal":           "Renal (CKD)",
  "diabetic":        "Diabetic",
  "diabetic-cardiac":"Diabetic + Cardiac",
  "lactation":       "Lactation",
  "neutropenic":     "Neutropenic",
  "low-fiber":       "Low Fiber",
  "low-salt":        "Low Salt",
  "gluten-free":     "Gluten Free",
  "rt-feed":         "RT/NG Feed",
  "soft":            "Soft Diet",
  "high-protein":    "High Protein",
  "normal":          "Normal Diet",
  "fat-free":        "Fat Free / Soft",
  "vitamin-k-reference": "Vitamin K Reference",
  "taste-testing":   "Taste Testing",
  "other":           "Other",
};

const CATEGORY_COLOR = {
  "diabetic":        C.purple,
  "diabetic-cardiac":C.purple,
  "cardiac":         C.red,
  "renal":           C.amber,
  "neutropenic":     C.blue,
  "lactation":       C.pink,
  "rt-feed":         C.teal,
  "weight-loss":     C.green,
  "high-protein":    C.green,
  "low-salt":        C.amber,
  "low-fiber":       C.amber,
  "fat-free":        C.amber,
  "gluten-free":     C.blue,
  "soft":            C.blue,
  "normal":          C.muted,
  "vitamin-k-reference": C.purple,
  "taste-testing":   C.teal,
  "other":           C.muted,
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";

/* ──────────────────────────────────────────────────────────── */
export default function DieticianConsole() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "patients");
  const [activeUHID, setActiveUHID] = useState(params.get("uhid") || "");
  const [activePatient, setActivePatient] = useState(null);

  useEffect(() => {
    const newP = { tab };
    if (activeUHID) newP.uhid = activeUHID;
    if (params.get("tab") !== tab || params.get("uhid") !== (activeUHID || null)) {
      setParams(newP, { replace: true });
    }
  }, [tab, activeUHID]);

  useEffect(() => {
    const t = params.get("tab") || "patients";
    const u = params.get("uhid") || "";
    if (t !== tab) setTab(t);
    if (u !== activeUHID) setActiveUHID(u);
  }, [params]);

  // When a patient is selected from list, jump to Assessment tab.
  const openAssessment = (patient) => {
    setActivePatient(patient);
    setActiveUHID(patient.UHID);
    setTab("assessment");
  };

  return (
    <AdminPage>
      <Hero icon="pi-apple" color="green"
        title="Dietician Console"
        subtitle="Nutritional assessment · diet plan assignment · 17-template library" />

      <TabStrip
        value={tab}
        onChange={setTab}
        accent={C.green}
        accentL="#f0fdf4"
        tabs={[
          { id: "patients",   label: "Referred Patients", icon: "pi-users" },
          { id: "assessment", label: "Assessment & Plan", icon: "pi-pen-to-square" },
          { id: "library",    label: "Diet Plan Library", icon: "pi-book" },
        ]}
      />

      <div style={{ marginTop: 16 }}>
        {tab === "patients"   && <PatientListTab onOpen={openAssessment} />}
        {tab === "assessment" && <AssessmentTab uhid={activeUHID} patient={activePatient} onSaved={() => setTab("patients")} />}
        {tab === "library"    && <LibraryTab />}
      </div>
    </AdminPage>
  );
}

/* ══════════════════════════════════════════════════════════════
   1. PATIENT LIST — active IPD admissions + flagged OPD
══════════════════════════════════════════════════════════════ */
function PatientListTab({ onOpen }) {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([
        axios.get(`${API}/dietitian/patients`, authHdr()),
        axios.get(`${API}/dietitian/stats`,    authHdr()),
      ]);
      setRows(p.data?.data || []);
      setStats(s.data?.data || {});
    } catch (e) { toast.error("Failed to load referred patients"); }
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter(r =>
      (r.UHID || "").toLowerCase().includes(ql) ||
      (r.patientName || "").toLowerCase().includes(ql) ||
      (r.ward || "").toLowerCase().includes(ql) ||
      (r.room || "").toString().includes(ql)
    );
  }, [rows, q]);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Referred patients" value={rows.length}              color={C.green}  icon="pi-users" />
        <KPI label="Active plans"      value={stats.activePlans ?? "—"}  color={C.blue}   icon="pi-check-circle" />
        <KPI label="Plans today"       value={stats.plansToday ?? "—"}   color={C.purple} icon="pi-plus-circle" />
        <KPI label="Follow-ups due"    value={stats.pendingFollowUps ?? "—"} color={C.amber}  icon="pi-clock" />
        <KPI label="Templates"         value={stats.totalTemplates ?? "—"} color={C.teal}   icon="pi-book" />
      </div>

      <Card title="Referred patients" color={C.green} icon="pi-users"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SearchInput value={q} onChange={setQ} placeholder="UHID / name / ward…" />
            <PrimaryButton label="Refresh" icon="pi-refresh" color={C.green} onClick={refresh} busy={loading} />
          </div>
        }>
        {filtered.length === 0 ? (
          <EmptyRow span={1} text={loading ? "Loading…" : "No referred patients today. Active IPD admissions + OPD diet-referrals appear here."} />
        ) : (
          <Table cols={[
            { label: "Source" },
            { label: "UHID" },
            { label: "Patient" },
            { label: "Ward / Room" },
            { label: "Referred by" },
            { label: "Status" },
            { label: "Action" },
          ]}>
            {filtered.map((r, i) => (
              <tr key={i}>
                <td><Badge value={r.source} /></td>
                <td style={{ fontFamily: "monospace", fontSize: 11.5 }}>{r.UHID}</td>
                <td style={{ fontWeight: 700 }}>{r.patientName || "—"}</td>
                <td style={{ color: C.muted, fontSize: 12 }}>
                  {r.source === "IPD" ? `${r.ward || "—"} / ${r.room || "—"}-${r.bed || ""}` : (r.chiefComplaint || "—").slice(0, 40)}
                </td>
                <td style={{ color: C.muted, fontSize: 12 }}>{r.referredBy || "—"}</td>
                <td>
                  {r.hasPlan
                    ? <Badge value={r.planStatus === "active" ? "Active plan" : "Draft"} />
                    : <span style={{ fontSize: 11, color: C.muted, fontStyle: "italic" }}>No plan</span>}
                </td>
                <td>
                  <button onClick={() => onOpen(r)}
                    style={{ padding: "4px 10px", borderRadius: 5, border: `1px solid ${C.green}40`, background: "#fff", color: C.green, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    {r.hasPlan ? "View / Edit" : "Assess"}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   2. ASSESSMENT & PLAN — form + template picker → POST /plan
══════════════════════════════════════════════════════════════ */
function AssessmentTab({ uhid, patient, onSaved }) {
  const { can } = useAuth();
  const canWrite = can("diet.write");
  const [templates, setTemplates] = useState([]);
  const [existing, setExisting]   = useState([]);
  const [chosenTpl, setChosenTpl] = useState("");
  const [saving, setSaving]       = useState(false);

  // Assessment form state
  const [form, setForm] = useState({
    height: "", weight: "", waist: "", hip: "",
    bp: "", bloodSugarFasting: "", bloodSugarPP: "", hba1c: "",
    hemoglobin: "", cholesterol: "", creatinine: "", potassium: "",
    conditions: "", allergies: "", medications: "",
    foodPreference: "vegetarian",
    dietaryHabits: "", appetite: "good",
    swallowing: "normal",
    fluidIntake: "",
    alcohol: false, smoking: false,
    physicalActivity: "", recentWeightChange: "",
    notes: "",
    // Plan side
    customisations: "", planNotes: "",
    targetCalories: "", targetProtein: "",
    fluidRestriction: "", saltRestriction: "",
    startDate: new Date().toISOString().slice(0,10),
    followUpAt: "",
  });

  useEffect(() => {
    (async () => {
      const t = await axios.get(`${API}/dietitian/templates?active=true`, authHdr()).catch(() => null);
      setTemplates(t?.data?.data || []);
    })();
  }, []);

  useEffect(() => {
    if (!uhid) return;
    (async () => {
      const r = await axios.get(`${API}/dietitian/patient/${uhid}/plans`, authHdr()).catch(() => null);
      setExisting(r?.data?.data || []);
    })();
  }, [uhid]);

  const bmi = useMemo(() => {
    const h = Number(form.height), w = Number(form.weight);
    if (!h || !w) return null;
    const m = h / 100;
    return Number((w / (m * m)).toFixed(1));
  }, [form.height, form.weight]);

  const bmiLabel = bmi == null ? "—"
    : bmi < 18.5 ? `${bmi} (Underweight)`
    : bmi < 25   ? `${bmi} (Normal)`
    : bmi < 30   ? `${bmi} (Overweight)`
    :              `${bmi} (Obese)`;

  if (!uhid) {
    return (
      <Card title="No patient selected" color={C.muted} icon="pi-info-circle">
        <div style={{ padding: 20, textAlign: "center", color: C.muted }}>
          Pick a patient from <b>Referred Patients</b> first to start an assessment.
        </div>
      </Card>
    );
  }

  const save = async () => {
    if (!canWrite) { toast.error("Read-only access — write permission required."); return; }
    setSaving(true);
    try {
      const split = (s) => (s || "").split(",").map(x => x.trim()).filter(Boolean);
      const body = {
        UHID: uhid,
        patientName: patient?.patientName || "",
        admissionId: patient?.admissionId || undefined,
        visitType: patient?.source || "IPD",
        assessment: {
          height: Number(form.height) || null,
          weight: Number(form.weight) || null,
          bmi: bmi,
          waist: Number(form.waist) || null,
          hip:   Number(form.hip)   || null,
          bp: form.bp,
          bloodSugarFasting: Number(form.bloodSugarFasting) || null,
          bloodSugarPP:      Number(form.bloodSugarPP)      || null,
          hba1c:             Number(form.hba1c)             || null,
          hemoglobin:        Number(form.hemoglobin)        || null,
          cholesterol:       Number(form.cholesterol)       || null,
          creatinine:        Number(form.creatinine)        || null,
          potassium:         Number(form.potassium)         || null,
          conditions:    split(form.conditions),
          allergies:     split(form.allergies),
          medications:   split(form.medications),
          foodPreference: form.foodPreference,
          dietaryHabits: form.dietaryHabits,
          appetite: form.appetite,
          swallowing: form.swallowing,
          fluidIntake: Number(form.fluidIntake) || null,
          alcohol: form.alcohol, smoking: form.smoking,
          physicalActivity: form.physicalActivity,
          recentWeightChange: Number(form.recentWeightChange) || null,
          notes: form.notes,
        },
        plan: {
          templateId: chosenTpl || undefined,
          customisations: form.customisations,
          targetCalories: Number(form.targetCalories) || null,
          targetProtein:  Number(form.targetProtein)  || null,
          fluidRestriction: Number(form.fluidRestriction) || null,
          saltRestriction:  Number(form.saltRestriction)  || null,
          notes: form.planNotes,
        },
        startDate: form.startDate || undefined,
        followUpAt: form.followUpAt || undefined,
        status: "active",
      };
      await axios.post(`${API}/dietitian/plan`, body, authHdr());
      toast.success("Diet plan saved and assigned.");
      onSaved && onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Save failed");
    }
    setSaving(false);
  };

  const u = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const I = (k, type = "text", w = "100%") => (
    <input type={type} value={form[k]} onChange={(e) => u(k, e.target.value)}
      style={{ width: w, padding: "6px 9px", border: `1.5px solid ${C.border}`, borderRadius: 6, fontSize: 12.5 }} />
  );
  const S = (k, opts) => (
    <select value={form[k]} onChange={(e) => u(k, e.target.value)}
      style={{ width: "100%", padding: "6px 9px", border: `1.5px solid ${C.border}`, borderRadius: 6, fontSize: 12.5, background: "#fff" }}>
      {opts.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
    </select>
  );

  return (
    <>
      {/* Patient banner */}
      <Card title={`Patient · ${uhid}`} color={C.green} icon="pi-user">
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{patient?.patientName || "—"}</div>
          {patient?.ward && <span style={{ color: C.muted, fontSize: 12 }}>📍 {patient.ward} / {patient.room}-{patient.bed}</span>}
          {patient?.referredBy && <span style={{ color: C.muted, fontSize: 12 }}>👨‍⚕️ Referred by {patient.referredBy}</span>}
          {existing.length > 0 && <Badge value={`${existing.length} previous plan${existing.length > 1 ? "s" : ""}`} />}
        </div>
      </Card>

      {/* Anthropometry */}
      <Card title="Anthropometry" color={C.blue} icon="pi-chart-line" padding={14}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <Field label="Height (cm)">{I("height", "number")}</Field>
          <Field label="Weight (kg)">{I("weight", "number")}</Field>
          <Field label="BMI"><div style={{ padding: "6px 9px", background: bmi ? "#f0fdf4" : "#f8fafc", borderRadius: 6, fontWeight: 800, fontSize: 12.5, color: bmi >= 25 ? C.red : C.green }}>{bmiLabel}</div></Field>
          <Field label="Waist (cm)">{I("waist", "number")}</Field>
          <Field label="Hip (cm)">{I("hip", "number")}</Field>
          <Field label="Recent weight Δ (kg, 3 mo)">{I("recentWeightChange", "number")}</Field>
        </div>
      </Card>

      {/* Vitals + Labs */}
      <Card title="Vitals & labs snapshot" color={C.amber} icon="pi-heart">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <Field label="BP (mmHg)">{I("bp")}</Field>
          <Field label="FBS (mg/dL)">{I("bloodSugarFasting", "number")}</Field>
          <Field label="PPBS (mg/dL)">{I("bloodSugarPP", "number")}</Field>
          <Field label="HbA1c (%)">{I("hba1c", "number")}</Field>
          <Field label="Hb (g/dL)">{I("hemoglobin", "number")}</Field>
          <Field label="Cholesterol">{I("cholesterol", "number")}</Field>
          <Field label="Creatinine">{I("creatinine", "number")}</Field>
          <Field label="K⁺ (mEq/L)">{I("potassium", "number")}</Field>
        </div>
      </Card>

      {/* Clinical context */}
      <Card title="Clinical & dietary context" color={C.purple} icon="pi-shield">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <Field label="Conditions (comma-sep)">{I("conditions")}</Field>
          <Field label="Allergies (comma-sep)">{I("allergies")}</Field>
          <Field label="Medications of note">{I("medications")}</Field>
          <Field label="Food preference">{S("foodPreference", [
            { value: "vegetarian", label: "Vegetarian" },
            { value: "non-vegetarian", label: "Non-Veg" },
            { value: "eggetarian", label: "Eggetarian" },
            { value: "vegan", label: "Vegan" },
            { value: "jain", label: "Jain" },
          ])}</Field>
          <Field label="Dietary habits">{I("dietaryHabits")}</Field>
          <Field label="Appetite">{S("appetite", ["good","fair","poor"])}</Field>
          <Field label="Swallowing">{S("swallowing", ["normal","difficulty","tube-fed"])}</Field>
          <Field label="Fluid intake (L/day)">{I("fluidIntake", "number")}</Field>
          <Field label="Physical activity">{I("physicalActivity")}</Field>
          <Field label="Alcohol">
            <select value={form.alcohol ? "yes" : "no"} onChange={(e) => u("alcohol", e.target.value === "yes")}
              style={{ width: "100%", padding: "6px 9px", border: `1.5px solid ${C.border}`, borderRadius: 6, fontSize: 12.5 }}>
              <option>no</option><option>yes</option>
            </select>
          </Field>
          <Field label="Smoking">
            <select value={form.smoking ? "yes" : "no"} onChange={(e) => u("smoking", e.target.value === "yes")}
              style={{ width: "100%", padding: "6px 9px", border: `1.5px solid ${C.border}`, borderRadius: 6, fontSize: 12.5 }}>
              <option>no</option><option>yes</option>
            </select>
          </Field>
        </div>
        <div style={{ marginTop: 10 }}>
          <Field label="Assessment notes">
            <textarea value={form.notes} onChange={(e) => u("notes", e.target.value)} rows={2}
              style={{ width: "100%", padding: "6px 9px", border: `1.5px solid ${C.border}`, borderRadius: 6, fontSize: 12.5, fontFamily: "inherit" }} />
          </Field>
        </div>
      </Card>

      {/* Diet plan selection */}
      <Card title="Diet plan template" color={C.green} icon="pi-book">
        <Field label="Choose a base template (optional — leave blank for custom plan)">
          <select value={chosenTpl} onChange={(e) => setChosenTpl(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 6, fontSize: 13, background: "#fff" }}>
            <option value="">— No template / custom plan —</option>
            {templates.map(t => (
              <option key={t._id} value={t._id}>
                {t.name} [{CATEGORY_LABELS[t.category] || t.category}]{t.calories ? ` · ${t.calories} kcal` : ""}{t.protein ? ` · ${t.protein} g protein` : ""}
              </option>
            ))}
          </select>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 10 }}>
          <Field label="Target calories">{I("targetCalories", "number")}</Field>
          <Field label="Target protein (g)">{I("targetProtein", "number")}</Field>
          <Field label="Fluid restriction (ml/day)">{I("fluidRestriction", "number")}</Field>
          <Field label="Salt restriction (g/day)">{I("saltRestriction", "number")}</Field>
          <Field label="Start date">{I("startDate", "date")}</Field>
          <Field label="Follow-up on">{I("followUpAt", "date")}</Field>
        </div>

        <div style={{ marginTop: 10 }}>
          <Field label="Customisations / patient-specific overrides">
            <textarea value={form.customisations} onChange={(e) => u("customisations", e.target.value)} rows={2}
              style={{ width: "100%", padding: "6px 9px", border: `1.5px solid ${C.border}`, borderRadius: 6, fontSize: 12.5, fontFamily: "inherit" }}
              placeholder="e.g. Replace milk with almond milk (lactose-intolerant). Skip mid-morning fruit (post-op day 1)." />
          </Field>
          <Field label="Plan notes for nursing / patient">
            <textarea value={form.planNotes} onChange={(e) => u("planNotes", e.target.value)} rows={2}
              style={{ width: "100%", padding: "6px 9px", border: `1.5px solid ${C.border}`, borderRadius: 6, fontSize: 12.5, fontFamily: "inherit" }} />
          </Field>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <PrimaryButton label={canWrite ? "Save & Assign Plan" : "Read-only"}
            icon="pi-check" color={C.green} onClick={save} busy={saving} disabled={!canWrite} />
        </div>
      </Card>

      {existing.length > 0 && (
        <Card title="Previous plans for this patient" color={C.muted} icon="pi-history">
          <Table cols={[
            { label: "Date" }, { label: "Template" }, { label: "Status" },
            { label: "Calories", align: "right" }, { label: "Protein", align: "right" }, { label: "Follow-up" },
          ]}>
            {existing.map((p, i) => (
              <tr key={i}>
                <td style={{ color: C.muted, fontSize: 12 }}>{fmtDate(p.createdAt)}</td>
                <td style={{ fontWeight: 700 }}>{p.plan?.templateName || <em style={{ color: C.muted }}>Custom</em>}</td>
                <td><Badge value={p.status} /></td>
                <td style={{ textAlign: "right" }}>{p.plan?.targetCalories ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{p.plan?.targetProtein ?? "—"}</td>
                <td style={{ color: C.muted, fontSize: 12 }}>{fmtDate(p.followUpAt)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   3. PLAN LIBRARY — 17 seeded templates browsable by category
══════════════════════════════════════════════════════════════ */
function LibraryTab() {
  const [templates, setTemplates] = useState([]);
  const [filter, setFilter]       = useState("all");
  const [loading, setLoading]     = useState(false);
  const [preview, setPreview]     = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/dietitian/templates?active=true`, authHdr());
      setTemplates(r.data?.data || []);
    } catch (e) {}
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const cats = useMemo(() => [...new Set(templates.map(t => t.category))], [templates]);
  const visible = filter === "all" ? templates : templates.filter(t => t.category === filter);

  return (
    <>
      <Card title="Filter by category" color={C.green} icon="pi-filter"
        right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.green} onClick={refresh} busy={loading} />}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[{ id: "all", lbl: "All" }, ...cats.map(c => ({ id: c, lbl: CATEGORY_LABELS[c] || c }))].map(o => (
            <button key={o.id} onClick={() => setFilter(o.id)}
              style={{
                padding: "6px 12px", borderRadius: 999,
                border: `1.5px solid ${filter === o.id ? (CATEGORY_COLOR[o.id] || C.green) : C.border}`,
                background: filter === o.id ? (CATEGORY_COLOR[o.id] || C.green) + "15" : "#fff",
                color: filter === o.id ? (CATEGORY_COLOR[o.id] || C.green) : C.muted,
                fontWeight: 800, fontSize: 11.5, cursor: "pointer",
              }}>{o.lbl}</button>
          ))}
        </div>
      </Card>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {visible.map(t => {
          const color = CATEGORY_COLOR[t.category] || C.green;
          return (
            <button key={t._id} onClick={() => setPreview(t)}
              style={{
                background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 12,
                padding: 16, textAlign: "left", cursor: "pointer",
                display: "flex", flexDirection: "column", gap: 8,
                transition: "all .15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = color + "55"; e.currentTarget.style.boxShadow = `0 6px 18px ${color}25`; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Badge value={CATEGORY_LABELS[t.category] || t.category} />
                <span style={{ fontFamily: "monospace", fontSize: 10.5, color: C.muted }}>{t.code}</span>
              </div>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{t.name}</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>{t.description}</div>
              <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 6, fontSize: 11, color: C.muted, fontWeight: 700 }}>
                {t.calories && <span>🔥 {t.calories} kcal</span>}
                {t.protein && <span>💪 {t.protein} g protein</span>}
                {t.durationType === "weekly" && <span>📅 Weekly</span>}
                <span style={{ marginLeft: "auto" }}>{t.meals?.length || 0} meals</span>
              </div>
            </button>
          );
        })}
      </div>

      {preview && <TemplatePreview tmpl={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function TemplatePreview({ tmpl, onClose }) {
  return (
    <Modal title={tmpl.name} icon="pi-book" color={CATEGORY_COLOR[tmpl.category] || C.green} onClose={onClose} hideFooter size={760}>
      <div style={{ marginBottom: 10, fontSize: 12.5, color: C.muted }}>{tmpl.description}</div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14, padding: "10px 12px", background: "#f8fafc", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, fontWeight: 700 }}>
        <span><b style={{ color: C.muted }}>Code:</b> <code>{tmpl.code}</code></span>
        {tmpl.calories && <span>🔥 {tmpl.calories} kcal/day</span>}
        {tmpl.protein && <span>💪 {tmpl.protein} g protein/day</span>}
        <span>📅 {tmpl.durationType}</span>
        <span style={{ marginLeft: "auto" }}><Badge value={CATEGORY_LABELS[tmpl.category] || tmpl.category} /></span>
      </div>

      {tmpl.indicatedFor?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.green, marginBottom: 4 }}>INDICATED FOR</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tmpl.indicatedFor.map((c, i) => (
              <span key={i} style={{ padding: "3px 9px", borderRadius: 999, background: C.greenL || "#f0fdf4", color: "#15803d", fontSize: 11, fontWeight: 700 }}>{c}</span>
            ))}
          </div>
        </div>
      )}

      {tmpl.contraindications?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.red, marginBottom: 4 }}>CONTRAINDICATED</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tmpl.contraindications.map((c, i) => (
              <span key={i} style={{ padding: "3px 9px", borderRadius: 999, background: "#fef2f2", color: "#b91c1c", fontSize: 11, fontWeight: 700 }}>{c}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 800, color: C.text, margin: "10px 0 6px" }}>MEAL SCHEDULE</div>
      <Table cols={[{ label: "Time" }, { label: "Items" }]}>
        {tmpl.meals?.map((m, i) => (
          <tr key={i}>
            <td style={{ fontWeight: 800, color: C.text, whiteSpace: "nowrap", verticalAlign: "top" }}>
              {m.time}
              {m.timeHi && <div style={{ fontWeight: 500, color: C.muted, fontSize: 11 }}>{m.timeHi}</div>}
            </td>
            <td style={{ fontSize: 12.5 }}>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {m.items?.map((it, j) => (
                  <li key={j} style={{ marginBottom: 3 }}>
                    {it.day && <strong style={{ color: C.green, marginRight: 6 }}>{it.day}:</strong>}
                    {it.en}
                    {it.hi && <div style={{ color: C.muted, fontSize: 11.5 }}>{it.hi}</div>}
                    {it.notes && <div style={{ color: C.muted, fontSize: 11, fontStyle: "italic" }}>{it.notes}</div>}
                  </li>
                ))}
              </ul>
            </td>
          </tr>
        ))}
      </Table>

      {tmpl.generalInstructions?.length > 0 && (
        <div style={{ marginTop: 14, padding: "10px 12px", background: C.amberL || "#fffbeb", border: `1.5px solid #fbbf24`, borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#b45309", marginBottom: 5 }}>⚠️ GENERAL INSTRUCTIONS</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: C.text, lineHeight: 1.5 }}>
            {tmpl.generalInstructions.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}
