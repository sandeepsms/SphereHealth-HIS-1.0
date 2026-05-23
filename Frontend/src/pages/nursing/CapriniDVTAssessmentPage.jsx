/**
 * CapriniDVTAssessmentPage.jsx — R7bq
 *
 * Nurse-driven DVT / VTE risk assessment using the Caprini 2010 form,
 * paired with the IMPROVE bleeding-risk score. POSTs to the same
 * `/api/nursing-assessments/dvt` endpoint the dispatcher watches — which
 * fans out to the DVTRegister via nabhRegisterEmitter.emitFromNursingAssessment.
 *
 * Auto-derives:
 *   - Total Caprini score (live)
 *   - Risk tier (Very Low / Low / Moderate / High / Highest)
 *   - IMPROVE bleed tier (Low / High)
 *   - Prophylaxis recommendation (server-side via emitter decision matrix)
 *
 * URL: /nursing/caprini-dvt
 */
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, Card, SubCard, Check, Field, PrimaryButton, Badge, Table, EmptyRow, C,
} from "../../Components/admin-theme";
import { API_BASE_URL as API } from "../../config/api";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

// ─────────────────────────────────────────────────────────────────────
// Caprini 2010 risk factor catalogue (weighted)
// ─────────────────────────────────────────────────────────────────────
const CAPRINI_FACTORS = {
  1: [
    { code: "AGE_41_60", label: "Age 41–60 years" },
    { code: "MINOR_SURGERY", label: "Minor surgery planned" },
    { code: "BMI_OVER_25", label: "BMI > 25 kg/m²" },
    { code: "SWOLLEN_LEGS", label: "Swollen legs (current)" },
    { code: "VARICOSE_VEINS", label: "Varicose veins" },
    { code: "PREGNANCY_POSTPARTUM", label: "Pregnancy / postpartum (<1 mo)", femaleOnly: true },
    { code: "RECURRENT_ABORTION", label: "Recurrent / unexplained spontaneous abortion", femaleOnly: true },
    { code: "OCP_HRT", label: "On oral contraceptive / HRT", femaleOnly: true },
    { code: "SEPSIS_LT_1M", label: "Sepsis (<1 mo)" },
    { code: "LUNG_DISEASE_LT_1M", label: "Serious lung disease incl. pneumonia (<1 mo)" },
    { code: "ABNORMAL_PFT", label: "Abnormal PFT (COPD)" },
    { code: "ACUTE_MI", label: "Acute myocardial infarction" },
    { code: "CHF_LT_1M", label: "Congestive heart failure (<1 mo)" },
    { code: "IBD_HISTORY", label: "History of inflammatory bowel disease" },
    { code: "MEDICAL_BEDREST", label: "Medical patient at bed rest" },
  ],
  2: [
    { code: "AGE_61_74", label: "Age 61–74 years" },
    { code: "ARTHROSCOPIC_SURGERY", label: "Arthroscopic surgery" },
    { code: "MAJOR_OPEN_SURGERY", label: "Major open surgery (>45 min)" },
    { code: "LAPAROSCOPIC_GT_45", label: "Laparoscopic surgery (>45 min)" },
    { code: "MALIGNANCY", label: "Malignancy (present or previous)" },
    { code: "BEDREST_GT_72H", label: "Patient confined to bed (>72 h)" },
    { code: "IMMOBILIZING_CAST", label: "Immobilizing plaster cast (<1 mo)" },
    { code: "CENTRAL_VENOUS_LINE", label: "Central venous access" },
  ],
  3: [
    { code: "AGE_GE_75", label: "Age ≥ 75 years" },
    { code: "HISTORY_DVT_PE", label: "History of DVT/PE" },
    { code: "FAMILY_HISTORY_THROMBOSIS", label: "Family history of thrombosis" },
    { code: "FACTOR_V_LEIDEN", label: "Factor V Leiden mutation" },
    { code: "PROTHROMBIN_20210A", label: "Prothrombin 20210A mutation" },
    { code: "LUPUS_ANTICOAGULANT", label: "Lupus anticoagulant" },
    { code: "ANTICARDIOLIPIN_AB", label: "Anticardiolipin antibodies" },
    { code: "ELEVATED_HOMOCYSTEINE", label: "Elevated serum homocysteine" },
    { code: "HIT_HISTORY", label: "Heparin-induced thrombocytopenia (HIT)" },
    { code: "OTHER_THROMBOPHILIA", label: "Other congenital/acquired thrombophilia" },
  ],
  5: [
    { code: "STROKE_LT_1M", label: "Stroke (<1 mo)" },
    { code: "ELECTIVE_LE_ARTHROPLASTY", label: "Elective major lower-extremity arthroplasty" },
    { code: "HIP_PELVIS_LEG_FRACTURE", label: "Hip, pelvis or leg fracture (<1 mo)" },
    { code: "ACUTE_SPINAL_CORD_INJURY", label: "Acute spinal cord injury w/ paralysis (<1 mo)" },
    { code: "MULTIPLE_TRAUMA", label: "Multiple trauma (<1 mo)" },
  ],
};

