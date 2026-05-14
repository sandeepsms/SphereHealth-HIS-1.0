/**
 * DiabeticChartPage.jsx
 *
 * Dedicated RBS + Sliding-Scale Insulin chart. One screen, one workflow:
 *   1. Auto-loads patient from ?uhid=
 *   2. Shows the sliding-scale policy (editable, doctor sets once)
 *   3. 4-slot (default) daily grid: Pre-Breakfast / Pre-Lunch / Pre-Dinner / HS
 *      — expandable to 7-point (AC + PC for B/L/D + HS) via toggle
 *   4. Nurse types BG → recommended dose auto-fills from sliding scale
 *   5. Save → upserts the row; if dose > 0, also offers to drop a MAR entry
 *
 * Backend: /api/diabetic-chart (one sheet per admission per calendar date).
 */
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import "../../Components/clinical/clinical-forms.css";
import { useAuth } from "../../context/AuthContext";
import { API_ENDPOINTS } from "../../config/api";
import {
  getDiabeticChart, upsertDiabeticChart, upsertEntry, updateScale,
  DEFAULT_SLOTS,
} from "../../Services/diabeticChartService";

const C = {
  bg: "#f8fafc", card: "#fff", border: "#e2e8f0",
  text: "#0f172a", muted: "#64748b",
  red: "#dc2626", redL: "#fef2f2",
  amber: "#d97706", amberL: "#fffbeb",
  green: "#16a34a", greenL: "#dcfce7",
  blue: "#1d4ed8", blueL: "#eff6ff",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  teal: "#0d9488",
};

const FOUR_SLOTS  = ["AC-Breakfast","AC-Lunch","AC-Dinner","HS"];
const SEVEN_SLOTS = DEFAULT_SLOTS.map(s => s.slot);
const ALL_SLOTS_META = Object.fromEntries(DEFAULT_SLOTS.map(s => [s.slot, s]));

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

function bgBand(bg) {
  if (bg == null || bg === "" || isNaN(bg)) return { label: "—",     color: C.muted, bg: "#fff" };
  const n = Number(bg);
  if (n < 70)         return { label: "HYPO",       color: C.red,    bg: C.redL };
  if (n <= 140)       return { label: "Normal",     color: C.green,  bg: C.greenL };
  if (n <= 180)       return { label: "Borderline", color: C.amber,  bg: C.amberL };
  if (n <= 250)       return { label: "High",       color: C.amber,  bg: C.amberL };
  return                       { label: "Critical",  color: C.red,    bg: C.redL };
}
function statusPill(status) {
  switch (status) {
    case "given":     return { label: "GIVEN",       color: "#16a34a", bg: "#dcfce7" };
    case "bg-only":   return { label: "BG ONLY",     color: "#0891b2", bg: "#ecfeff" };
    case "hypo-flag": return { label: "HYPO ALERT",  color: "#dc2626", bg: "#fee2e2" };
    case "held":      return { label: "HELD",        color: "#d97706", bg: "#fef3c7" };
    case "refused":   return { label: "REFUSED",     color: "#7c3aed", bg: "#f3e8ff" };
    default:          return { label: "PENDING",     color: "#64748b", bg: "#f1f5f9" };
  }
}

// Match the sliding-scale rule for a given BG.
function recommendDose(scale, bg) {
  if (!scale?.rules?.length || bg == null || isNaN(bg)) return { dose: null, action: "" };
  const hit = scale.rules.find(r => bg >= r.lo && bg <= r.hi);
  return hit ? { dose: hit.dose, action: hit.action } : { dose: null, action: "Out of policy — call doctor" };
}

