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
  blue: "#4f46e5", blueL: "#eef2ff", blueB: "#c7d2fe",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  slate: "#1e293b", slateMid: "#334155",
  pink: "#be185d", pinkL: "#fdf2f8",
};

// ─── Status config ─────────────────────────────────────────────────────────────
const STATUS_CFG = {
  Waiting:      { bg: C.amberL,  color: C.amber,  dot: "#f59e0b",  border: C.amberB },
  "In Progress":{ bg: C.blueL,   color: C.blue,   dot: "#6366f1",  border: C.blueB  },
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

  // Vitals modal — R7hf: BP split into S/D, RBS sub-section added
  const [vitalsModal, setVitalsModal] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [vitals, setVitals] = useState({
    weight: null, height: null, temperature: null,
    bloodPressure: "",
    bloodPressureSystolic: null,
    bloodPressureDiastolic: null,
    pulse: null, respiratoryRate: null, oxygenSaturation: null,
    // Random blood sugar (auto-feeds NABH RBS register)
    bloodSugarRandom: null,
    bloodSugarUnit: "mg/dL",
    bloodSugarSampleType: "capillary",
    bloodSugarFasting: "Random",
    bloodSugarNotes: "",
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
    const v = visit.vitals || {};
    // R7hf — derive split BP from the schema fields if present, else
    // parse the legacy "120/80" string so editing an old record still
    // shows two boxes filled in.
    let sys = v.bloodPressureSystolic ?? null;
    let dia = v.bloodPressureDiastolic ?? null;
    if ((sys == null || dia == null) && typeof v.bloodPressure === "string" && v.bloodPressure.includes("/")) {
      const [s, d] = v.bloodPressure.split("/").map((x) => Number(x.trim()));
      if (Number.isFinite(s)) sys = s;
      if (Number.isFinite(d)) dia = d;
    }
    // R7hg — auto-fill Known Allergies from the patient's REGISTRATION
    // record so the nurse never starts with a blank field when the
    // patient already declared allergies at the front desk. Priority:
    //   1. nurse's own previous entry on this visit (visit.allergyHistory)
    //   2. structured allergyList[] on Patient master (typed ledger)
    //   3. legacy Patient.knownAllergies free-text
    const allergyListStr = Array.isArray(visit.patientId?.allergyList)
      ? visit.patientId.allergyList
          .map((row) => row?.allergen)
          .filter(Boolean)
          .join(", ")
      : "";
    const registrationAllergy =
      allergyListStr ||
      (typeof visit.patientId?.knownAllergies === "string"
        ? visit.patientId.knownAllergies.trim()
        : "");
    setVitals({
      weight: v.weight || null,
      height: v.height || null,
      temperature: v.temperature || null,
      bloodPressure: v.bloodPressure || "",
      bloodPressureSystolic: sys,
      bloodPressureDiastolic: dia,
      pulse: v.pulse || null,
      respiratoryRate: v.respiratoryRate || null,
      oxygenSaturation: v.oxygenSaturation || null,
      bloodSugarRandom: v.bloodSugarRandom ?? null,
      bloodSugarUnit: v.bloodSugarUnit || "mg/dL",
      bloodSugarSampleType: v.bloodSugarSampleType || "capillary",
      bloodSugarFasting: v.bloodSugarFasting || "Random",
      bloodSugarNotes: v.bloodSugarNotes || "",
      chiefComplaint: visit.chiefComplaint || "",
      allergyHistory: visit.allergyHistory || registrationAllergy || "",
      // Carry the registration value separately so the modal can show
      // a "From registration" chip even after the nurse edits the field.
      _registrationAllergy: registrationAllergy,
    });
    setVitalsModal(true);
  };

  const saveVitals = async () => {
    if (!selectedVisit) return;
    setSavingVitals(true);
    try {
      // R7hg — strip internal-only UI fields (prefixed with _) before
      // sending so Mongoose strict mode doesn't drop the real fields
      // and the backend payload stays clean.
      const { _registrationAllergy, ...payload } = vitals;
      // PD-03 — Stamp the nurse audit trio (Emp ID + signature image)
      // alongside the vitals so the OPD Rx Nurse Pre-Assessment print
      // footer shows Emp ID and a real signature image instead of "—"
      // and a blank line. Backend extracts these top-level keys before
      // spreading the rest into the vitals sub-doc.
      payload.vitalsEnteredByEmployeeId = user?.employeeId || "";
      payload.vitalsEnteredBySignature  = user?.signature  || "";
      // PD-03 — Prefer the user's fullName for the print footer's "Nurse"
      // column. The pre-fix fallback to "Nurse" (role string) is why the
      // print row showed the role label instead of the actual nurse.
      await opdService.updateVitals(
        selectedVisit.visitNumber,
        payload,
        user?.fullName || user?.name || user?.username || "Nurse",
      );
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
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'DM Sans',sans-serif", padding: "16px 20px 60px" }}>
      <ToastContainer toasts={toasts} />

      {/* ── Hero (R7he — matches system UI / IPD Live Ledger pattern) ── */}
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: "14px 18px",
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 14,
        boxShadow: "0 1px 2px rgba(15,23,42,.04)",
      }}>
        {/* Accent left strip */}
        <div style={{
          width: 4, alignSelf: "stretch", borderRadius: 4,
          background: `linear-gradient(180deg,${C.primary},${C.primaryMid})`,
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: C.primary, letterSpacing: ".7px", textTransform: "uppercase" }}>
            Nurse · OPD Desk
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginTop: 2, letterSpacing: "-.2px" }}>
            OPD Queue — Today
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <i className="pi pi-calendar" style={{ fontSize: 10 }} />
            {fmtDate()}
            {lastRefresh && (
              <>
                <span style={{ color: "#cbd5e1" }}>·</span>
                <span>Refreshed {fmtTime(lastRefresh)}</span>
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            background: shift.label === "Morning" ? C.amberL : shift.label === "Evening" ? C.blueL : C.purpleL,
            color: shift.color,
            border: `1px solid ${shift.label === "Morning" ? C.amberB : shift.label === "Evening" ? C.blueB : "#ddd6fe"}`,
            borderRadius: 20,
            padding: "4px 12px",
            fontSize: 11,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            whiteSpace: "nowrap",
          }}>
            <i className="pi pi-clock" style={{ fontSize: 10 }} />
            {shift.label} Shift
          </span>

          <button
            onClick={loadQueue}
            disabled={loading}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: "#fff",
              color: C.text,
              fontWeight: 600,
              fontSize: 12,
              cursor: loading ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "'DM Sans',sans-serif",
            }}
          >
            <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} style={{ fontSize: 11 }} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── KPI strip (R7he) ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { label: "Total",          val: stats.total,         icon: "pi-users",        tone: C.primary, tint: C.primaryL,  border: "#a7f3d0" },
          { label: "Waiting",        val: stats.waiting,       icon: "pi-clock",        tone: C.amber,   tint: C.amberL,    border: C.amberB },
          { label: "In Progress",    val: stats.inProgress,    icon: "pi-spin pi-spinner", tone: C.blue, tint: C.blueL,     border: C.blueB  },
          { label: "Completed",      val: stats.done,          icon: "pi-check-circle", tone: C.green,   tint: C.greenL,    border: C.greenB },
          { label: "Vitals Pending", val: stats.vitalsPending, icon: "pi-heart",        tone: C.red,     tint: C.redL,      border: C.redB   },
        ].map(({ label, val, icon, tone, tint, border }) => (
          <div key={label} style={{
            flex: "1 1 150px",
            minWidth: 130,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: "0 1px 2px rgba(15,23,42,.03)",
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: tint,
              border: `1px solid ${border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <i className={`pi ${icon}`} style={{ fontSize: 14, color: tone }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px" }}>
                {label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: tone, lineHeight: 1.1, marginTop: 1 }}>
                {val}
              </div>
            </div>
          </div>
        ))}
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
        boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 4px 12px rgba(16,24,40,.06)",
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
          boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 4px 12px rgba(16,24,40,.06)",
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

      {/* ── Vitals Modal (R7he — system UI: centered, white card, accent rail) ── */}
      {vitalsModal && (
        <div
          onClick={() => setVitalsModal(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(15,23,42,.55)",
            backdropFilter: "blur(2px)",
            zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
            animation: "fadeIn .12s ease",
          }}>
          <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}} @keyframes slideIn{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              width: "100%",
              maxWidth: 660,
              maxHeight: "92vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              animation: "slideIn .15s ease",
              boxShadow: "0 18px 50px rgba(15,23,42,.18), 0 4px 12px rgba(15,23,42,.06)",
            }}>
            {/* Modal title bar — white card + accent rail */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "14px 18px",
              borderBottom: `1px solid ${C.border}`,
              background: C.card,
            }}>
              <div style={{
                width: 4, alignSelf: "stretch", borderRadius: 4,
                background: `linear-gradient(180deg,${C.primary},${C.primaryMid})`,
              }} />
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: C.primaryL,
                border: `1px solid #a7f3d0`,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <i className="pi pi-heart" style={{ fontSize: 16, color: C.primary }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: C.primary, letterSpacing: ".7px", textTransform: "uppercase" }}>
                  OPD Pre-Assessment
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginTop: 1, lineHeight: 1.2 }}>
                  Vitals &amp; Chief Complaint
                </div>
              </div>
              <button onClick={() => setVitalsModal(false)} style={{
                background: "#fff",
                border: `1px solid ${C.border}`, borderRadius: 8,
                width: 30, height: 30,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: C.muted,
              }}>
                <i className="pi pi-times" style={{ fontSize: 12 }} />
              </button>
            </div>

            {/* Patient identity strip — 4-column system info layout */}
            <div style={{
              padding: "12px 18px",
              background: "#fafafa",
              borderBottom: `1px solid ${C.border}`,
              display: "grid",
              gridTemplateColumns: "1.4fr 1fr 1fr 0.8fr",
              gap: 16,
              alignItems: "start",
            }}>
              <div>
                <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px" }}>Patient</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.text, marginTop: 2 }}>
                  {selectedVisit?.patientName || "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px" }}>UHID</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginTop: 4, fontFamily: "'DM Mono',monospace" }}>
                  {selectedVisit?.UHID || "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px" }}>OPD No</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 4, fontFamily: "'DM Mono',monospace" }}>
                  {selectedVisit?.visitNumber || "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px" }}>Token</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginTop: 4 }}>
                  #{selectedVisit?.tokenNumber || "—"}
                </div>
              </div>
            </div>

            {/* Form body — scrollable */}
            <div style={{ padding: "16px 18px", overflow: "auto", flex: 1 }}>
              {/* ── Section: Clinical Information ── */}
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  fontSize: 10, fontWeight: 800, color: C.amber,
                  textTransform: "uppercase", letterSpacing: ".6px",
                  marginBottom: 8,
                }}>
                  <i className="pi pi-exclamation-circle" style={{ fontSize: 11 }} />
                  Clinical Information
                </div>
                <div style={{
                  background: C.amberL,
                  border: `1px solid ${C.amberB}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
                }}>
                  <div>
                    <label style={{ fontSize: 10, color: "#92400e", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                      Chief Complaint <span style={{ color: C.red }}>*</span>
                    </label>
                    <input
                      value={vitals.chiefComplaint}
                      onChange={(e) => vSet("chiefComplaint", e.target.value)}
                      placeholder="e.g. Fever, cough, chest pain…"
                      style={{
                        width: "100%",
                        marginTop: 4,
                        padding: "7px 10px",
                        borderRadius: 7,
                        border: `1.5px solid ${vitals.chiefComplaint ? "#a7f3d0" : "#fcd34d"}`,
                        background: "#fff",
                        fontSize: 13,
                        color: C.text,
                        fontFamily: "'DM Sans',sans-serif",
                        outline: "none",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: "#92400e", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                      Known Allergies
                    </label>
                    <input
                      value={vitals.allergyHistory}
                      onChange={(e) => vSet("allergyHistory", e.target.value)}
                      placeholder="e.g. Penicillin, Sulfa, NKDA"
                      style={{
                        width: "100%",
                        marginTop: 4,
                        padding: "7px 10px",
                        borderRadius: 7,
                        // R7hg — green border when pre-filled from registration
                        // so the nurse instantly sees the field carries trusted
                        // patient-master data.
                        border: `1.5px solid ${vitals._registrationAllergy ? "#a7f3d0" : C.border}`,
                        background: "#fff",
                        fontSize: 13,
                        color: C.text,
                        fontFamily: "'DM Sans',sans-serif",
                        outline: "none",
                      }}
                    />
                    {/* R7hg — visible "from registration" provenance chip.
                        Stays visible even after the nurse edits so she
                        always has the original on-file value to compare. */}
                    {vitals._registrationAllergy && (
                      <div style={{
                        marginTop: 5,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "3px 8px",
                        borderRadius: 6,
                        background: C.greenL,
                        border: `1px solid ${C.greenB}`,
                        fontSize: 10,
                        color: C.green,
                        fontWeight: 600,
                      }}>
                        <i className="pi pi-check-circle" style={{ fontSize: 9 }} />
                        From registration: {vitals._registrationAllergy}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Section: Vitals ── */}
              <div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  fontSize: 10, fontWeight: 800, color: C.primary,
                  textTransform: "uppercase", letterSpacing: ".6px",
                  marginBottom: 8,
                }}>
                  <i className="pi pi-heart" style={{ fontSize: 11 }} />
                  Vitals
                </div>
                <div style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "14px",
                  background: "#fff",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}>
                  <VitalInputCustom label="Weight (kg)" value={vitals.weight} onChange={(v) => vSet("weight", v)} placeholder="e.g. 70" />
                  <VitalInputCustom label="Height (cm)" value={vitals.height} onChange={(v) => vSet("height", v)} placeholder="e.g. 170" />
                  <VitalInputCustom label="Temperature (°F)" value={vitals.temperature} onChange={(v) => vSet("temperature", v)} placeholder="e.g. 98.6" />
                  <VitalInputCustom label="Pulse (bpm)" value={vitals.pulse} onChange={(v) => vSet("pulse", v)} placeholder="e.g. 72" />

                  {/* R7hf — BP split into Systolic + Diastolic mini-grid */}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                      Blood Pressure (mmHg)
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center", marginTop: 4 }}>
                      <input
                        type="number"
                        value={vitals.bloodPressureSystolic ?? ""}
                        onChange={(e) => vSet("bloodPressureSystolic", e.target.value === "" ? null : Number(e.target.value))}
                        placeholder="Systolic · 120"
                        style={{
                          width: "100%", padding: "7px 10px", borderRadius: 7,
                          border: `1.5px solid ${C.border}`, background: "#fff",
                          fontSize: 13, color: C.text,
                          fontFamily: "'DM Sans',sans-serif", outline: "none",
                        }}
                      />
                      <span style={{ fontSize: 16, fontWeight: 700, color: C.muted, padding: "0 4px" }}>/</span>
                      <input
                        type="number"
                        value={vitals.bloodPressureDiastolic ?? ""}
                        onChange={(e) => vSet("bloodPressureDiastolic", e.target.value === "" ? null : Number(e.target.value))}
                        placeholder="Diastolic · 80"
                        style={{
                          width: "100%", padding: "7px 10px", borderRadius: 7,
                          border: `1.5px solid ${C.border}`, background: "#fff",
                          fontSize: 13, color: C.text,
                          fontFamily: "'DM Sans',sans-serif", outline: "none",
                        }}
                      />
                    </div>
                  </div>

                  <VitalInputCustom label="Respiratory Rate (/min)" value={vitals.respiratoryRate} onChange={(v) => vSet("respiratoryRate", v)} placeholder="e.g. 16" />
                  <VitalInputCustom label="SpO2 (%)" value={vitals.oxygenSaturation} onChange={(v) => vSet("oxygenSaturation", v)} placeholder="e.g. 98" />

                  {/* BMI tile — full-row at the end */}
                  {bmi ? (
                    <div style={{
                      background: C.greenL,
                      border: `1px solid ${C.greenB}`,
                      borderRadius: 8,
                      padding: "10px 12px",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                    }}>
                      <div>
                        <div style={{ fontSize: 10, color: C.green, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                          BMI (calculated)
                        </div>
                        <div style={{ fontSize: 11, color: C.green, opacity: .85, marginTop: 2 }}>
                          {bmi < 18.5 ? "Underweight" : bmi < 25 ? "Normal" : bmi < 30 ? "Overweight" : "Obese"}
                        </div>
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: C.green, lineHeight: 1 }}>{bmi}</div>
                    </div>
                  ) : (
                    <div style={{
                      background: "#f8fafc",
                      border: `1px dashed ${C.border}`,
                      borderRadius: 8,
                      padding: "10px 12px",
                      display: "flex", alignItems: "center", gap: 10,
                      color: C.muted, fontSize: 11,
                    }}>
                      <i className="pi pi-calculator" style={{ fontSize: 14 }} />
                      Enter weight &amp; height to see BMI
                    </div>
                  )}
                </div>
              </div>

              {/* ── Section: Random Blood Sugar (R7hf) ── */}
              {/* Optional — when entered, auto-creates an NABH RBS Register row
                  with sample-type + fasting-state provenance. Only one extra
                  field (Notes) is asked for to keep the OPD desk fast. */}
              <div style={{ marginTop: 16 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  fontSize: 10, fontWeight: 800, color: "#854d0e",
                  textTransform: "uppercase", letterSpacing: ".6px",
                  marginBottom: 8,
                }}>
                  <i className="pi pi-chart-line" style={{ fontSize: 11 }} />
                  Random Blood Sugar (RBS)
                  <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 600, color: C.muted, textTransform: "none", letterSpacing: 0 }}>
                    · feeds NABH RBS register
                  </span>
                </div>
                <div style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "14px",
                  background: "#fff",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}>
                  {/* Reading + Unit (combo) */}
                  <div>
                    <label style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                      Reading
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 6, marginTop: 4 }}>
                      <input
                        type="number"
                        value={vitals.bloodSugarRandom ?? ""}
                        onChange={(e) => vSet("bloodSugarRandom", e.target.value === "" ? null : Number(e.target.value))}
                        placeholder="e.g. 110"
                        style={{
                          width: "100%", padding: "7px 10px", borderRadius: 7,
                          border: `1.5px solid ${C.border}`, background: "#fff",
                          fontSize: 13, color: C.text,
                          fontFamily: "'DM Sans',sans-serif", outline: "none",
                        }}
                      />
                      <select
                        value={vitals.bloodSugarUnit}
                        onChange={(e) => vSet("bloodSugarUnit", e.target.value)}
                        style={{
                          width: "100%", padding: "7px 8px", borderRadius: 7,
                          border: `1.5px solid ${C.border}`, background: "#fff",
                          fontSize: 12, color: C.text,
                          fontFamily: "'DM Sans',sans-serif", outline: "none",
                        }}
                      >
                        <option value="mg/dL">mg/dL</option>
                        <option value="mmol/L">mmol/L</option>
                      </select>
                    </div>
                  </div>

                  {/* Sample type */}
                  <div>
                    <label style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                      Sample Type
                    </label>
                    <select
                      value={vitals.bloodSugarSampleType}
                      onChange={(e) => vSet("bloodSugarSampleType", e.target.value)}
                      style={{
                        width: "100%", marginTop: 4, padding: "7px 10px", borderRadius: 7,
                        border: `1.5px solid ${C.border}`, background: "#fff",
                        fontSize: 13, color: C.text,
                        fontFamily: "'DM Sans',sans-serif", outline: "none",
                      }}
                    >
                      <option value="capillary">Capillary (finger-prick)</option>
                      <option value="venous">Venous</option>
                      <option value="arterial">Arterial</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </div>

                  {/* Fasting state */}
                  <div>
                    <label style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                      Fasting State
                    </label>
                    <select
                      value={vitals.bloodSugarFasting}
                      onChange={(e) => vSet("bloodSugarFasting", e.target.value)}
                      style={{
                        width: "100%", marginTop: 4, padding: "7px 10px", borderRadius: 7,
                        border: `1.5px solid ${C.border}`, background: "#fff",
                        fontSize: 13, color: C.text,
                        fontFamily: "'DM Sans',sans-serif", outline: "none",
                      }}
                    >
                      <option value="Random">Random (GRBS)</option>
                      <option value="Fasting">Fasting (FBS)</option>
                      <option value="PostPrandial">Post-Prandial (PPBS)</option>
                    </select>
                  </div>

                  {/* Notes — free text */}
                  <div>
                    <label style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>
                      Notes <span style={{ fontWeight: 500, textTransform: "none", color: C.muted, fontSize: 9 }}>(glucometer, lot no, anything else)</span>
                    </label>
                    <input
                      value={vitals.bloodSugarNotes}
                      onChange={(e) => vSet("bloodSugarNotes", e.target.value)}
                      placeholder="e.g. Accu-Chek lot 4521, last meal 2 h ago"
                      style={{
                        width: "100%", marginTop: 4, padding: "7px 10px", borderRadius: 7,
                        border: `1.5px solid ${C.border}`, background: "#fff",
                        fontSize: 13, color: C.text,
                        fontFamily: "'DM Sans',sans-serif", outline: "none",
                      }}
                    />
                  </div>

                  {/* Critical-value live hint — surfaces NABH <70 / >300 mg/dL threshold */}
                  {(() => {
                    const v = Number(vitals.bloodSugarRandom);
                    if (!Number.isFinite(v) || v <= 0) return null;
                    const mgdl = vitals.bloodSugarUnit === "mmol/L" ? Math.round(v * 18) : v;
                    const critical = mgdl < 70 || mgdl > 300;
                    return (
                      <div style={{
                        gridColumn: "1 / -1",
                        background: critical ? C.redL : C.greenL,
                        border: `1px solid ${critical ? C.redB : C.greenB}`,
                        borderRadius: 8,
                        padding: "8px 12px",
                        display: "flex", alignItems: "center", gap: 8,
                        fontSize: 12, color: critical ? C.red : C.green,
                        fontWeight: 600,
                      }}>
                        <i className={`pi ${critical ? "pi-exclamation-triangle" : "pi-check-circle"}`} style={{ fontSize: 13 }} />
                        {critical
                          ? `Critical value (${mgdl} mg/dL) — will auto-flag in RBS register + alert clinician.`
                          : `Within range (${mgdl} mg/dL) · NABH normal 70–300 mg/dL.`}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Footer actions — system pattern: white bar, separated buttons */}
            <div style={{
              borderTop: `1px solid ${C.border}`,
              background: "#fafafa",
              padding: "12px 18px",
              display: "flex", gap: 8, justifyContent: "flex-end",
            }}>
              <button onClick={() => setVitalsModal(false)} style={{
                padding: "8px 18px", borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: "#fff", color: C.text,
                fontWeight: 600, fontSize: 12, cursor: "pointer",
                fontFamily: "'DM Sans',sans-serif",
              }}>
                Cancel
              </button>
              <button onClick={saveVitals} disabled={savingVitals} style={{
                padding: "8px 22px", borderRadius: 8,
                border: "none",
                background: savingVitals ? "#94a3b8" : C.primary,
                color: "#fff",
                fontWeight: 700, fontSize: 12, cursor: savingVitals ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", gap: 6,
                fontFamily: "'DM Sans',sans-serif",
              }}>
                <i className={`pi ${savingVitals ? "pi-spin pi-spinner" : "pi-check"}`} style={{ fontSize: 12 }} />
                {savingVitals ? "Saving…" : "Save Pre-Assessment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vital input (numeric, system-styled) ─────────────────────────────────────
function VitalInputCustom({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label style={{
        fontSize: 10, color: C.muted, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: ".4px",
      }}>{label}</label>
      <input
        type="number"
        value={value === null || value === undefined ? "" : value}
        onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
        placeholder={placeholder}
        style={{
          width: "100%",
          marginTop: 4,
          padding: "7px 10px",
          borderRadius: 7,
          border: `1.5px solid ${C.border}`,
          background: "#fff",
          fontSize: 13,
          color: C.text,
          fontFamily: "'DM Sans',sans-serif",
          outline: "none",
        }}
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
      boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 4px 12px rgba(16,24,40,.06)",
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
