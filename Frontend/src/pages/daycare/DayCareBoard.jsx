// pages/daycare/DayCareBoard.jsx
// R7hr(DC-P1) — "Day Care Today" board. Day-care admissions used to ride
// the generic IPD lists: no single view of "aaj kaun aaya, checklist hui,
// discharge-ready kaun, overdue kaun". This board lists today's (and all
// active) Day Care admissions with derived stage chips and two nurse
// actions — the pre-procedure safety checklist (NABH day-care core) and
// the Aldrete-style discharge-readiness score (≥9/10 = READY).
import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";

const C = { amber: "#d97706", green: "#059669", red: "#dc2626", slate: "#64748b" };

const chip = (bg, fg, text) => (
  <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 6, marginRight: 6 }}>{text}</span>
);

// Derived stage: checklist → recovery → READY (+overdue overlay)
function stageOf(a) {
  const cl = a.dayCare?.preProcChecklist || {};
  const clDone = cl.consentVerified && cl.npoConfirmed && cl.siteMarked && cl.highRiskMedsReviewed;
  const total = a.dayCare?.readiness?.total;
  if (total != null && total >= 9) return { key: "READY", el: chip("#dcfce7", "#166534", `✅ READY (${total}/10)`) };
  if (total != null) return { key: "RECOVERY", el: chip("#fef9c3", "#854d0e", `Recovery — score ${total}/10`) };
  if (clDone) return { key: "PROC", el: chip("#e0f2fe", "#075985", "Checklist ✓ — procedure/recovery") };
  return { key: "PREPROC", el: chip("#fee2e2", "#991b1b", "Pre-procedure checklist pending") };
}

export default function DayCareBoard() {
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checklistFor, setChecklistFor] = useState(null);
  const [readinessFor, setReadinessFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_ENDPOINTS.ADMISSIONS}`, {
        params: { admissionType: "Day Care", status: "Active", limit: 200 },
      });
      setList(res.data?.admissions || res.data?.data || []);
    } catch (e) {
      toast.error("Day-care list load failed");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16, fontFamily: "inherit" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>🌤 Day Care — Today</h2>
          <div style={{ fontSize: 12, color: C.slate }}>Active day-care admissions · checklist → procedure → recovery → ready → same-day discharge</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12 }}>↻ Refresh</button>
          <button onClick={() => navigate("/reception/register?type=Day Care")} style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: C.amber, color: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: 12 }}>＋ New Day Care</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: C.slate }}>Loading…</div>
      ) : list.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: C.slate }}>Aaj koi active day-care admission nahi.</div>
      ) : list.map((a) => {
        const st = stageOf(a);
        const edt = a.expectedDischargeDate || a.expectedDischargeTime;
        const overdue = a.status === "Active" && edt && new Date(edt) < new Date() && st.key !== "READY";
        return (
          <div key={a._id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderLeft: `4px solid ${overdue ? C.red : st.key === "READY" ? C.green : C.amber}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14.5 }}>
                  {a.patientName || a.UHID}
                  <span style={{ marginLeft: 8 }}>{st.el}</span>
                  {overdue && chip("#fee2e2", "#991b1b", `⏰ OVERDUE — expected ${new Date(edt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`)}
                </div>
                <div style={{ fontSize: 12, color: C.slate, marginTop: 3 }}>
                  {a.admissionNumber} · UHID {a.UHID} · <strong>{a.reasonForAdmission || a.provisionalDiagnosis || "procedure"}</strong>
                  {a.attendingDoctor && <> · Dr: {a.attendingDoctor}</>}
                  {a.bedNumber && <> · Bed {a.bedNumber}</>}
                  {edt && <> · Expected out: {new Date(edt).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button onClick={() => setChecklistFor(a)} style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 11.5 }}>☑ Checklist</button>
                <button onClick={() => setReadinessFor(a)} style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 11.5 }}>📊 Readiness</button>
                <button onClick={() => navigate(`/billing/ipd/${a._id}`)} title="Live ledger" style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>₹</button>
              </div>
            </div>
          </div>
        );
      })}

      {checklistFor && <ChecklistModal adm={checklistFor} onClose={() => setChecklistFor(null)} onSaved={() => { setChecklistFor(null); load(); }} />}
      {readinessFor && <ReadinessModal adm={readinessFor} onClose={() => setReadinessFor(null)} onSaved={() => { setReadinessFor(null); load(); }} />}
    </div>
  );
}

