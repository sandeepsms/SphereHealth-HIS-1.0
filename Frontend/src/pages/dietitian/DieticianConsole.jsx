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
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, TabStrip, KPI, Card, Table, EmptyRow, Empty, Badge, Modal, Field,
  PrimaryButton, SearchInput, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";

import { API_BASE_URL as API } from "../../config/api";
const authHdr = () => ({ headers: { Authorization: `Bearer ${(sessionStorage.getItem("his_token") || localStorage.getItem("his_token"))}` } });

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
  // `presetTemplate` flows from LibraryTab → AssessmentTab when the
  // dietician clicks "Apply to patient" on a library card. The
  // AssessmentTab reads `?template=<id>` and pre-selects the picker.
  const [presetTemplate, setPresetTemplate] = useState(params.get("template") || "");

  useEffect(() => {
    const newP = { tab };
    if (activeUHID)      newP.uhid = activeUHID;
    if (presetTemplate)  newP.template = presetTemplate;
    if (params.get("tab") !== tab
        || params.get("uhid") !== (activeUHID || null)
        || params.get("template") !== (presetTemplate || null)) {
      setParams(newP, { replace: true });
    }
  }, [tab, activeUHID, presetTemplate]);

  useEffect(() => {
    const t = params.get("tab") || "patients";
    const u = params.get("uhid") || "";
    const tpl = params.get("template") || "";
    if (t !== tab) setTab(t);
    if (u !== activeUHID) setActiveUHID(u);
    if (tpl !== presetTemplate) setPresetTemplate(tpl);
  }, [params]);

  // When a patient is selected from list, jump to Assessment tab.
  const openAssessment = (patient, templateId = "") => {
    setActivePatient(patient);
    setActiveUHID(patient.UHID);
    if (templateId) setPresetTemplate(templateId);
    setTab("assessment");
  };

  // Clear preset template once consumed by Assessment tab — caller
  // passes this so the URL becomes clean (?template= goes away once
  // the user has loaded the assessment, otherwise refreshing reapplies
  // the template every time which is surprising).
  const clearPresetTemplate = () => setPresetTemplate("");

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
        {tab === "assessment" && (
          <AssessmentTab
            uhid={activeUHID}
            patient={activePatient}
            presetTemplate={presetTemplate}
            onPresetConsumed={clearPresetTemplate}
            onSaved={() => setTab("patients")}
          />
        )}
        {tab === "library"    && <LibraryTab onApplyToPatient={openAssessment} />}
      </div>
    </AdminPage>
  );
}