export default function DiabeticChartPage() {
  const { user } = useAuth();
  const token = localStorage.getItem("his_token");
  const headers = { Authorization: `Bearer ${token}` };

  const [uhidIn,   setUhidIn]   = useState("");
  const [patient,  setPatient]  = useState(null);   // admission record
  const [date,     setDate]     = useState(todayISO());
  const [view,     setView]     = useState("4");    // "4" | "7"
  const [sheet,    setSheet]    = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [showScale, setShowScale] = useState(false);

  // Row draft state, keyed by slot. Each draft = { bgValue, bgTime, actualDose, administeredAt, remarks }
  const [drafts, setDrafts] = useState({});
  // Per-slot save state. Each slot can be:
  //   undefined → idle
  //   "saving"  → request in flight (button disabled, spinner)
  //   "cooldown"→ 800 ms post-success buffer to swallow double-clicks
  // Map keyed by slot so different rows can be saved in parallel.
  const [saveState, setSaveState] = useState({});
  // Track the last payload hash per slot so we can also drop identical
  // re-submits even after the cooldown lapses — defensive against
  // accidental triple-click on already-saved row.
  const lastSavedHashRef = React.useRef({});

  /* ── Read UHID from URL on mount ── */
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("uhid");
    if (u && u.trim()) {
      setUhidIn(u.trim());
      loadPatient(u.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Reload sheet whenever patient or date changes ── */
  useEffect(() => {
    if (patient?.UHID && date) loadSheet(patient.UHID, date, patient);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.UHID, date]);

  const loadPatient = async (uhid) => {
    try {
      const res = await axios.get(`${API_ENDPOINTS.BASE}/admissions/active?UHID=${encodeURIComponent(uhid)}`, { headers });
      const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
      const adm  = list[0];
      if (!adm) { toast.warn("No active admission for that UHID"); return; }
      setPatient(adm);
    } catch (e) {
      toast.error("Failed to load patient");
    }
  };

  const loadSheet = async (uhid, d, adm) => {
    setLoading(true);
    try {
      const res = await getDiabeticChart(uhid, d);
      let s = res?.data;
      if (!s) {
        // Create an empty sheet on first open of the day
        const created = await upsertDiabeticChart({
          UHID: uhid, admissionId: adm._id || adm.admissionId, date: d,
          patientId: adm.patientId?._id || adm.patientId,
          admissionNumber: adm.admissionNumber,
        });
        s = created?.data;
      }
      setSheet(s);
      setDrafts({});
    } catch (e) {
      toast.error(e.message || "Failed to load chart");
    } finally { setLoading(false); }
  };

  const visibleSlots = view === "4" ? FOUR_SLOTS : SEVEN_SLOTS;
  // Build a slot→entry index for current sheet
  const entryBySlot = useMemo(() => {
    const m = {};
    (sheet?.entries || []).forEach(e => { m[e.slot] = e; });
    return m;
  }, [sheet]);

  const dft = (slot) => drafts[slot] || {};
  const setDft = (slot, patch) => setDrafts(p => ({ ...p, [slot]: { ...(p[slot] || {}), ...patch } }));

  const handleSaveSlot = async (slot) => {
    if (!sheet) return;

    // ── Double-click guard ───────────────────────────────────────────
    // If this slot is already saving (request in flight) or cooling
    // down right after a successful save (800 ms window) — drop the
    // extra click silently. Without this, a panicked double-tap was
    // posting the same row twice; the backend already idempotently
    // replaces by (slot, scheduledTime) so a duplicate row was never
    // created on disk, but the second POST raced the first and would
    // sometimes overwrite a freshly-entered value with stale state.
    if (saveState[slot] === "saving" || saveState[slot] === "cooldown") return;

    const meta = ALL_SLOTS_META[slot];
    const d = dft(slot);
    const existing = entryBySlot[slot] || {};

    const bg = d.bgValue != null && d.bgValue !== "" ? Number(d.bgValue) : (existing.bgValue ?? null);
    const recommended = recommendDose(sheet.slidingScale, bg);

    const payload = {
      slot,
      scheduledTime: existing.scheduledTime || meta?.scheduledTime || "",
      bgValue: bg,
      bgTime:  d.bgTime ?? existing.bgTime ?? nowHHMM(),
      bgRecordedBy: existing.bgRecordedBy || user?.fullName || user?.name || "",
      recommendedDose: recommended.dose,
      actualDose: d.actualDose != null && d.actualDose !== "" ? Number(d.actualDose) : (existing.actualDose ?? null),
      insulinType: sheet.slidingScale?.insulinType || "",
      route: sheet.slidingScale?.route || "SC",
      administeredAt: d.administeredAt || existing.administeredAt || (d.actualDose ? nowHHMM() : ""),
      administeredBy: d.actualDose ? (user?.fullName || user?.name || "") : (existing.administeredBy || ""),
      remarks: d.remarks ?? existing.remarks ?? "",
    };

    // Second guard: if the exact same payload (by content hash) was the
    // last thing we saved for this slot, don't bother re-POSTing. Catches
    // the rare case where someone tabs through and presses Enter twice.
    const hash = JSON.stringify({
      bg: payload.bgValue, dose: payload.actualDose,
      at: payload.administeredAt, time: payload.bgTime,
      remarks: payload.remarks,
    });
    if (lastSavedHashRef.current[slot] === hash) {
      toast.info(`${meta?.label || slot} already saved — no changes to post`);
      return;
    }

    setSaveState(s => ({ ...s, [slot]: "saving" }));
    try {
      const res = await upsertEntry(sheet._id, payload);
      setSheet(res.data);
      setDft(slot, { _saved: true, _justSaved: Date.now() });
      lastSavedHashRef.current[slot] = hash;
      toast.success(`${meta?.label || slot} saved`);
      // 800 ms cooldown so a delayed second click after the toast fires
      // is also swallowed.
      setSaveState(s => ({ ...s, [slot]: "cooldown" }));
      setTimeout(() => {
        setSaveState(s => {
          const next = { ...s }; delete next[slot]; return next;
        });
      }, 800);
    } catch (e) {
      toast.error(e.message || "Save failed");
      setSaveState(s => {
        const next = { ...s }; delete next[slot]; return next;
      });
    }
  };

  /* ── Sliding-scale editor ── */
  const [scaleDraft, setScaleDraft] = useState(null);
  useEffect(() => {
    if (sheet?.slidingScale) setScaleDraft(JSON.parse(JSON.stringify(sheet.slidingScale)));
  }, [sheet?.slidingScale]);

  const saveScale = async () => {
    if (!sheet || !scaleDraft) return;
    try {
      const res = await updateScale(sheet._id, scaleDraft);
      setSheet(res.data);
      toast.success("Sliding scale updated");
      setShowScale(false);
    } catch (e) {
      toast.error(e.message || "Failed to update scale");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div style={{
          background: "linear-gradient(135deg,#1d4ed8,#0e7490)",
          borderRadius: 14, padding: "16px 22px", marginBottom: 16,
          color: "#fff", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          boxShadow: "0 4px 14px rgba(30,64,175,.25)",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.32)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="pi pi-chart-bar" style={{ fontSize: 22 }} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px" }}>
              Diabetic Chart · RBS &amp; Insulin
            </div>
            <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>
              Per-slot blood-sugar reading + sliding-scale insulin · auto-dose suggestion
            </div>
          </div>
          {patient && (
            <div style={{ display: "flex", gap: 12, fontSize: 12, alignItems: "center" }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{patient.patientName || patient.patientId?.fullName || patient.UHID}</div>
                <div style={{ opacity: .85, fontSize: 11 }}>
                  UHID {patient.UHID} · IPD {patient.admissionNumber || "—"}
                </div>
              </div>
              <button onClick={() => { setPatient(null); setSheet(null); setUhidIn(""); }}
                style={{
                  padding: "7px 12px", borderRadius: 8,
                  background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.3)",
                  color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer",
                }}>
                <i className="pi pi-refresh" style={{ fontSize: 10, marginRight: 4 }} />Change
              </button>
            </div>
          )}
        </div>

        {/* ── Patient search (when empty) ── */}
        {!patient && (
          <div style={{ background: C.card, borderRadius: 12, padding: "14px 18px", border: `1.5px solid ${C.border}`, marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
            <i className="pi pi-search" style={{ color: C.muted, fontSize: 14 }} />
            <input className="his-field" style={{ flex: 1, minWidth: 220 }}
              placeholder="Enter UHID to load diabetic chart…"
              value={uhidIn} onChange={e => setUhidIn(e.target.value)}
              onKeyDown={e => e.key === "Enter" && loadPatient(uhidIn.trim())} />
            <button onClick={() => loadPatient(uhidIn.trim())}
              style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: C.blue, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              <i className="pi pi-arrow-circle-right" style={{ marginRight: 6 }} />Load Patient
            </button>
          </div>
        )}

        {/* ── Controls: date + view toggle + scale button ── */}
        {patient && sheet && (
          <div style={{ background: C.card, borderRadius: 12, padding: "10px 14px", border: `1.5px solid ${C.border}`, marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Date</label>
              <input type="date" className="his-field" style={{ width: 160 }}
                value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div style={{ width: 1, height: 22, background: C.border }} />
            <div style={{ display: "flex", gap: 4 }}>
              {[["4","4-slot"],["7","7-point"]].map(([k, label]) => (
                <button key={k} onClick={() => setView(k)}
                  style={{
                    padding: "7px 14px", borderRadius: 7,
                    border: `1.5px solid ${view === k ? C.blue : C.border}`,
                    background: view === k ? C.blueL : "#fff",
                    color: view === k ? C.blue : C.muted,
                    fontWeight: 700, fontSize: 11.5, cursor: "pointer",
                  }}>{label}</button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <button onClick={() => setShowScale(s => !s)}
              style={{
                padding: "7px 14px", borderRadius: 8,
                border: `1.5px solid ${C.purple}`,
                background: showScale ? C.purpleL : "#fff",
                color: C.purple, fontWeight: 700, fontSize: 12, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
              }}>
              <i className="pi pi-cog" style={{ fontSize: 11 }} />
              {showScale ? "Hide" : "Edit"} sliding scale
            </button>
          </div>
        )}

        {/* ── Sliding-scale editor ── */}
        {patient && sheet && showScale && scaleDraft && (
          <div style={{ background: C.card, borderRadius: 12, padding: "16px 20px", border: `1.5px solid ${C.purple}40`, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <i className="pi pi-cog" style={{ color: C.purple, fontSize: 14 }} />
              <div style={{ fontWeight: 800, fontSize: 14, color: C.purple }}>Sliding-Scale Insulin Policy</div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: C.purpleL, color: C.purple, border: `1px solid ${C.purple}40` }}>HIGH-ALERT MEDICATION</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 2fr", gap: 10, marginBottom: 14 }}>
              <div>
                <label className="his-label">Insulin type</label>
                <input className="his-field" value={scaleDraft.insulinType || ""}
                  onChange={e => setScaleDraft({ ...scaleDraft, insulinType: e.target.value })}
                  placeholder="Regular (Actrapid) / Humalog / Lispro" />
              </div>
              <div>
                <label className="his-label">Route</label>
                <select className="his-select" value={scaleDraft.route || "SC"}
                  onChange={e => setScaleDraft({ ...scaleDraft, route: e.target.value })}>
                  {["SC","IV","IM"].map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="his-label">Doctor notes</label>
                <input className="his-field" value={scaleDraft.notes || ""}
                  onChange={e => setScaleDraft({ ...scaleDraft, notes: e.target.value })}
                  placeholder="Hold if NPO · recheck in 1 hr if >300" />
              </div>
            </div>

            <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr 1fr 3fr auto",
                gap: 8, padding: "8px 12px",
                background: `${C.purple}08`, borderBottom: `1px solid ${C.purple}20`,
                fontSize: 10.5, fontWeight: 800, color: C.purple,
                textTransform: "uppercase", letterSpacing: ".5px",
              }}>
                <div>BG From (mg/dL)</div>
                <div>BG To</div>
                <div>Dose (units)</div>
                <div>Action / notes</div>
                <div />
              </div>
              <div style={{ padding: 10 }}>
                {(scaleDraft.rules || []).map((r, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 3fr auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <input type="number" className="his-field" value={r.lo}
                      onChange={e => {
                        const next = [...scaleDraft.rules]; next[idx] = { ...next[idx], lo: Number(e.target.value) };
                        setScaleDraft({ ...scaleDraft, rules: next });
                      }} />
                    <input type="number" className="his-field" value={r.hi}
                      onChange={e => {
                        const next = [...scaleDraft.rules]; next[idx] = { ...next[idx], hi: Number(e.target.value) };
                        setScaleDraft({ ...scaleDraft, rules: next });
                      }} />
                    <input type="number" className="his-field" value={r.dose}
                      onChange={e => {
                        const next = [...scaleDraft.rules]; next[idx] = { ...next[idx], dose: Number(e.target.value) };
                        setScaleDraft({ ...scaleDraft, rules: next });
                      }} />
                    <input className="his-field" value={r.action}
                      onChange={e => {
                        const next = [...scaleDraft.rules]; next[idx] = { ...next[idx], action: e.target.value };
                        setScaleDraft({ ...scaleDraft, rules: next });
                      }} />
                    <button onClick={() => {
                      const next = scaleDraft.rules.filter((_, i) => i !== idx);
                      setScaleDraft({ ...scaleDraft, rules: next });
                    }}
                      style={{ width: 30, height: 30, borderRadius: 6, border: "none", background: C.redL, color: C.red, cursor: "pointer" }}>
                      <i className="pi pi-trash" style={{ fontSize: 11 }} />
                    </button>
                  </div>
                ))}
                <button onClick={() => setScaleDraft({
                  ...scaleDraft,
                  rules: [...(scaleDraft.rules || []), { lo: 0, hi: 0, dose: 0, action: "" }],
                })}
                  style={{ padding: "7px 14px", borderRadius: 7, border: `1.5px dashed ${C.purple}50`, background: "#fff", color: C.purple, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  <i className="pi pi-plus" style={{ fontSize: 10, marginRight: 5 }} />Add band
                </button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <button onClick={() => { setScaleDraft(JSON.parse(JSON.stringify(sheet.slidingScale))); setShowScale(false); }}
                style={{ padding: "8px 18px", borderRadius: 8, border: `1.5px solid ${C.border}`, background: "#fff", color: C.muted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={saveScale}
                style={{ padding: "8px 22px", borderRadius: 8, border: "none", background: C.purple, color: "#fff", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                <i className="pi pi-save" style={{ fontSize: 11, marginRight: 6 }} />Save scale
              </button>
            </div>
          </div>
        )}

        {/* ── Chart table ── */}
        {patient && sheet && (
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(15,23,42,.04)" }}>
            <div style={{
              padding: "12px 18px",
              background: `linear-gradient(135deg, ${C.blueL}, ${C.blueL}80)`,
              borderBottom: `1px solid #bfdbfe`,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <i className="pi pi-calendar" style={{ fontSize: 14, color: C.blue }} />
              <div style={{ fontWeight: 800, fontSize: 14, color: C.blue }}>
                {date} · {view === "4" ? "4-slot" : "7-point"} chart
              </div>
              <span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>
                {sheet.entries?.length || 0} of {visibleSlots.length} recorded
              </span>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: `1.5px solid ${C.border}` }}>
                    {["Slot","Sched","BG (mg/dL)","Band","Recommended","Actual dose","Route","Given at","Nurse","Status","Action"].map((h, i) => (
                      <th key={h} style={{
                        padding: "10px 11px", textAlign: "left", fontWeight: 800,
                        color: C.muted, textTransform: "uppercase", letterSpacing: ".5px",
                        fontSize: 10, whiteSpace: "nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleSlots.map((slot, rowIdx) => {
                    const meta = ALL_SLOTS_META[slot];
                    const e = entryBySlot[slot];
                    const d = dft(slot);
                    const bgInput = d.bgValue !== undefined ? d.bgValue : (e?.bgValue ?? "");
                    const bg = bgInput === "" || bgInput == null ? null : Number(bgInput);
                    const rec = recommendDose(sheet.slidingScale, bg);
                    const band = bgBand(bg);
                    const stat = statusPill(e?.status);
                    const doseInput = d.actualDose !== undefined ? d.actualDose : (e?.actualDose ?? "");

                    return (
                      <tr key={slot} style={{ borderBottom: `1px solid ${C.border}`, background: rowIdx % 2 ? "#fafbfc" : "#fff" }}>
                        <td style={{ padding: "10px 11px", fontWeight: 700, color: C.text, whiteSpace: "nowrap" }}>
                          {meta?.label || slot}
                        </td>
                        <td style={{ padding: "10px 11px", color: C.muted, fontFamily: "DM Mono, monospace" }}>
                          {meta?.scheduledTime || "—"}
                        </td>
                        <td style={{ padding: "8px 11px" }}>
                          <input type="number" className="his-field" style={{ width: 80, padding: "6px 8px", fontSize: 12.5 }}
                            placeholder="—" value={bgInput}
                            onChange={ev => setDft(slot, { bgValue: ev.target.value })} />
                        </td>
                        <td style={{ padding: "10px 11px", whiteSpace: "nowrap" }}>
                          <span style={{
                            padding: "3px 9px", borderRadius: 4,
                            background: band.bg, color: band.color,
                            fontSize: 10, fontWeight: 800,
                            border: `1px solid ${band.color}30`,
                          }}>{band.label}</span>
                        </td>
                        <td style={{ padding: "10px 11px", whiteSpace: "nowrap" }}>
                          {rec.dose != null ? (
                            <div>
                              <div style={{ fontWeight: 800, color: rec.dose === 0 ? C.green : C.blue, fontSize: 13 }}>
                                {rec.dose === 0 ? "No insulin" : `${rec.dose} u ${sheet.slidingScale?.route || "SC"}`}
                              </div>
                              {rec.action && <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{rec.action}</div>}
                            </div>
                          ) : <span style={{ color: C.muted }}>—</span>}
                        </td>
                        <td style={{ padding: "8px 11px" }}>
                          {(() => {
                            // Deviation badge: actual vs recommended. Highlights
                            // the row when nurse over- or under-doses so nothing
                            // slips through silently. "—" when no actual saved.
                            const actualNum = doseInput === "" || doseInput == null ? null : Number(doseInput);
                            const recNum    = rec.dose;
                            const showBadge = actualNum != null && recNum != null && actualNum !== recNum;
                            const dev = showBadge ? actualNum - recNum : 0;
                            return (
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <input type="number" className="his-field"
                                  style={{
                                    width: 70, padding: "6px 8px", fontSize: 12.5,
                                    borderColor: showBadge ? (dev > 0 ? C.amber : C.red) : undefined,
                                  }}
                                  placeholder={recNum != null ? String(recNum) : "—"}
                                  value={doseInput}
                                  onChange={ev => setDft(slot, { actualDose: ev.target.value })} />
                                {showBadge && (
                                  <span
                                    title={`Actual ${actualNum}u differs from sliding-scale recommendation of ${recNum}u`}
                                    style={{
                                      padding: "2px 6px", borderRadius: 4,
                                      background: dev > 0 ? "#fef3c7" : "#fee2e2",
                                      color:      dev > 0 ? "#92400e" : "#991b1b",
                                      border: `1px solid ${dev > 0 ? "#fde68a" : "#fecaca"}`,
                                      fontSize: 9.5, fontWeight: 800,
                                      whiteSpace: "nowrap",
                                    }}>
                                    {dev > 0 ? "+" : ""}{dev}u
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td style={{ padding: "10px 11px", color: C.muted, fontSize: 11.5, whiteSpace: "nowrap" }}>
                          {e?.route || sheet.slidingScale?.route || "SC"}
                        </td>
                        <td style={{ padding: "8px 11px" }}>
                          <input type="time" className="his-field" style={{ width: 100, padding: "6px 8px", fontSize: 12 }}
                            value={d.administeredAt !== undefined ? d.administeredAt : (e?.administeredAt || "")}
                            onChange={ev => setDft(slot, { administeredAt: ev.target.value })} />
                        </td>
                        <td style={{ padding: "10px 11px", color: C.muted, fontSize: 11, whiteSpace: "nowrap" }}>
                          {e?.administeredBy || e?.bgRecordedBy || "—"}
                        </td>
                        <td style={{ padding: "10px 11px" }}>
                          <span style={{
                            padding: "3px 8px", borderRadius: 4,
                            background: stat.bg, color: stat.color,
                            fontSize: 10, fontWeight: 800,
                            border: `1px solid ${stat.color}30`,
                          }}>{stat.label}</span>
                        </td>
                        <td style={{ padding: "8px 11px", whiteSpace: "nowrap" }}>
                          {(() => {
                            const st = saveState[slot];
                            const saving   = st === "saving";
                            const cooling  = st === "cooldown";
                            const disabled = saving || cooling;
                            return (
                              <button
                                onClick={() => handleSaveSlot(slot)}
                                disabled={disabled}
                                aria-busy={saving}
                                style={{
                                  padding: "6px 14px", borderRadius: 6, border: "none",
                                  background: saving  ? "#94a3b8"
                                            : cooling ? "#16a34a"
                                            : C.green,
                                  color: "#fff",
                                  fontWeight: 700, fontSize: 11,
                                  cursor: disabled ? "not-allowed" : "pointer",
                                  opacity: disabled ? 0.85 : 1,
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  minWidth: 78,                          // stops the button reflowing as label changes
                                  justifyContent: "center",
                                  transition: "background .15s",
                                }}
                              >
                                {saving ? (
                                  <><i className="pi pi-spin pi-spinner" style={{ fontSize: 11 }} />Saving…</>
                                ) : cooling ? (
                                  <><i className="pi pi-check" style={{ fontSize: 11 }} />Saved</>
                                ) : (
                                  <><i className="pi pi-save" style={{ fontSize: 10 }} />Save</>
                                )}
                              </button>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Day summary footer — split into distinct metrics so nurses
                don't conflate "doses given" with "total units" and can
                spot when actual differs from recommended. */}
            <div style={{ padding: "12px 18px", background: "#f8fafc", borderTop: `1px solid ${C.border}` }}>
              {(() => {
                const all = sheet.entries || [];
                const valid = all.filter(e => e.bgValue != null);
                const avg = valid.length ? Math.round(valid.reduce((s, e) => s + e.bgValue, 0) / valid.length) : null;
                const hypo  = valid.filter(e => e.bgValue < 70).length;
                const hyper = valid.filter(e => e.bgValue > 200).length;
                const givenRows = all.filter(e => (e.actualDose || 0) > 0);
                const totalInsulin = givenRows.reduce((s, e) => s + (e.actualDose || 0), 0);
                const totalRecommended = all
                  .filter(e => (e.actualDose || 0) > 0 && e.recommendedDose != null)
                  .reduce((s, e) => s + e.recommendedDose, 0);
                const deviation = totalInsulin - totalRecommended;

                const Stat = ({ label, value, color, hint }) => (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingRight: 18, borderRight: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: color || C.text }}>{value}</span>
                    {hint && <span style={{ fontSize: 9.5, color: C.muted, marginTop: 1 }}>{hint}</span>}
                  </div>
                );

                return (
                  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <Stat label="Mean BG" color={C.text}
                      value={avg != null ? `${avg} mg/dL` : "—"}
                      hint={`${valid.length} reading${valid.length === 1 ? "" : "s"}`} />
                    <Stat label="Hypo events" color={hypo > 0 ? C.red : C.text}
                      value={hypo}
                      hint={hypo > 0 ? "BG <70 mg/dL" : "—"} />
                    <Stat label="Hyperglycaemia" color={hyper > 0 ? C.amber : C.text}
                      value={hyper}
                      hint={hyper > 0 ? "BG >200 mg/dL" : "—"} />
                    <Stat label="Doses administered" color={C.blue}
                      value={givenRows.length}
                      hint={`of ${visibleSlots.length} slot${visibleSlots.length === 1 ? "" : "s"}`} />
                    <Stat label="Total insulin" color={C.blue}
                      value={`${totalInsulin} u`}
                      hint="sum of actual doses" />
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, paddingRight: 18 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>vs recommended</span>
                      <span style={{
                        fontSize: 14, fontWeight: 800,
                        color: deviation === 0 ? C.green : deviation > 0 ? C.amber : C.red,
                      }}>
                        {deviation === 0 ? "On policy" : `${deviation > 0 ? "+" : ""}${deviation} u`}
                      </span>
                      <span style={{ fontSize: 9.5, color: C.muted, marginTop: 1 }}>
                        recommended {totalRecommended} u
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {loading && <div style={{ textAlign: "center", padding: 30, color: C.muted }}><i className="pi pi-spin pi-spinner" style={{ marginRight: 8 }} />Loading chart…</div>}
      </div>
    </div>
  );
}
