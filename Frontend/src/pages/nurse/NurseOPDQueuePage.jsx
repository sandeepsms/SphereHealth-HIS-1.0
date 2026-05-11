/**
 * NurseOPDQueuePage.jsx
 * Nurse's view of today's OPD patients — enter vitals, track status
 * Roles: Admin, Nurse
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import opdService from "../../Services/patient/opdService";
import { departmentService } from "../../Services/departmentService";
import { useAuth } from "../../context/AuthContext";

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
};

// ─── Status config ─────────────────────────────────────────────────────────────
const STATUS_CFG = {
  Waiting:      { bg: C.amberL,  color: C.amber,  dot: "#f59e0b",  border: C.amberB },
  "In Progress":{ bg: C.blueL,   color: C.blue,   dot: "#3b82f6",  border: C.blueB  },
  Completed:    { bg: C.greenL,  color: C.green,  dot: "#22c55e",  border: C.greenB },
  Referred:     { bg: C.purpleL, color: C.purple, dot: "#a855f7",  border: "#ddd6fe" },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────
const calcAge = (dob) => {
  if (!dob) return "—";
  const t = new Date(), b = new Date(dob);
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() - b.getMonth() < 0 || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a < 0 ? "—" : `${a} yrs`;
};

const fmtTime = (d) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";

const fmtDate = () =>
  new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const getShift = () => {
  const h = new Date().getHours();
  if (h >= 7 && h < 15) return { label: "Morning", color: C.amber };
  if (h >= 15 && h < 23) return { label: "Evening", color: C.blue };
  return { label: "Night", color: C.purple };
};

// ─── Toast helper (manual) ────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const show = useCallback(({ severity, summary, detail, life = 3000 }) => {
    const id = Date.now();
    setToasts(p => [...p, { id, severity, summary, detail }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), life);
  }, []);
  return { toasts, show };
}

function ToastContainer({ toasts }) {
  const sevColor = { success: C.green, error: C.red, warn: C.amber, info: C.blue };
  const sevBg    = { success: C.greenL, error: C.redL, warn: C.amberL, info: C.blueL };
  return (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: sevBg[t.severity] || "#fff",
          border: `1.5px solid ${sevColor[t.severity] || C.border}`,
          borderRadius: 10,
          padding: "12px 16px",
          minWidth: 260,
          boxShadow: "0 4px 16px rgba(0,0,0,.12)",
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}>
          <i className={`pi pi-${t.severity === "success" ? "check-circle" : t.severity === "error" ? "times-circle" : "info-circle"}`}
            style={{ color: sevColor[t.severity], fontSize: 16, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{t.summary}</div>
            {t.detail && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{t.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function NurseOPDQueuePage() {
  const { user } = useAuth();
  const { toasts, show: showToast } = useToast();
  // keep a ref for backward compat with existing toast.current?.show calls
  const toast = useRef({ show: (opts) => showToast(opts) });
  useEffect(() => { toast.current = { show: (opts) => showToast(opts) }; });

  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [filterDept, setFilterDept] = useState(null);
  const [filterVitals, setFilterVitals] = useState(null);
  const [search, setSearch] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);

  // Vitals modal
  const [vitalsModal, setVitalsModal] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [vitals, setVitals] = useState({
    weight: null, height: null, temperature: null,
    bloodPressure: "", pulse: null, respiratoryRate: null, oxygenSaturation: null,
    chiefComplaint: "", allergyHistory: "",
  });
  const [savingVitals, setSavingVitals] = useState(false);

  useEffect(() => {
    loadDepartments();
    loadQueue();
  }, []);

  const loadDepartments = async () => {
    try {
      const res = await departmentService.getActiveDepartments();
      const list = res.data || res || [];
      setDepartments([
        { label: "All Departments", value: null },
        ...(Array.isArray(list) ? list : []).map(d => ({ label: d.departmentName, value: d._id })),
      ]);
    } catch (e) { /* silent */ }
  };

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterDept) params.departmentId = filterDept;
      if (filterVitals) params.vitalsStatus = filterVitals;
      const res = await opdService.getTodayVisits(params);
      const list = res.data?.data || res.data || [];
      setVisits(Array.isArray(list) ? list : []);
      setLastRefresh(new Date());
    } catch (e) {
      toast.current?.show({ severity: "error", summary: "Error", detail: "Failed to load queue", life: 3000 });
    } finally {
      setLoading(false);
    }
  }, [filterDept, filterVitals]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const openVitals = (visit) => {
    setSelectedVisit(visit);
    setVitals({
      weight: visit.vitals?.weight || null,
      height: visit.vitals?.height || null,
      temperature: visit.vitals?.temperature || null,
      bloodPressure: visit.vitals?.bloodPressure || "",
      pulse: visit.vitals?.pulse || null,
      respiratoryRate: visit.vitals?.respiratoryRate || null,
      oxygenSaturation: visit.vitals?.oxygenSaturation || null,
      chiefComplaint: visit.chiefComplaint || "",
      allergyHistory: visit.allergyHistory || "",
    });
    setVitalsModal(true);
  };

  const saveVitals = async () => {
    if (!selectedVisit) return;
    setSavingVitals(true);
    try {
      await opdService.updateVitals(selectedVisit.visitNumber, vitals, user?.name || user?.username || "Nurse");
      toast.current?.show({ severity: "success", summary: "Vitals saved", detail: `Vitals updated for ${selectedVisit.UHID}`, life: 3000 });
      setVitalsModal(false);
      loadQueue();
    } catch (e) {
      toast.current?.show({ severity: "error", summary: "Error", detail: e?.response?.data?.message || e.message, life: 3000 });
    } finally {
      setSavingVitals(false);
    }
  };

  const updateStatus = async (visitNumber, status) => {
    try {
      await opdService.updateStatus(visitNumber, status);
      setVisits(prev => prev.map(v => v.visitNumber === visitNumber ? { ...v, status } : v));
    } catch (e) {
      toast.current?.show({ severity: "error", summary: "Error", detail: "Could not update status", life: 2000 });
    }
  };

  const vSet = (k, v) => setVitals(prev => ({ ...prev, [k]: v }));

  // Client-side search filter
  const displayed = visits.filter(v => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return v.UHID?.toLowerCase().includes(s) ||
      (v.patientName || "").toLowerCase().includes(s) ||
      (v.patientId?.fullName || "").toLowerCase().includes(s) ||
      String(v.tokenNumber || "").includes(s) ||
      (v.visitNumber || "").toLowerCase().includes(s);
  });

  // Stats
  const stats = {
    total:        visits.length,
    waiting:      visits.filter(v => v.status === "Waiting").length,
    inProgress:   visits.filter(v => v.status === "In Progress").length,
    done:         visits.filter(v => v.status === "Completed").length,
    vitalsPending:visits.filter(v => v.vitalsStatus === "Pending").length,
  };

  const shift = getShift();
  const bmi = vitals.weight && vitals.height
    ? (vitals.weight / Math.pow(vitals.height / 100, 2)).toFixed(1)
    : null;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'DM Sans',sans-serif" }}>
      <ToastContainer toasts={toasts} />

      {/* ── Header ── */}
      <div style={{
        background: "linear-gradient(135deg,#1e293b,#0f766e)",
        padding: "22px 28px",
        marginBottom: 24,
        borderRadius: 16,
        color: "#fff",
        boxShadow: "0 4px 20px rgba(15,118,110,.25)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: "rgba(255,255,255,.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <i className="pi pi-list" style={{ fontSize: 22, color: "#fff" }} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.3px" }}>OPD Queue — Today</div>
              <div style={{ fontSize: 13, opacity: .75, marginTop: 2, display: "flex", alignItems: "center", gap: 8 }}>
                <i className="pi pi-calendar" style={{ fontSize: 11 }} />
                {fmtDate()}
                {lastRefresh && (
                  <span style={{ opacity: .7 }}>· Refreshed {fmtTime(lastRefresh)}</span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Shift badge */}
            <span style={{
              background: "rgba(255,255,255,.15)",
              border: "1px solid rgba(255,255,255,.25)",
              borderRadius: 20,
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: 700,
            }}>
              <i className="pi pi-clock" style={{ fontSize: 11, marginRight: 5 }} />
              {shift.label} Shift
            </span>

            <button
              onClick={loadQueue}
              disabled={loading}
              style={{
                background: "rgba(255,255,255,.18)",
                border: "1.5px solid rgba(255,255,255,.35)",
                borderRadius: 9,
                padding: "8px 18px",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontFamily: "'DM Sans',sans-serif",
              }}
            >
              <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} style={{ fontSize: 13 }} />
              Refresh
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
          {[
            { label: "Total",          val: stats.total,         icon: "pi-users",       col: "rgba(255,255,255,.95)" },
            { label: "Waiting",        val: stats.waiting,       icon: "pi-clock",       col: "#fbbf24" },
            { label: "In Progress",    val: stats.inProgress,    icon: "pi-spin pi-spinner", col: "#60a5fa" },
            { label: "Completed",      val: stats.done,          icon: "pi-check-circle",col: "#4ade80" },
            { label: "Vitals Pending", val: stats.vitalsPending, icon: "pi-heart",       col: "#f87171" },
          ].map(({ label, val, icon, col }) => (
            <div key={label} style={{
              background: "rgba(255,255,255,.12)",
              border: "1px solid rgba(255,255,255,.18)",
              borderRadius: 12,
              padding: "12px 20px",
              minWidth: 110,
              textAlign: "center",
              backdropFilter: "blur(4px)",
            }}>
              <i className={`pi ${icon}`} style={{ fontSize: 14, color: col, marginBottom: 4, display: "block" }} />
              <div style={{ fontSize: 26, fontWeight: 800, color: col, lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: 11, opacity: .75, marginTop: 3 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div style={{
        display: "flex",
        gap: 10,
        marginBottom: 18,
        flexWrap: "wrap",
        alignItems: "center",
        background: "#fff",
        border: "1.5px solid #e2e8f0",
        borderRadius: 12,
        padding: "12px 16px",
        boxShadow: "0 1px 3px rgba(0,0,0,.04)",
      }}>
        {/* Search */}
        <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <i className="pi pi-search" style={{
            position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
            color: C.muted, fontSize: 13, pointerEvents: "none",
          }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, UHID, or token…"
            className="his-field" style={{ paddingLeft: 34 }}
          />
        </div>

        {/* Department filter */}
        <div style={{ minWidth: 190 }}>
          <select
            value={filterDept || ""}
            onChange={e => setFilterDept(e.target.value || null)}
            className="his-select"
          >
            {departments.map(d => (
              <option key={String(d.value)} value={d.value || ""}>{d.label}</option>
            ))}
          </select>
        </div>

        {/* Vitals filter */}
        <div style={{ minWidth: 170 }}>
          <select
            value={filterVitals || ""}
            onChange={e => setFilterVitals(e.target.value || null)}
            className="his-select"
          >
            <option value="">All Vitals</option>
            <option value="Pending">Vitals Pending</option>
            <option value="Done">Vitals Done</option>
          </select>
        </div>

        <div style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>
          {displayed.length} patient{displayed.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* ── Queue list ── */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            border: `3px solid ${C.primaryL}`,
            borderTopColor: C.primary,
            animation: "spin 0.8s linear infinite",
            margin: "0 auto",
          }} />
          <div style={{ marginTop: 14, color: C.muted, fontSize: 14 }}>Loading queue…</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : displayed.length === 0 ? (
        <div style={{
          background: "#fff",
          border: "1.5px solid #e2e8f0",
          borderRadius: 14,
          padding: "56px 24px",
          textAlign: "center",
          boxShadow: "0 1px 3px rgba(0,0,0,.04)",
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16,
            background: C.primaryL,
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
          }}>
            <i className="pi pi-inbox" style={{ fontSize: 28, color: C.primary }} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>No patients in queue</div>
          <div style={{ color: C.muted, fontSize: 13 }}>There are no OPD visits matching your filters today.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {displayed.map(visit => (
            <QueueCard key={visit._id} visit={visit} onVitals={() => openVitals(visit)} onStatusChange={updateStatus} />
          ))}
        </div>
      )}

      {/* ── Vitals Modal ── */}
      {vitalsModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,.45)",
          backdropFilter: "blur(3px)",
          zIndex: 1000,
          display: "flex", alignItems: "flex-end", justifyContent: "center",
          animation: "fadeIn .15s ease",
        }}>
          <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}} @keyframes slideUp{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
          <div style={{
            background: "#fff",
            borderRadius: "20px 20px 0 0",
            width: "100%",
            maxWidth: 600,
            maxHeight: "92vh",
            overflow: "auto",
            animation: "slideUp .2s ease",
            boxShadow: "0 -8px 40px rgba(0,0,0,.18)",
          }}>
            {/* Modal header */}
            <div style={{
              background: "linear-gradient(135deg,#1e293b,#0f766e)",
              padding: "18px 24px",
              borderRadius: "20px 20px 0 0",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: "rgba(255,255,255,.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <i className="pi pi-heart" style={{ fontSize: 16, color: "#fff" }} />
                </div>
                <div>
                  <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>
                    Nurse Pre-Assessment
                  </div>
                  <div style={{ color: "rgba(255,255,255,.7)", fontSize: 12, marginTop: 1 }}>
                    {selectedVisit?.patientName} · {selectedVisit?.UHID} · Token #{selectedVisit?.tokenNumber}
                  </div>
                </div>
              </div>
              <button onClick={() => setVitalsModal(false)} style={{
                background: "rgba(255,255,255,.15)",
                border: "none", borderRadius: 8,
                width: 32, height: 32,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: "#fff",
              }}>
                <i className="pi pi-times" style={{ fontSize: 13 }} />
              </button>
            </div>

            {/* Patient info strip */}
            <div style={{
              background: C.primaryL,
              border: `1px solid ${C.greenB}`,
              padding: "10px 24px",
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 13,
            }}>
              <i className="pi pi-comment" style={{ color: C.primary, fontSize: 12 }} />
              <strong style={{ color: C.primary }}>{selectedVisit?.UHID}</strong>
              <span style={{ color: C.muted }}>·</span>
              <span style={{ color: C.muted }}>{selectedVisit?.chiefComplaint}</span>
            </div>

            {/* Pre-assessment form */}
            <div style={{ padding: "20px 24px" }}>
              {/* ── Chief Complaint + Allergy (required before vitals) ── */}
              <div style={{
                background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 10,
                padding: "14px 16px", marginBottom: 16,
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#92400e", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>
                  <i className="pi pi-exclamation-circle" style={{ marginRight: 5 }} />
                  Clinical Information
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label className="his-label">Chief Complaint *</label>
                    <input value={vitals.chiefComplaint} onChange={e => vSet("chiefComplaint", e.target.value)}
                      placeholder="e.g. Fever, cough, chest pain…"
                      className="his-field" style={{ borderColor: vitals.chiefComplaint ? "#86efac" : "#fcd34d" }} />
                  </div>
                  <div>
                    <label className="his-label">Known Allergies</label>
                    <input value={vitals.allergyHistory} onChange={e => vSet("allergyHistory", e.target.value)}
                      placeholder="e.g. Penicillin, Sulfa, NKDA"
                      className="his-field" />
                  </div>
                </div>
              </div>

              {/* ── Vitals grid ── */}
              <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>
                <i className="pi pi-heart" style={{ marginRight: 5, color: C.primary }} />
                Vitals
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <VitalInputCustom label="Weight (kg)" value={vitals.weight} onChange={v => vSet("weight", v)} placeholder="e.g. 70" />
                <VitalInputCustom label="Height (cm)" value={vitals.height} onChange={v => vSet("height", v)} placeholder="e.g. 170" />
                <VitalInputCustom label="Temperature (°F)" value={vitals.temperature} onChange={v => vSet("temperature", v)} placeholder="e.g. 98.6" />
                <div>
                  <label className="his-label">Blood Pressure</label>
                  <input
                    value={vitals.bloodPressure}
                    onChange={e => vSet("bloodPressure", e.target.value)}
                    placeholder="120/80"
                    className="his-field"
                  />
                </div>
                <VitalInputCustom label="Pulse (bpm)" value={vitals.pulse} onChange={v => vSet("pulse", v)} placeholder="e.g. 72" />
                <VitalInputCustom label="Respiratory Rate (/min)" value={vitals.respiratoryRate} onChange={v => vSet("respiratoryRate", v)} placeholder="e.g. 16" />
                <VitalInputCustom label="SpO2 (%)" value={vitals.oxygenSaturation} onChange={v => vSet("oxygenSaturation", v)} placeholder="e.g. 98" />

                {/* Live BMI */}
                {bmi ? (
                  <div style={{
                    background: C.greenL,
                    border: `1.5px solid ${C.greenB}`,
                    borderRadius: 10,
                    padding: "12px 16px",
                    display: "flex", flexDirection: "column", justifyContent: "center",
                  }}>
                    <label className="his-label" style={{ color: C.green }}>BMI (calculated)</label>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.green, lineHeight: 1 }}>{bmi}</div>
                    <div style={{ fontSize: 11, color: C.green, opacity: .8, marginTop: 3 }}>
                      {bmi < 18.5 ? "Underweight" : bmi < 25 ? "Normal" : bmi < 30 ? "Overweight" : "Obese"}
                    </div>
                  </div>
                ) : (
                  <div style={{
                    background: "#f8fafc",
                    border: "1.5px dashed #e2e8f0",
                    borderRadius: 10,
                    padding: "12px 16px",
                    display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
                    color: C.muted, fontSize: 12,
                  }}>
                    <i className="pi pi-calculator" style={{ fontSize: 18, marginBottom: 4 }} />
                    Enter weight & height<br />to see BMI
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
                <button onClick={() => setVitalsModal(false)} style={{
                  padding: "10px 22px", borderRadius: 9,
                  border: "1.5px solid #e2e8f0",
                  background: "#fff", color: C.muted,
                  fontWeight: 600, fontSize: 13, cursor: "pointer",
                  fontFamily: "'DM Sans',sans-serif",
                }}>
                  Cancel
                </button>
                <button onClick={saveVitals} disabled={savingVitals} style={{
                  padding: "10px 26px", borderRadius: 9,
                  border: "none",
                  background: savingVitals ? "#94a3b8" : `linear-gradient(135deg,${C.primary},${C.primaryMid})`,
                  color: "#fff",
                  fontWeight: 700, fontSize: 13, cursor: savingVitals ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  fontFamily: "'DM Sans',sans-serif",
                  boxShadow: savingVitals ? "none" : "0 2px 8px rgba(15,118,110,.3)",
                }}>
                  <i className={`pi ${savingVitals ? "pi-spin pi-spinner" : "pi-check"}`} style={{ fontSize: 13 }} />
                  {savingVitals ? "Saving…" : "Save Pre-Assessment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vital input (numeric, custom) ────────────────────────────────────────────
function VitalInputCustom({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="his-label">{label}</label>
      <input
        type="number"
        value={value === null || value === undefined ? "" : value}
        onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
        placeholder={placeholder}
        className="his-field"
      />
    </div>
  );
}

// ─── Queue card ────────────────────────────────────────────────────────────────
function QueueCard({ visit, onVitals, onStatusChange }) {
  const sc = STATUS_CFG[visit.status] || STATUS_CFG.Waiting;
  const vitalsDone = visit.vitalsStatus === "Done";
  const doctorName = visit.doctorId?.personalInfo
    ? `Dr. ${visit.doctorId.personalInfo.firstName || ""} ${visit.doctorId.personalInfo.lastName || ""}`.trim()
    : visit.consultantName || "—";
  const deptName = visit.departmentId?.departmentName || visit.department || "—";

  return (
    <div style={{
      background: "#fff",
      border: "1.5px solid #e2e8f0",
      borderRadius: 12,
      overflow: "hidden",
      boxShadow: "0 1px 3px rgba(0,0,0,.04)",
      display: "flex",
      alignItems: "stretch",
      transition: "box-shadow .15s",
    }}>
      {/* Teal left accent */}
      <div style={{ width: 5, background: `linear-gradient(180deg,${C.primary},${C.primaryMid})`, flexShrink: 0 }} />

      {/* Token badge */}
      <div style={{
        background: C.primaryL,
        borderRight: `1px solid ${C.border}`,
        padding: "14px 18px",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        minWidth: 76,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: C.primary, letterSpacing: 1, textTransform: "uppercase" }}>Token</span>
        <span style={{ fontSize: 30, fontWeight: 900, color: C.primary, lineHeight: 1.1 }}>
          {String(visit.tokenNumber || "—").padStart(2, "0")}
        </span>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: "14px 18px", minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: C.text, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>{visit.patientName || visit.UHID}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.primary, background: C.primaryL, padding: "1px 8px", borderRadius: 20 }}>
                {visit.UHID}
              </span>
              <span style={{ fontSize: 11, fontWeight: 400, color: C.muted }}>
                {visit.age ? `· ${visit.age}` : ""}{visit.gender ? ` · ${visit.gender}` : ""}
                {visit.patientVisitSeq ? ` · Visit ${visit.patientVisitSeq}` : ""}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "#475569", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <i className="pi pi-building" style={{ fontSize: 11, color: C.muted }} />
              {deptName}
              <span style={{ color: "#cbd5e1" }}>·</span>
              <i className="pi pi-user" style={{ fontSize: 11, color: C.muted }} />
              {doctorName}
              <span style={{ color: "#cbd5e1" }}>·</span>
              <span style={{ fontSize: 11, color: C.muted }}>#{visit.visitNumber}</span>
            </div>
            {visit.chiefComplaint && (
              <div style={{
                marginTop: 6,
                fontSize: 12, color: C.muted,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                padding: "3px 8px",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}>
                <i className="pi pi-comment" style={{ fontSize: 10 }} />
                {visit.chiefComplaint}
              </div>
            )}
          </div>

          {/* Status + Vitals chips */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
            <span style={{
              background: sc.bg,
              color: sc.color,
              border: `1px solid ${sc.border}`,
              borderRadius: 20,
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: 700,
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: sc.dot }} />
              {visit.status}
            </span>
            <span style={{
              background: vitalsDone ? C.greenL : C.amberL,
              color: vitalsDone ? C.green : C.amber,
              border: `1px solid ${vitalsDone ? C.greenB : C.amberB}`,
              borderRadius: 20,
              padding: "3px 10px",
              fontSize: 11,
              fontWeight: 600,
              display: "flex", alignItems: "center", gap: 4,
            }}>
              <i className={`pi ${vitalsDone ? "pi-check" : "pi-clock"}`} style={{ fontSize: 10 }} />
              Vitals: {visit.vitalsStatus || "Pending"}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{
        borderLeft: "1px solid #f1f5f9",
        padding: "12px 14px",
        display: "flex", flexDirection: "column",
        gap: 7, justifyContent: "center",
        minWidth: 148, flexShrink: 0,
      }}>
        {/* Vitals button */}
        <button onClick={onVitals} style={{
          padding: "8px 12px",
          borderRadius: 8,
          border: vitalsDone ? `1.5px solid ${C.greenB}` : "none",
          background: vitalsDone
            ? C.greenL
            : `linear-gradient(135deg,${C.primary},${C.primaryMid})`,
          color: vitalsDone ? C.green : "#fff",
          fontWeight: 700, fontSize: 12,
          cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6,
          whiteSpace: "nowrap",
          fontFamily: "'DM Sans',sans-serif",
          boxShadow: vitalsDone ? "none" : "0 2px 6px rgba(15,118,110,.25)",
        }}>
          <i className="pi pi-heart" style={{ fontSize: 12 }} />
          {vitalsDone ? "Edit Vitals" : "Enter Vitals"}
        </button>

        {/* Status flow */}
        {visit.status === "Waiting" && (
          <button onClick={() => onStatusChange(visit.visitNumber, "In Progress")} style={{
            padding: "7px 12px", borderRadius: 8,
            border: `1.5px solid ${C.blueB}`,
            background: C.blueL, color: C.blue,
            fontWeight: 600, fontSize: 11,
            cursor: "pointer",
            display: "flex", alignItems: "center", gap: 5,
            whiteSpace: "nowrap",
            fontFamily: "'DM Sans',sans-serif",
          }}>
            <i className="pi pi-play" style={{ fontSize: 10 }} />
            Mark In Progress
          </button>
        )}
        {visit.status === "In Progress" && (
          <button onClick={() => onStatusChange(visit.visitNumber, "Completed")} style={{
            padding: "7px 12px", borderRadius: 8,
            border: `1.5px solid ${C.greenB}`,
            background: C.greenL, color: C.green,
            fontWeight: 600, fontSize: 11,
            cursor: "pointer",
            display: "flex", alignItems: "center", gap: 5,
            whiteSpace: "nowrap",
            fontFamily: "'DM Sans',sans-serif",
          }}>
            <i className="pi pi-check" style={{ fontSize: 10 }} />
            Mark Complete
          </button>
        )}
      </div>
    </div>
  );
}