/* ══════════════════════════════════════════════════════════════
   1. PATIENT LIST — active IPD admissions + flagged OPD
══════════════════════════════════════════════════════════════ */
function PatientListTab({ onOpen }) {
  const navigate = useNavigate();
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
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="UHID / name / ward…" />
            <PrimaryButton label="Refresh" icon="pi-refresh" color={C.green} onClick={refresh} busy={loading} />
          </div>
        }>
        {filtered.length === 0 ? (
          <Empty icon="pi-users" text={loading ? "Loading…" : "No referred patients today. Active IPD admissions + OPD diet-referrals appear here."} />
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
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={() => onOpen(r)}
                      style={{ padding: "4px 10px", borderRadius: 5, border: `1px solid ${C.green}40`, background: "#fff", color: C.green, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      {r.hasPlan ? "View / Edit" : "Assess"}
                    </button>
                    {/* Open the patient's full clinical file in a new tab so the
                        dietician can review labs, vitals, allergies and other
                        clinicians' notes before writing or revising the plan. */}
                    <button
                      onClick={() => window.open(`/patient-file/${encodeURIComponent(r.UHID)}`, "_blank", "noopener,noreferrer")}
                      title="Open patient's full clinical file in a new tab"
                      style={{ padding: "4px 10px", borderRadius: 5, border: `1px solid ${C.blue}40`, background: "#fff", color: C.blue, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      📄 Open File
                    </button>
                  </div>
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
const EMPTY_FORM = {
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
  customisations: "", planNotes: "",
  targetCalories: "", targetProtein: "",
  fluidRestriction: "", saltRestriction: "",
  startDate: new Date().toISOString().slice(0,10),
  followUpAt: "",
};

// BMI WHO tier → { label, color } for both the BMI cell tinting and the
// "Underweight" / "Overweight" hints below the value.
function bmiTier(bmi) {
  if (bmi == null) return { label: "—", color: C.muted, bg: "#f8fafc" };
  if (bmi < 18.5)   return { label: "Underweight", color: "#b45309", bg: "#fffbeb" };
  if (bmi < 25)     return { label: "Normal",      color: "#15803d", bg: "#f0fdf4" };
  if (bmi < 30)     return { label: "Overweight",  color: "#b45309", bg: "#fffbeb" };
  return                   { label: "Obese",       color: "#b91c1c", bg: "#fef2f2" };
}

// Heuristic — map a free-text condition like "type-2 diabetes, hypertension"
// to the most appropriate template category. Used to suggest a default
// template in the picker once the assessor has typed a condition.
function suggestCategory(conditions = "") {
  const c = (conditions || "").toLowerCase();
  if (/dialys|esrd/.test(c) && /diab/.test(c))  return "renal";   // dialysis takes precedence
  if (/(ckd|renal|kidney|nephr)/.test(c))       return "renal";
  if (/tube|ng|peg|dysphag|unconscious/.test(c))return "rt-feed";
  if (/lactat|postpart|breastfeed/.test(c))     return "lactation";
  if (/neutropen|chemo|transplant/.test(c))     return "neutropenic";
  if (/celiac|gluten/.test(c))                  return "gluten-free";
  if (/post.?op|wound|burn|muscle wast|malnut|hypoalbum/.test(c)) return "high-protein";
  if (/(diab.*card|card.*diab)/.test(c))        return "diabetic-cardiac";
  if (/diab/.test(c))                           return "diabetic";
  if (/card|mi\b|ischem|cad|chf|heart/.test(c)) return "cardiac";
  if (/hypert|htn|edema|ascites|chf/.test(c))   return "low-salt";
  if (/pancreat|gallbladder|chole|fatty liver/.test(c)) return "fat-free";
  if (/ibd|colitis|diarrh|divertic/.test(c))    return "low-fiber";
  if (/obes|overweight|metabol/.test(c))        return "weight-loss";
  if (/warfarin|coumadin|anticoag/.test(c))     return "vitamin-k-reference";
  return null;
}

function AssessmentTab({ uhid, patient: patientFromList, presetTemplate, onPresetConsumed, onSaved }) {
  const { can } = useAuth();
  const canWrite = can("diet.write");
  const [templates, setTemplates] = useState([]);
  const [existing, setExisting]   = useState([]);
  const [chosenTpl, setChosenTpl] = useState("");
  const [saving, setSaving]       = useState(false);
  const [editingId, setEditingId] = useState(null);   // null = creating new; <id> = editing
  const [previewTpl, setPreviewTpl] = useState(null); // modal — view template before assigning
  const [patient, setPatient]     = useState(patientFromList || null);
  const [form, setForm] = useState(EMPTY_FORM);

  // Load templates once.
  useEffect(() => {
    (async () => {
      const t = await axios.get(`${API}/dietitian/templates?active=true`, authHdr()).catch(() => null);
      setTemplates(t?.data?.data || []);
    })();
  }, []);

  // If a preset template id came in via URL / Library "Apply to patient",
  // pre-select it ONCE templates are loaded (we can't select before that
  // since the <select> needs the option to exist). Then call the parent's
  // consumer so the URL drops `?template=` and a refresh doesn't keep
  // re-applying the preset over a manually-changed selection.
  useEffect(() => {
    if (!presetTemplate || !templates.length) return;
    setChosenTpl(presetTemplate);
    onPresetConsumed && onPresetConsumed();
  }, [presetTemplate, templates.length]);

  // When UHID changes (new patient picked or page reloaded via deep link):
  //   1. Reset form to blanks so old patient's data doesn't bleed in.
  //   2. Resolve patient context — first from props (came via list click),
  //      otherwise from /dietitian/patients lookup so banner + admissionId
  //      stay correct on direct URL load.
  //   3. Load patient's plan history. If an active plan exists, prefill
  //      the form so "View / Edit" actually edits instead of creating a
  //      duplicate.
  useEffect(() => {
    if (!uhid) { setForm(EMPTY_FORM); setExisting([]); setEditingId(null); return; }
    setForm(EMPTY_FORM); setEditingId(null); setChosenTpl("");

    (async () => {
      // Resolve patient from props or lookup.
      if (patientFromList && patientFromList.UHID === uhid) {
        setPatient(patientFromList);
      } else {
        const all = await axios.get(`${API}/dietitian/patients`, authHdr()).catch(() => null);
        const match = (all?.data?.data || []).find(p => p.UHID === uhid);
        if (match) setPatient(match);
      }
      // Plan history.
      const r = await axios.get(`${API}/dietitian/patient/${uhid}/plans`, authHdr()).catch(() => null);
      const plans = r?.data?.data || [];
      setExisting(plans);
      // Preload most-recent ACTIVE plan into form so dietitian can review/edit.
      const last = plans.find(p => p.status === "active") || plans[0];
      if (last) loadPlanIntoForm(last);
    })();
  }, [uhid, patientFromList]);

  const loadPlanIntoForm = (p) => {
    const a = p.assessment || {};
    const pl = p.plan || {};
    setEditingId(p._id);
    setChosenTpl(pl.templateId || "");
    setForm({
      height: a.height ?? "", weight: a.weight ?? "", waist: a.waist ?? "", hip: a.hip ?? "",
      bp: a.bp ?? "", bloodSugarFasting: a.bloodSugarFasting ?? "", bloodSugarPP: a.bloodSugarPP ?? "", hba1c: a.hba1c ?? "",
      hemoglobin: a.hemoglobin ?? "", cholesterol: a.cholesterol ?? "", creatinine: a.creatinine ?? "", potassium: a.potassium ?? "",
      conditions: (a.conditions || []).join(", "),
      allergies:  (a.allergies  || []).join(", "),
      medications:(a.medications|| []).join(", "),
      foodPreference: a.foodPreference || "vegetarian",
      dietaryHabits: a.dietaryHabits || "",
      appetite: a.appetite || "good",
      swallowing: a.swallowing || "normal",
      fluidIntake: a.fluidIntake ?? "",
      alcohol: !!a.alcohol, smoking: !!a.smoking,
      physicalActivity: a.physicalActivity || "",
      recentWeightChange: a.recentWeightChange ?? "",
      notes: a.notes || "",
      customisations: pl.customisations || "",
      planNotes: pl.notes || "",
      targetCalories: pl.targetCalories ?? "",
      targetProtein:  pl.targetProtein  ?? "",
      fluidRestriction: pl.fluidRestriction ?? "",
      saltRestriction:  pl.saltRestriction  ?? "",
      startDate:  (p.startDate || "").slice(0,10) || new Date().toISOString().slice(0,10),
      followUpAt: (p.followUpAt || "").slice(0,10) || "",
    });
  };

  // BMI auto-calc + WHO tier.
  const bmi = useMemo(() => {
    const h = Number(form.height), w = Number(form.weight);
    if (!h || !w) return null;
    const m = h / 100;
    return Number((w / (m * m)).toFixed(1));
  }, [form.height, form.weight]);
  const bmiInfo = bmiTier(bmi);

  // Auto-fill target calories/protein from picked template, but only if
  // they're currently blank — so we don't override a user's manual entry.
  // Also stash a snapshot of the chosen template for the preview button.
  const chosenTplObj = useMemo(() => templates.find(t => t._id === chosenTpl), [templates, chosenTpl]);
  useEffect(() => {
    if (!chosenTplObj) return;
    setForm(f => ({
      ...f,
      targetCalories: f.targetCalories || chosenTplObj.calories || "",
      targetProtein:  f.targetProtein  || chosenTplObj.protein  || "",
    }));
  }, [chosenTplObj]);

  // Suggested category from typed conditions — bubbles matching templates
  // to the top of the picker.
  const suggested = useMemo(() => suggestCategory(form.conditions), [form.conditions]);
  const sortedTemplates = useMemo(() => {
    if (!suggested) return templates;
    return [...templates].sort((a, b) => {
      const aHit = a.category === suggested;
      const bHit = b.category === suggested;
      if (aHit && !bHit) return -1;
      if (!aHit && bHit) return 1;
      return 0;
    });
  }, [templates, suggested]);

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
      if (editingId) {
        await axios.put(`${API}/dietitian/plan/${editingId}`, body, authHdr());
        toast.success("Diet plan updated.");
      } else {
        await axios.post(`${API}/dietitian/plan`, body, authHdr());
        toast.success("Diet plan saved and assigned.");
      }
      onSaved && onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Save failed");
    }
    setSaving(false);
  };

  // Print a clean copy of the assigned plan — opens in new window with
  // the meals snapshot + assessment summary. Kept inside the file so the
  // template snapshot in plan.meals can be rendered without an extra
  // round-trip to the server.
  const printPlan = () => {
    const last = existing.find(p => p._id === editingId) || existing[0];
    if (!last) { toast.info("Save the plan first to print it."); return; }
    const html = renderPrintHTML(last, patient);
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) { toast.error("Pop-up blocked — allow pop-ups to print."); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 250);
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
      <Card title={`Patient · ${uhid}`} color={C.green} icon="pi-user"
        right={
          editingId
            ? <Badge value="EDITING EXISTING PLAN" />
            : (existing.length > 0 ? <Badge value="NEW PLAN" /> : null)
        }>
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{patient?.patientName || "—"}</div>
          {patient?.ward && patient.ward !== "—" && (
            <span style={{ color: C.muted, fontSize: 12 }}>📍 {patient.ward} / {patient.room}-{patient.bed}</span>
          )}
          {patient?.department && (
            <span style={{ color: C.muted, fontSize: 12 }}>🏥 {patient.department}</span>
          )}
          {patient?.referredBy && (
            <span style={{ color: C.muted, fontSize: 12 }}>👨‍⚕️ Referred by {patient.referredBy}</span>
          )}
          {existing.length > 0 && <Badge value={`${existing.length} plan${existing.length > 1 ? "s" : ""} on file`} />}
        </div>
      </Card>

      {/* Anthropometry */}
      <Card title="Anthropometry" color={C.blue} icon="pi-chart-line" padding={14}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <Field label="Height (cm)">{I("height", "number")}</Field>
          <Field label="Weight (kg)">{I("weight", "number")}</Field>
          <Field label="BMI">
            <div style={{
              padding: "6px 9px", background: bmiInfo.bg, borderRadius: 6,
              fontWeight: 800, fontSize: 12.5, color: bmiInfo.color,
              border: `1px solid ${bmiInfo.color}30`,
            }}>
              {bmi == null ? "—" : `${bmi}`}
              <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, opacity: 0.75 }}>{bmiInfo.label}</span>
            </div>
          </Field>
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
      <Card title="Diet plan template" color={C.green} icon="pi-book"
        right={suggested && (
          <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "#f0fdf4", color: "#15803d", fontWeight: 800, border: "1px solid #86efac" }}>
            <i className="pi pi-sparkles" style={{ fontSize: 10, marginRight: 4 }} />
            Suggested: {CATEGORY_LABELS[suggested]}
          </span>
        )}>
        <Field label="Choose a base template (optional — leave blank for custom plan)">
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <select value={chosenTpl} onChange={(e) => setChosenTpl(e.target.value)}
              style={{ flex: 1, padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 6, fontSize: 13, background: "#fff" }}>
              <option value="">— No template / custom plan —</option>
              {suggested && (
                <optgroup label="✨ Suggested for typed conditions">
                  {sortedTemplates.filter(t => t.category === suggested).map(t => (
                    <option key={t._id} value={t._id}>
                      {t.name}{t.calories ? ` · ${t.calories} kcal` : ""}{t.protein ? ` · ${t.protein} g protein` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={suggested ? "All other templates" : "All templates"}>
                {sortedTemplates.filter(t => !suggested || t.category !== suggested).map(t => (
                  <option key={t._id} value={t._id}>
                    {t.name} [{CATEGORY_LABELS[t.category] || t.category}]{t.calories ? ` · ${t.calories} kcal` : ""}{t.protein ? ` · ${t.protein} g protein` : ""}
                  </option>
                ))}
              </optgroup>
            </select>
            <button type="button" disabled={!chosenTplObj}
              onClick={() => setPreviewTpl(chosenTplObj)}
              style={{
                padding: "0 14px", borderRadius: 6, border: `1.5px solid ${chosenTplObj ? C.green : C.border}`,
                background: chosenTplObj ? "#f0fdf4" : "#fff",
                color: chosenTplObj ? "#15803d" : C.muted,
                fontSize: 12, fontWeight: 800, cursor: chosenTplObj ? "pointer" : "not-allowed",
                whiteSpace: "nowrap",
              }}>
              <i className="pi pi-eye" style={{ marginRight: 5 }} />Preview
            </button>
          </div>
        </Field>

        {chosenTplObj && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, fontSize: 12, color: "#166534" }}>
            <strong>{chosenTplObj.name}</strong> — {chosenTplObj.description}
            {chosenTplObj.contraindications?.length > 0 && (
              <div style={{ marginTop: 4, color: "#b91c1c" }}>
                ⚠️ Contraindicated: {chosenTplObj.contraindications.join("; ")}
              </div>
            )}
          </div>
        )}

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
          {editingId && (
            <button type="button" onClick={printPlan}
              style={{ padding: "8px 16px", borderRadius: 7, border: `1.5px solid ${C.blue}`, background: "#fff", color: C.blue, fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>
              <i className="pi pi-print" style={{ marginRight: 5 }} />Print Plan
            </button>
          )}
          <PrimaryButton
            label={!canWrite ? "Read-only" : editingId ? "Update Plan" : "Save & Assign Plan"}
            icon={editingId ? "pi-save" : "pi-check"}
            color={C.green} onClick={save} busy={saving} disabled={!canWrite} />
        </div>
      </Card>

      {previewTpl && <TemplatePreview tmpl={previewTpl} onClose={() => setPreviewTpl(null)} />}

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

/* Render a printable HTML page for a saved PatientDietPlan.
   Self-contained — uses inline CSS so it works in a fresh window.
   The plan snapshot (plan.meals) is the source of truth; the template
   could change later but the printed plan stays what was assigned. */
function renderPrintHTML(p, patient) {
  const a = p.assessment || {};
  const pl = p.plan || {};
  const meals = pl.meals || [];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const mealRows = meals.map(m => `
    <tr>
      <td style="font-weight:700;white-space:nowrap;vertical-align:top;padding:8px 12px;border-bottom:1px solid #e5e7eb">
        ${esc(m.time)}${m.timeHi ? `<div style="font-weight:400;color:#6b7280;font-size:11px">${esc(m.timeHi)}</div>` : ""}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">
        <ul style="margin:0;padding-left:18px">
          ${(m.items || []).map(it => `
            <li style="margin-bottom:3px">
              ${it.day ? `<strong style="color:#15803d;margin-right:6px">${esc(it.day)}:</strong>` : ""}
              ${esc(it.en)}
              ${it.hi ? `<div style="color:#6b7280;font-size:11px">${esc(it.hi)}</div>` : ""}
              ${it.notes ? `<div style="color:#6b7280;font-size:11px;font-style:italic">${esc(it.notes)}</div>` : ""}
            </li>`).join("")}
        </ul>
      </td>
    </tr>`).join("");
  const instr = (pl.instructions || []).concat(pl.customisations ? ["Customisation: " + pl.customisations] : [])
    .map(s => `<li>${esc(s)}</li>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Diet Plan — ${esc(patient?.patientName || p.UHID)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:0;padding:24px}
  h1{font-size:18px;margin:0 0 4px;color:#15803d}
  h2{font-size:13px;margin:18px 0 6px;color:#374151;text-transform:uppercase;letter-spacing:.5px}
  .meta{display:flex;justify-content:space-between;margin-bottom:14px;font-size:12px;color:#6b7280;border-bottom:2px solid #15803d;padding-bottom:8px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;font-size:11.5px;margin-bottom:12px}
  .summary div{background:#f0fdf4;border:1px solid #86efac;padding:6px 8px;border-radius:5px}
  .summary b{display:block;color:#15803d;font-size:10px;text-transform:uppercase;margin-bottom:2px}
  .notes{background:#fffbeb;border:1px solid #fbbf24;padding:10px 12px;border-radius:6px;font-size:12px;margin-top:14px}
  @media print{ body{padding:14px} }
</style></head><body>
<div class="meta">
  <div><h1>Diet Plan</h1><div>${esc(pl.templateName || "Custom Plan")}${pl.templateCode ? ` (${esc(pl.templateCode)})` : ""}</div></div>
  <div style="text-align:right">
    <strong>${esc(patient?.patientName || p.patientName)}</strong><br>
    UHID: ${esc(p.UHID)}<br>
    Issued: ${today}
  </div>
</div>

<div class="summary">
  <div><b>Target Calories</b>${pl.targetCalories || "—"} kcal</div>
  <div><b>Target Protein</b>${pl.targetProtein || "—"} g</div>
  <div><b>Fluid limit</b>${pl.fluidRestriction || "—"} ml/day</div>
  <div><b>Salt limit</b>${pl.saltRestriction || "—"} g/day</div>
</div>

<h2>Assessment</h2>
<div style="font-size:12px;color:#374151;line-height:1.6">
  Height ${a.height ?? "—"} cm · Weight ${a.weight ?? "—"} kg · BMI ${a.bmi ?? "—"}
  ${a.bp ? ` · BP ${esc(a.bp)}` : ""}
  ${a.bloodSugarFasting ? ` · FBS ${a.bloodSugarFasting}` : ""}${a.hba1c ? ` · HbA1c ${a.hba1c}%` : ""}
  ${a.creatinine ? ` · Cr ${a.creatinine}` : ""}${a.hemoglobin ? ` · Hb ${a.hemoglobin}` : ""}
  ${a.conditions?.length ? `<br><strong>Conditions:</strong> ${esc(a.conditions.join(", "))}` : ""}
  ${a.allergies?.length ? `<br><strong>Allergies:</strong> ${esc(a.allergies.join(", "))}` : ""}
  ${a.medications?.length ? `<br><strong>Medications:</strong> ${esc(a.medications.join(", "))}` : ""}
</div>

<h2>Meal Schedule</h2>
<table>
  <thead><tr style="background:#f0fdf4"><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #15803d">Time</th><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #15803d">Items</th></tr></thead>
  <tbody>${mealRows || `<tr><td colspan="2" style="padding:14px;text-align:center;color:#6b7280">Custom plan — no template meals snapshotted.</td></tr>`}</tbody>
</table>

${instr ? `<div class="notes"><strong>⚠️ Instructions</strong><ul style="margin:6px 0 0;padding-left:18px">${instr}</ul></div>` : ""}

<div style="margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;display:flex;justify-content:space-between">
  <span>Assigned: ${p.assignedAt ? new Date(p.assignedAt).toLocaleDateString("en-IN") : "—"}</span>
  <span>Follow-up: ${p.followUpAt ? new Date(p.followUpAt).toLocaleDateString("en-IN") : "—"}</span>
</div>
</body></html>`;
}

/* ══════════════════════════════════════════════════════════════
   3. PLAN LIBRARY — 17 seeded templates browsable by category
══════════════════════════════════════════════════════════════ */
function LibraryTab({ onApplyToPatient }) {
  const { can } = useAuth();
  const canApply = can("diet.write");
  const [templates, setTemplates] = useState([]);
  const [filter, setFilter]       = useState("all");
  const [q, setQ]                 = useState("");
  const [loading, setLoading]     = useState(false);
  const [preview, setPreview]     = useState(null);
  const [applying, setApplying]   = useState(null);   // template currently being applied (patient picker open)

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
  const visible = useMemo(() => {
    let v = filter === "all" ? templates : templates.filter(t => t.category === filter);
    if (q) {
      const ql = q.toLowerCase();
      v = v.filter(t =>
        (t.name || "").toLowerCase().includes(ql) ||
        (t.description || "").toLowerCase().includes(ql) ||
        (t.indicatedFor || []).join(",").toLowerCase().includes(ql)
      );
    }
    return v;
  }, [templates, filter, q]);

  return (
    <>
      <Card title="Filter & search" color={C.green} icon="pi-filter"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / indication…" />
            <PrimaryButton label="Refresh" icon="pi-refresh" color={C.green} onClick={refresh} busy={loading} />
          </div>
        }>
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

      {visible.length === 0 ? (
        <div style={{ marginTop: 14 }}>
          <Card title="No templates match" color={C.muted} icon="pi-info-circle">
            <div style={{ padding: 14, textAlign: "center", color: C.muted, fontSize: 12.5 }}>
              {q ? `No results for "${q}".` : "No templates in this category."} Try a different filter or clear the search.
            </div>
          </Card>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
          {visible.map(t => {
            const color = CATEGORY_COLOR[t.category] || C.green;
            return (
              <div key={t._id}
                style={{
                  background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 12,
                  padding: 16, display: "flex", flexDirection: "column", gap: 8,
                  transition: "all .15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = color + "55"; e.currentTarget.style.boxShadow = `0 6px 18px ${color}25`; e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Badge value={CATEGORY_LABELS[t.category] || t.category} />
                  <span style={{ fontFamily: "monospace", fontSize: 10.5, color: C.muted }}>{t.code}</span>
                </div>
                <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{t.name}</div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4, minHeight: 32 }}>{t.description}</div>
                <div style={{ display: "flex", gap: 8, paddingTop: 4, fontSize: 11, color: C.muted, fontWeight: 700 }}>
                  {t.calories && <span>🔥 {t.calories} kcal</span>}
                  {t.protein && <span>💪 {t.protein} g protein</span>}
                  {t.durationType === "weekly" && <span>📅 Weekly</span>}
                  <span style={{ marginLeft: "auto" }}>{t.meals?.length || 0} meals</span>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.border}` }}>
                  <button onClick={() => setPreview(t)}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: 6,
                      border: `1.5px solid ${C.border}`, background: "#fff",
                      color: C.muted, fontWeight: 800, fontSize: 11.5, cursor: "pointer",
                    }}>
                    <i className="pi pi-eye" style={{ marginRight: 4 }} />Preview
                  </button>
                  {canApply && onApplyToPatient && (
                    <button onClick={() => setApplying(t)}
                      style={{
                        flex: 1, padding: "6px 10px", borderRadius: 6,
                        border: `1.5px solid ${color}`, background: color + "10",
                        color, fontWeight: 800, fontSize: 11.5, cursor: "pointer",
                      }}>
                      <i className="pi pi-arrow-right" style={{ marginRight: 4 }} />Apply to patient
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <TemplatePreview
          tmpl={preview}
          onClose={() => setPreview(null)}
          onApply={canApply && onApplyToPatient ? () => { setApplying(preview); setPreview(null); } : null}
        />
      )}

      {applying && (
        <ApplyToPatientModal
          tmpl={applying}
          onClose={() => setApplying(null)}
          onPick={(patient) => { onApplyToPatient(patient, applying._id); setApplying(null); }}
        />
      )}
    </>
  );
}

/* Modal: pick which admitted patient to apply the chosen template to.
   Pulls the same /dietitian/patients list used elsewhere; rows highlight
   patients who already have an active plan (clicking still allowed —
   AssessmentTab will load that plan and the new template selection
   becomes an UPDATE rather than a duplicate). */
function ApplyToPatientModal({ tmpl, onClose, onPick }) {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/dietitian/patients`, authHdr());
        setRows(r.data?.data || []);
      } catch {}
      setLoading(false);
    })();
  }, []);
  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter(r =>
      (r.UHID || "").toLowerCase().includes(ql) ||
      (r.patientName || "").toLowerCase().includes(ql) ||
      (r.ward || "").toLowerCase().includes(ql)
    );
  }, [rows, q]);
  const color = CATEGORY_COLOR[tmpl.category] || C.green;
  return (
    <Modal title={`Apply "${tmpl.name}" to a patient`} icon="pi-arrow-right" color={color} onClose={onClose} hideFooter size={680}>
      <div style={{ marginBottom: 10, padding: "8px 10px", background: color + "12", border: `1px solid ${color}40`, borderRadius: 6, fontSize: 12, color: C.text }}>
        <strong>{tmpl.name}</strong> — {tmpl.description}
        {tmpl.calories && <span style={{ marginLeft: 8, color: C.muted, fontWeight: 700 }}>· {tmpl.calories} kcal · {tmpl.protein} g protein</span>}
      </div>
      <div style={{ marginBottom: 8 }}>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="UHID / name / ward…" width="100%" />
      </div>
      {loading ? (
        <div style={{ padding: 14, textAlign: "center", color: C.muted, fontSize: 12.5 }}>Loading patients…</div>
      ) : filtered.length === 0 ? (
        <Empty icon="pi-search" text="No referred patients found. (Active IPD admissions + OPD diet-referrals show up here.)" />
      ) : (
        <div style={{ maxHeight: 360, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
          {filtered.map((p, i) => (
            <button key={i} onClick={() => onPick(p)}
              style={{
                width: "100%", padding: "10px 14px",
                background: "#fff", border: "none",
                borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : "none",
                textAlign: "left", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 12,
                transition: "background .12s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = color + "08"}
              onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}>
              <Badge value={p.source} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: C.text }}>{p.patientName || "—"}</div>
                <div style={{ fontSize: 11, color: C.muted }}>
                  {p.UHID} · {p.ward && p.ward !== "—" ? `${p.ward} / ${p.room}-${p.bed}` : (p.department || "—")}
                  {p.referredBy && ` · Dr. ${p.referredBy}`}
                </div>
              </div>
              {p.hasPlan && <Badge value="ACTIVE PLAN" />}
              <i className="pi pi-arrow-right" style={{ fontSize: 11, color: color }} />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function TemplatePreview({ tmpl, onClose, onApply }) {
  return (
    <Modal title={tmpl.name} icon="pi-book" color={CATEGORY_COLOR[tmpl.category] || C.green} onClose={onClose} hideFooter size={760}>
      {onApply && (
        <div style={{ marginBottom: 14, padding: "10px 12px", background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 12, color: "#166534" }}>
            <strong>Ready to use this template?</strong> Pick a patient and we'll pre-fill their assessment with this plan.
          </div>
          <button onClick={onApply}
            style={{ padding: "8px 14px", borderRadius: 7, border: "1.5px solid #15803d", background: "#15803d", color: "#fff", fontWeight: 800, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
            <i className="pi pi-arrow-right" style={{ marginRight: 5 }} />Apply to patient
          </button>
        </div>
      )}
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
