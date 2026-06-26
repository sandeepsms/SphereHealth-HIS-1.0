// Components/doctor/DoctorQuickTools.jsx
// ════════════════════════════════════════════════════════════════════
// R7hr-231 — a floating quick-access cluster for the Doctor Notes page. A FAB
// expands into tiles:
//   • 📝 Nursing Plan      — opens the assessment-plan editor (this component)
//   • 🩻 OPD Assessment    — navigate
//   • 🩺 Patient Panel     — navigate
//   • 📜 Medical Certificate — navigate
//   • 📄 Discharge Summary — navigate
// The Nursing Plan editor lets the doctor choose which nursing assessments the
// nurse must do for THIS patient + the minimum times/day (soft guidance). Saves
// to PUT /api/nursing-assessment-plan. ADDITIVE — mounted once on Doctor Notes.
// ════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { NURSING_ASSESSMENTS } from "../../config/nursingAssessments";

export default function DoctorQuickTools({ uhid = "", admissionId = "", ipdNo = "" }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  const goWithUhid = (path) => {
    setOpen(false);
    navigate(uhid ? `${path}?uhid=${encodeURIComponent(uhid)}` : path);
  };

  const TOOLS = [
    { key: "plan",    label: "Nursing Plan",        icon: "📝", onClick: () => { setOpen(false); setPlanOpen(true); }, accent: "#be185d" },
    { key: "opd",     label: "OPD Assessment",      icon: "🩻", onClick: () => goWithUhid("/opd-assessment"),      accent: "#4f46e5" },
    { key: "panel",   label: "Patient Panel",       icon: "🩺", onClick: () => goWithUhid("/doctor-patient-panel"), accent: "#7c3aed" },
    { key: "medcert", label: "Medical Certificate", icon: "📜", onClick: () => goWithUhid("/medical-certificates"), accent: "#0d9488" },
    { key: "disch",   label: "Discharge Summary",   icon: "📄", onClick: () => goWithUhid("/discharge-summary"),   accent: "#16a34a" },
  ];

  return (
    <>
      <div style={{ position: "fixed", right: 24, bottom: 96, zIndex: 940, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
        {open && TOOLS.map((t) => (
          <button key={t.key} onClick={t.onClick} title={t.label}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px 8px 12px", borderRadius: 999,
              background: "#fff", border: `1px solid ${t.accent}33`, borderLeft: `4px solid ${t.accent}`,
              boxShadow: "0 6px 18px rgba(2,6,23,.18)", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>
            <span style={{ fontSize: 16 }}>{t.icon}</span>{t.label}
          </button>
        ))}
        <button onClick={() => setOpen((o) => !o)} title="Quick tools"
          style={{ width: 54, height: 54, borderRadius: "50%", border: "none", cursor: "pointer",
            background: open ? "#0f172a" : "#4f46e5", color: "#fff", fontSize: 22,
            boxShadow: "0 8px 22px rgba(79,70,229,.45)", transition: "transform .15s", transform: open ? "rotate(45deg)" : "none" }}>
          {open ? "✕" : "➕"}
        </button>
      </div>

      {planOpen && (
        <NursingPlanModal uhid={uhid} admissionId={admissionId} ipdNo={ipdNo} onClose={() => setPlanOpen(false)} />
      )}
    </>
  );
}

function NursingPlanModal({ uhid, admissionId, ipdNo, onClose }) {
  const [rows, setRows] = useState({});   // id -> { checked, perDayMin }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assignedBy, setAssignedBy] = useState("");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (uhid) params.set("uhid", uhid);
    if (admissionId) params.set("admissionId", String(admissionId));
    setLoading(true);
    axios.get(`${API_ENDPOINTS.BASE}/nursing-assessment-plan?${params.toString()}`)
      .then((r) => {
        if (cancelled) return;
        const items = r.data?.data?.items || [];
        const byId = {};
        items.forEach((it) => { byId[it.type] = { checked: true, perDayMin: it.perDayMin || 1 }; });
        setRows(byId);
        setAssignedBy(r.data?.data?.assignedByName || "");
      })
      .catch(() => { if (!cancelled) setRows({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uhid, admissionId]);

  const toggle = (id) => setRows((p) => ({ ...p, [id]: { checked: !p[id]?.checked, perDayMin: p[id]?.perDayMin || 1 } }));
  const setMin = (id, v) => setRows((p) => ({ ...p, [id]: { checked: true, perDayMin: Math.max(1, Math.min(96, Number(v) || 1)) } }));

  const save = useCallback(async () => {
    const items = NURSING_ASSESSMENTS
      .filter((a) => rows[a.id]?.checked)
      .map((a) => ({ type: a.id, label: a.label, perDayMin: rows[a.id]?.perDayMin || 1 }));
    setSaving(true);
    try {
      await axios.put(`${API_ENDPOINTS.BASE}/nursing-assessment-plan`, { admissionId, uhid, ipdNo, items });
      toast.success(`Nursing plan saved — ${items.length} assessment${items.length === 1 ? "" : "s"} assigned to the nurse.`);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not save the nursing plan.");
    } finally { setSaving(false); }
  }, [rows, admissionId, uhid, ipdNo, onClose]);

  const selectedCount = NURSING_ASSESSMENTS.filter((a) => rows[a.id]?.checked).length;

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "7vh" }}>
      <div style={{ width: "min(620px,94vw)", maxHeight: "84vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 24px 60px rgba(2,6,23,.4)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #eef2f7", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>📝 Nursing Assessment Plan</div>
          <span style={{ fontSize: 11.5, color: "#64748b" }}>Choose what the nurse must assess & how many times/day</span>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", border: "none", background: "#f1f5f9", width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 14, color: "#475569" }}>✕</button>
        </div>

        <div style={{ padding: "12px 18px", overflow: "auto" }}>
          {loading ? <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Loading…</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {NURSING_ASSESSMENTS.map((a) => {
                const on = !!rows[a.id]?.checked;
                return (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: 9,
                    border: `1px solid ${on ? "#be185d55" : "#e2e8f0"}`, background: on ? "#fdf2f8" : "#fff" }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(a.id)} style={{ width: 17, height: 17, cursor: "pointer", accentColor: "#be185d" }} />
                    <span style={{ fontSize: 17, width: 22, textAlign: "center" }}>{a.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>{a.label}</div>
                      <div style={{ fontSize: 10.5, color: "#94a3b8" }}>NABH {a.nabh}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: on ? 1 : 0.4 }}>
                      <input type="number" min={1} max={96} value={rows[a.id]?.perDayMin || 1} disabled={!on}
                        onChange={(e) => setMin(a.id, e.target.value)}
                        style={{ width: 56, padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 13, textAlign: "center" }} />
                      <span style={{ fontSize: 11.5, color: "#64748b", whiteSpace: "nowrap" }}>×/day</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ padding: "12px 18px", borderTop: "1px solid #eef2f7", display: "flex", alignItems: "center", gap: 10, background: "#f8fafc" }}>
          <span style={{ fontSize: 12, color: "#475569" }}>{selectedCount} selected{assignedBy ? ` · last set by ${assignedBy}` : ""}</span>
          <button onClick={onClose} style={{ marginLeft: "auto", padding: "8px 16px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#475569" }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: "8px 18px", border: "none", background: "#be185d", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            {saving ? "Saving…" : "Save plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