// IMPROVE bleeding risk factors (≥7 = high)
const IMPROVE_FACTORS = [
  { code: "MOD_RENAL_FAIL",  label: "Moderate renal failure (GFR 30–59)", points: 1 },
  { code: "MALE",            label: "Male sex", points: 1 },
  { code: "AGE_40_84",       label: "Age 40–84 years", points: 1.5 },
  { code: "CURRENT_CANCER",  label: "Current cancer", points: 2 },
  { code: "RHEUMATIC",       label: "Rheumatic disease", points: 2 },
  { code: "CV_CATHETER",     label: "Central venous catheter", points: 2 },
  { code: "ICU_CCU",         label: "ICU/CCU admission", points: 2.5 },
  { code: "SEV_RENAL_FAIL",  label: "Severe renal failure (GFR <30)", points: 2.5 },
  { code: "HEPATIC_FAILURE", label: "Hepatic failure (INR >1.5)", points: 2.5 },
  { code: "AGE_GE_85",       label: "Age ≥ 85 years", points: 3.5 },
  { code: "PLT_LT_50",       label: "Platelets <50 × 10⁹/L", points: 4 },
  { code: "RECENT_BLEED",    label: "Bleeding in 3 mo before admission", points: 4 },
  { code: "GU_ULCER",        label: "Active gastroduodenal ulcer", points: 4.5 },
];

const CONTRAINDICATIONS = [
  "Active clinically significant bleeding",
  "Severe thrombocytopenia (<50 ×10⁹/L)",
  "Known/suspected HIT",
  "Coagulopathy (INR >1.5, not on warfarin)",
  "Recent intracranial/spinal/ophthalmic surgery (<14 days)",
  "Severe uncontrolled hypertension (BP >230/120)",
  "Neuraxial anesthesia within timing window",
  "Known LMWH/UFH/DOAC hypersensitivity",
];

const PROPHYLAXIS_TONE = {
  Combined: "red",
  Pharmacological: "orange",
  Mechanical: "blue",
  "Mechanical-only-reassess": "orange",
  Ambulation: "muted",
};

function capriniTier(score) {
  if (score >= 9) return { tier: "Highest", color: "red" };
  if (score >= 5) return { tier: "High", color: "red" };
  if (score >= 3) return { tier: "Moderate", color: "orange" };
  if (score >= 1) return { tier: "Low", color: "blue" };
  return { tier: "Very Low", color: "muted" };
}

function improveTier(score) {
  if (score == null) return { tier: "", color: "muted" };
  return score >= 7 ? { tier: "High", color: "red" } : { tier: "Low", color: "blue" };
}