const overlay = { position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const box = { background: "#fff", borderRadius: 14, padding: 18, width: "min(480px, 96vw)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,.25)" };

function ChecklistModal({ adm, onClose, onSaved }) {
  const cl = adm.dayCare?.preProcChecklist || {};
  const [f, setF] = useState({
    consentVerified: !!cl.consentVerified, npoConfirmed: !!cl.npoConfirmed,
    siteMarked: !!cl.siteMarked, highRiskMedsReviewed: !!cl.highRiskMedsReviewed,
  });
  const [saving, setSaving] = useState(false);
  const items = [
    ["consentVerified", "Consent verified (procedure + anaesthesia)"],
    ["npoConfirmed", "NPO / fasting status confirmed"],
    ["siteMarked", "Procedure site marked & verified"],
    ["highRiskMedsReviewed", "High-risk meds reviewed (anticoagulants, insulin…)"],
  ];
  const save = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API_ENDPOINTS.ADMISSIONS}/${adm._id}/daycare`, { checklist: f });
      toast.success("Checklist saved");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.message || "Save failed"); setSaving(false); }
  };
  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(ev) => ev.stopPropagation()}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>☑ Pre-procedure Checklist — {adm.patientName || adm.UHID}</div>
        {items.map(([k, label]) => (
          <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 6px", borderBottom: "1px solid #f1f5f9", fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={f[k]} onChange={(ev) => setF((p) => ({ ...p, [k]: ev.target.checked }))} />
            {label}
          </label>
        ))}
        {cl.completedAt && <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>Last: {cl.completedBy} · {new Date(cl.completedAt).toLocaleString("en-IN")}</div>}
        <button onClick={save} disabled={saving} style={{ width: "100%", marginTop: 12, padding: "10px 0", background: "#0f172a", color: "#fff", border: "none", borderRadius: 9, fontWeight: 800, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}>
          {saving ? "Saving…" : "Save Checklist"}
        </button>
      </div>
    </div>
  );
}

function ReadinessModal({ adm, onClose, onSaved }) {
  const r = adm.dayCare?.readiness || {};
  const [f, setF] = useState({
    consciousness: r.consciousness ?? 2, oxygenation: r.oxygenation ?? 2,
    ambulation: r.ambulation ?? 1, pain: r.pain ?? 1, bleeding: r.bleeding ?? 2,
  });
  const [saving, setSaving] = useState(false);
  const total = Object.values(f).reduce((s, v) => s + Number(v || 0), 0);
  const CRIT = [
    ["consciousness", "Consciousness", ["Unresponsive", "Arousable", "Fully awake"]],
    ["oxygenation", "SpO₂ / breathing", ["<90% on O₂", ">90% with O₂", ">92% room air"]],
    ["ambulation", "Ambulation", ["Unable", "With assistance", "Steady, as pre-op"]],
    ["pain", "Pain control", ["Severe", "Moderate (oral meds)", "Minimal/none"]],
    ["bleeding", "Surgical site / bleeding", ["Active concern", "Minimal ooze", "Dry & clean"]],
  ];
  const save = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API_ENDPOINTS.ADMISSIONS}/${adm._id}/daycare`, { readiness: f });
      toast.success(`Readiness saved — ${total}/10 ${total >= 9 ? "(READY ✅)" : ""}`);
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.message || "Save failed"); setSaving(false); }
  };
  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(ev) => ev.stopPropagation()}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>📊 Discharge Readiness — {adm.patientName || adm.UHID}</div>
        <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 10 }}>Aldrete-style: 0–2 per criterion · <strong>≥9/10 = fit for same-day discharge</strong> (doctor sign-off still applies)</div>
        {CRIT.map(([k, label, opts]) => (
          <div key={k} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 3 }}>{label}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {opts.map((o, score) => (
                <button key={score} onClick={() => setF((p) => ({ ...p, [k]: score }))}
                  style={{ flex: 1, padding: "6px 4px", borderRadius: 7, fontSize: 10.5, fontFamily: "inherit", cursor: "pointer",
                    border: f[k] === score ? "2px solid #0f172a" : "1px solid #cbd5e1",
                    background: f[k] === score ? (score === 2 ? "#dcfce7" : score === 1 ? "#fef9c3" : "#fee2e2") : "#fff",
                    fontWeight: f[k] === score ? 800 : 600 }}>
                  {score} — {o}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 16, padding: "8px 0", color: total >= 9 ? "#166534" : "#854d0e" }}>
          Total: {total}/10 {total >= 9 ? "— READY ✅" : "— observe & re-score"}
        </div>
        <button onClick={save} disabled={saving} style={{ width: "100%", padding: "10px 0", background: "#0f172a", color: "#fff", border: "none", borderRadius: 9, fontWeight: 800, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}>
          {saving ? "Saving…" : "Save Score"}
        </button>
      </div>
    </div>
  );
}