const fmt = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function CapriniDVTAssessmentPage() {
  const [uhid, setUhid] = useState("");
  const [patient, setPatient] = useState(null);
  const [selected, setSelected] = useState({});         // { CODE: true } across all weight buckets
  const [improveSel, setImproveSel] = useState({});
  const [contras, setContras] = useState([]);
  const [contraNotes, setContraNotes] = useState("");
  const [trigger, setTrigger] = useState("Admission");
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState([]);

  const isFemale = patient?.gender === "Female";

  const capriniScore = useMemo(() => {
    let total = 0;
    Object.entries(CAPRINI_FACTORS).forEach(([weight, list]) => {
      const w = Number(weight);
      list.forEach((f) => {
        if (!selected[f.code]) return;
        if (f.femaleOnly && !isFemale) return;
        total += w;
      });
    });
    return total;
  }, [selected, isFemale]);

  const improveScore = useMemo(() => {
    let total = 0;
    IMPROVE_FACTORS.forEach((f) => {
      if (improveSel[f.code]) total += f.points;
    });
    return Math.round(total * 10) / 10;
  }, [improveSel]);

  const cap = capriniTier(capriniScore);
  const imp = improveTier(improveScore);

  // Lookup patient by UHID
  const findPatient = async () => {
    if (!uhid.trim()) return;
    try {
      const r = await axios.get(`${API}/patients/uhid/${uhid.trim().toUpperCase()}`, authHdr());
      const p = r.data?.data || r.data?.patient || r.data;
      if (p?.UHID) {
        setPatient(p);
        await loadRecent(p.UHID);
      } else {
        toast.error("Patient not found");
        setPatient(null);
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || "Patient lookup failed");
      setPatient(null);
    }
  };

  const loadRecent = async (uhidVal) => {
    try {
      const r = await axios.get(`${API}/registers/nabh/dvt?UHID=${uhidVal}&limit=10`, authHdr());
      setRecent(r.data?.data || []);
    } catch (_) { setRecent([]); }
  };

  const handleSubmit = async () => {
    if (!patient?.UHID) return toast.error("Search patient first");
    setSaving(true);
    try {
      // Collect the factor breakdown for audit-grade trace
      const factorBreakdown = [];
      Object.entries(CAPRINI_FACTORS).forEach(([weight, list]) => {
        list.forEach((f) => {
          if (!selected[f.code]) return;
          if (f.femaleOnly && !isFemale) return;
          factorBreakdown.push({ code: f.code, label: f.label, points: Number(weight) });
        });
      });

      const payload = {
        UHID: patient.UHID,
        patientName: patient.fullName || `${patient.firstName || ""} ${patient.lastName || ""}`.trim(),
        admissionId: patient.activeAdmissionId || patient.admissionId || undefined,
        capriniScore,
        improveScore: Object.keys(improveSel).length > 0 ? improveScore : undefined,
        factorBreakdown,
        contraindications: contras,
        contraindicationNotes: contraNotes,
        reassessmentTrigger: trigger,
      };

      const r = await axios.post(`${API}/nursing-assessments/dvt`, payload, authHdr());
      if (r.data?.success) {
        toast.success(`Caprini saved · score ${capriniScore} (${cap.tier})`);
        await loadRecent(patient.UHID);
      } else {
        toast.error(r.data?.message || "Save failed");
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || "Save failed");
    }
    setSaving(false);
  };

  const toggle = (code, setter) => setter((s) => ({ ...s, [code]: !s[code] }));
  const toggleContra = (label) =>
    setContras((c) => (c.includes(label) ? c.filter((x) => x !== label) : [...c, label]));

  return (
    <AdminPage>
      <Hero
        icon="pi-shield"
        title="DVT / VTE Risk Assessment (Caprini)"
        subtitle="Auto-populates the NABH DVT register · MOM.7 + AAC.4"
        color="indigo"
      />

      <Card title="Patient">
        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <Field label="UHID">
            <input
              value={uhid}
              onChange={(e) => setUhid(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && findPatient()}
              placeholder="UH00000001"
              style={{ padding: "8px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, minWidth: 180 }}
            />
          </Field>
          <PrimaryButton onClick={findPatient}>Find Patient</PrimaryButton>
          {patient && (
            <div style={{ marginLeft: 12, padding: "8px 14px", background: "#f0f9ff", border: `1px solid #bae6fd`, borderRadius: 8 }}>
              <strong>{patient.fullName || patient.firstName}</strong> · {patient.gender} · {patient.age}y · UHID {patient.UHID}
            </div>
          )}
        </div>
      </Card>

      {patient && (
        <>
          {/* Caprini factor checkboxes — collapsible by weight */}
          <Card title="Caprini 2010 Risk Factors">
            {[5, 3, 2, 1].map((weight) => (
              <SubCard key={weight} title={`${weight}-point factors`}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
                  {CAPRINI_FACTORS[weight].map((f) => {
                    if (f.femaleOnly && !isFemale) return null;
                    return (
                      <Check
                        key={f.code}
                        label={f.label}
                        checked={!!selected[f.code]}
                        onChange={() => toggle(f.code, setSelected)}
                      />
                    );
                  })}
                </div>
              </SubCard>
            ))}
          </Card>

          {/* IMPROVE bleed risk */}
          <Card title="IMPROVE Bleeding Risk (optional — gates safety of pharmacological prophylaxis)">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
              {IMPROVE_FACTORS.map((f) => (
                <Check
                  key={f.code}
                  label={`${f.label} (${f.points} pt)`}
                  checked={!!improveSel[f.code]}
                  onChange={() => toggle(f.code, setImproveSel)}
                />
              ))}
            </div>
          </Card>

          {/* Contraindications */}
          <Card title="Contraindications to Pharmacological Prophylaxis">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
              {CONTRAINDICATIONS.map((c) => (
                <Check
                  key={c}
                  label={c}
                  checked={contras.includes(c)}
                  onChange={() => toggleContra(c)}
                />
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <Field label="Notes">
                <textarea
                  value={contraNotes}
                  onChange={(e) => setContraNotes(e.target.value)}
                  rows={2}
                  placeholder="Free-text notes (max 1000 chars)"
                  style={{ width: "100%", padding: 8, border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13 }}
                />
              </Field>
            </div>
          </Card>

          {/* Score summary + actions */}
          <Card title="Summary">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Caprini Score</div>
                <div style={{ fontSize: 36, fontWeight: 800, marginTop: 4 }}>{capriniScore}</div>
                <Badge color={cap.color}>{cap.tier}</Badge>
              </div>
              <div>
                <div style={{ fontSize: 12, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>IMPROVE Bleed</div>
                <div style={{ fontSize: 36, fontWeight: 800, marginTop: 4 }}>{Object.keys(improveSel).length === 0 ? "—" : improveScore}</div>
                {Object.keys(improveSel).length > 0 && <Badge color={imp.color}>{imp.tier}</Badge>}
              </div>
              <div>
                <Field label="Reassessment Trigger">
                  <select
                    value={trigger}
                    onChange={(e) => setTrigger(e.target.value)}
                    style={{ padding: 8, border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, width: "100%" }}
                  >
                    {["Admission", "Q-Shift", "Condition-Change", "Post-Op", "Bleeding-Event", "Pre-Discharge"].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <div style={{ marginTop: 12 }}>
                  <PrimaryButton onClick={handleSubmit} disabled={saving}>
                    {saving ? "Saving…" : "Save Assessment"}
                  </PrimaryButton>
                </div>
              </div>
            </div>

            {cap.tier === "High" || cap.tier === "Highest" ? (
              <div style={{ marginTop: 14, padding: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#991b1b", fontSize: 13 }}>
                <strong>Escalation:</strong> Caprini ≥5 — treating doctor must respond with a prophylaxis order or contraindication note within 60 min. Auto-flagged in the NABH DVT register.
              </div>
            ) : null}
          </Card>

          {/* Recent assessments for this patient */}
          <Card title={`Recent DVT assessments for ${patient.UHID} · ${recent.length}`}>
            <Table cols={["When", "Caprini", "Tier", "IMPROVE", "Prophylaxis", "Escalation", "By"]}>
              {recent.length === 0 ? (
                <EmptyRow span={7} text="No prior DVT assessments" />
              ) : recent.map((r) => (
                <tr key={r._id}>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{fmt(r.assessedAt)}</td>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}><strong>{r.capriniScore}</strong></td>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>
                    <Badge color={r.capriniTier === "Highest" || r.capriniTier === "High" ? "red" : r.capriniTier === "Moderate" ? "orange" : "blue"}>
                      {r.capriniTier}
                    </Badge>
                  </td>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{r.improveScore ?? "—"}</td>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>
                    <Badge color={PROPHYLAXIS_TONE[r.recommendedProphylaxis] || "muted"}>
                      {r.recommendedProphylaxis}
                    </Badge>
                  </td>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>
                    {r.escalatedFlag ? <Badge color="orange">{r.escalationStatus || "PENDING"}</Badge> : "—"}
                  </td>
                  <td style={{ padding: 8, fontSize: 12, borderBottom: `1px solid ${C.border}` }}>{r.assessedBy || "—"}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </AdminPage>
  );
}
