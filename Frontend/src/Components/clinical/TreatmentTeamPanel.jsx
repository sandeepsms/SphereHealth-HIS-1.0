/**
 * TreatmentTeamPanel.jsx
 * NABH COP.1 — Multi-disciplinary Treatment Team & Consultation Management
 *
 * Rules:
 *   - Primary Consultant sees "Add Consultation" + can remove/complete any entry
 *   - Consulting doctor sees only their own "Update Notes" button
 *   - All doctors on the team can VIEW the full team
 *   - Non-team doctors cannot modify anything
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { departmentService } from "../../Services/departmentService";
import { doctorService } from "../../Services/doctors/doctorService";
import { confirm } from "../common/ConfirmDialog";

/* ── Design tokens ── */
const C = {
  card: "#ffffff", border: "#e2e6ea", text: "#1a1d23", muted: "#6b7280",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  green: "#16a34a", greenL: "#dcfce7",
  amber: "#d97706", amberL: "#fffbeb",
  red: "#dc2626", redL: "#fef2f2",
  blue: "#1e40af", blueL: "#eff6ff",
  teal: "#0d9488", tealL: "#f0fdfa",
  orange: "#ea580c", orangeL: "#fff7ed",
  slate: "#334155",
};
const FF = "'DM Sans', sans-serif";

/* ── Role color map ── */
const ROLE_COLORS = {
  "Primary Consultant":    { color: C.purple, bg: C.purpleL, icon: "pi-star-fill" },
  "Co-Consultant":         { color: C.blue,   bg: C.blueL,   icon: "pi-users" },
  "Consulting Specialist": { color: C.teal,   bg: C.tealL,   icon: "pi-user-edit" },
  "Physiotherapist":       { color: C.green,  bg: C.greenL,  icon: "pi-bolt" },
  "Dietician":             { color: C.orange, bg: C.orangeL, icon: "pi-apple" },
  "Other":                 { color: C.slate,  bg: "#f8fafc",  icon: "pi-user" },
};

const URGENCY_COLORS = {
  Routine:  { color: C.green,  bg: C.greenL  },
  Urgent:   { color: C.amber,  bg: C.amberL  },
  Emergent: { color: C.red,    bg: C.redL    },
};

const STATUS_COLORS = {
  Active:    { color: C.green,  bg: C.greenL  },
  Pending:   { color: C.amber,  bg: C.amberL  },
  Completed: { color: C.slate,  bg: "#f8fafc"  },
  Declined:  { color: C.red,    bg: C.redL    },
};

const ROLES = ["Co-Consultant", "Consulting Specialist", "Physiotherapist", "Dietician", "Other"];
const URGENCY_OPTS = ["Routine", "Urgent", "Emergent"];

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
function initials(name = "") {
  return name.split(" ").filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════ */
export default function TreatmentTeamPanel({ admissionId, patientName, UHID, refreshTrigger }) {
  const { user } = useAuth();

  const [team, setTeam] = useState(null);   // { primary, team[] }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* Add consultation modal state */
  const [showAdd, setShowAdd] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [addForm, setAddForm] = useState({
    departmentId: "", department: "",
    doctorId: "", doctorName: "", specialization: "",
    role: "Consulting Specialist", urgency: "Routine", reason: "",
  });
  const [adding, setAdding] = useState(false);

  /* Update notes modal state */
  const [notesModal, setNotesModal] = useState(null);  // { member }
  const [noteText, setNoteText] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  /* Status change */
  const [statusModal, setStatusModal] = useState(null);
  const [savingStatus, setSavingStatus] = useState(false);

  const userId = user?._id || user?.id || "";
  const userRole = user?.role || "";

  /* ── Load team — R7az-D4-HIGH-2: abort cleanup. Pre-fix a fast
       admission switch left late responses overwriting the new team. */
  const loadAbortRef = useRef(null);
  const loadTeam = useCallback(async () => {
    if (!admissionId) return;
    if (loadAbortRef.current) {
      try { loadAbortRef.current.abort(); } catch (_) { /* noop */ }
    }
    const ctrl = new AbortController();
    loadAbortRef.current = ctrl;
    setLoading(true); setError("");
    try {
      const res = await axios.get(`${API_ENDPOINTS.ADMISSIONS}/${admissionId}/consultation`, { signal: ctrl.signal });
      if (!ctrl.signal.aborted) setTeam(res.data.data);
    } catch (e) {
      if (axios.isCancel?.(e) || ctrl.signal.aborted) return;
      setError(e?.response?.data?.message || "Could not load treatment team");
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [admissionId]);

  useEffect(() => { loadTeam(); }, [loadTeam, refreshTrigger]);
  // R7az-D4-HIGH-2: cleanup on unmount.
  useEffect(() => () => {
    if (loadAbortRef.current) {
      try { loadAbortRef.current.abort(); } catch (_) { /* noop */ }
    }
  }, []);

  /* ── Load departments for add form ── */
  useEffect(() => {
    if (!showAdd) return;
    (async () => {
      try {
        const res = await departmentService.getActiveDepartments();
        const list = res.data || res || [];
        setDepartments((Array.isArray(list) ? list : []).map(d => ({ id: d._id, name: d.departmentName })));
      } catch { /* silent */ }
    })();
  }, [showAdd]);

  const loadDoctors = async (deptId) => {
    if (!deptId) { setDoctors([]); return; }
    setLoadingDoctors(true);
    try {
      const res = await doctorService.getDoctorsByDepartment(deptId);
      const list = res.data?.data || res.data || res || [];
      setDoctors((Array.isArray(list) ? list : []).map(d => ({
        id: d._id,
        name: `Dr. ${d.personalInfo?.firstName || ""} ${d.personalInfo?.lastName || ""}`.trim(),
        specialization: d.professionalInfo?.specialization || d.specialization || "",
        department: d.department?.departmentName || "",
      })));
    } catch { setDoctors([]); } finally { setLoadingDoctors(false); }
  };

  const onDeptChange = (deptId) => {
    const dept = departments.find(d => d.id === deptId);
    setAddForm(f => ({ ...f, departmentId: deptId, department: dept?.name || "", doctorId: "", doctorName: "", specialization: "" }));
    loadDoctors(deptId);
  };

  const onDoctorChange = (docId) => {
    const doc = doctors.find(d => d.id === docId);
    setAddForm(f => ({ ...f, doctorId: docId, doctorName: doc?.name || "", specialization: doc?.specialization || "" }));
  };

  /* ── Access logic ── */
  const isPrimary = team?.primary?.doctorId?.toString() === userId || userRole === "Admin";
  const myConsultEntry = team?.team?.find(m => m.doctorId?.toString() === userId);
  const isOnTeam = isPrimary || !!myConsultEntry;

  /* ── Add consultation ── */
  const submitAdd = async () => {
    if (!addForm.doctorName.trim()) return;
    if (!addForm.reason.trim()) return;
    setAdding(true);
    try {
      await axios.post(`${API_ENDPOINTS.ADMISSIONS}/${admissionId}/consultation`, {
        doctorId: addForm.doctorId || undefined,
        doctorName: addForm.doctorName,
        department: addForm.department,
        departmentId: addForm.departmentId || undefined,
        specialization: addForm.specialization,
        role: addForm.role,
        urgency: addForm.urgency,
        reason: addForm.reason,
      });
      setShowAdd(false);
      setAddForm({ departmentId: "", department: "", doctorId: "", doctorName: "", specialization: "", role: "Consulting Specialist", urgency: "Routine", reason: "" });
      loadTeam();
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to add consultation");
    } finally { setAdding(false); }
  };

  /* ── Save notes ── */
  const saveNotes = async () => {
    if (!notesModal) return;
    setSavingNotes(true);
    try {
      await axios.put(`${API_ENDPOINTS.ADMISSIONS}/${admissionId}/consultation/${notesModal._id}`, {
        consultationNotes: noteText,
      });
      setNotesModal(null); setNoteText("");
      loadTeam();
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to save notes");
    } finally { setSavingNotes(false); }
  };

  /* ── Change status ── */
  const changeStatus = async (consultId, newStatus) => {
    setSavingStatus(true);
    try {
      await axios.put(`${API_ENDPOINTS.ADMISSIONS}/${admissionId}/consultation/${consultId}`, { status: newStatus });
      setStatusModal(null);
      loadTeam();
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to update status");
    } finally { setSavingStatus(false); }
  };

  /* ── Remove consultant ── */
  const removeConsultant = async (consultId, name) => {
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Remove from treatment team?",
      body: `${name} will be removed from this admission's multi-disciplinary team and will no longer see this patient in their worklist.`,
      danger: true,
      confirmLabel: "Remove",
    }))) return;
    try {
      await axios.delete(`${API_ENDPOINTS.ADMISSIONS}/${admissionId}/consultation/${consultId}`);
      loadTeam();
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to remove consultant");
    }
  };

  /* ════════════ RENDER ════════════ */
  if (!admissionId) return null;

  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.purple}25`,
      borderRadius: 14, overflow: "hidden",
      boxShadow: "0 2px 12px rgba(0,0,0,.05)", marginBottom: 14,
      fontFamily: FF,
    }}>

      {/* ── Header ── */}
      <div style={{
        padding: "12px 18px",
        background: C.purple + "08",
        borderBottom: `1px solid ${C.purple}18`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 30, height: 30, borderRadius: 8, background: C.purple + "20",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="pi pi-users" style={{ fontSize: 14, color: C.purple }} />
          </span>
          <div>
            <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Treatment Team</span>
            <span style={{
              marginLeft: 8, background: "#f0fdf4", color: C.green,
              border: "1px solid #bbf7d0", fontSize: 9, fontWeight: 700,
              padding: "1px 7px", borderRadius: 4, letterSpacing: ".8px",
            }}>NABH COP.1</span>
          </div>
          {team && (
            <span style={{
              background: C.purple + "15", color: C.purple,
              border: `1px solid ${C.purple}30`,
              fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
            }}>
              {1 + (team.team?.length || 0)} member{(team.team?.length || 0) > 0 ? "s" : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {isPrimary && !showAdd && (
            <button
              onClick={() => setShowAdd(true)}
              style={{
                background: C.purple, color: "#fff", border: "none",
                borderRadius: 8, padding: "7px 14px", cursor: "pointer",
                fontFamily: FF, fontWeight: 700, fontSize: 12,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <i className="pi pi-plus" style={{ fontSize: 11 }} />
              Add Consultation
            </button>
          )}
          <button onClick={loadTeam} style={{
            background: "none", border: `1px solid ${C.border}`,
            borderRadius: 7, padding: "6px 10px", cursor: "pointer", color: C.muted,
          }} title="Refresh">
            <i className="pi pi-refresh" style={{ fontSize: 11 }} />
          </button>
        </div>
      </div>

      <div style={{ padding: "16px 18px" }}>

        {/* ── Error ── */}
        {error && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8,
            padding: "8px 12px", marginBottom: 12, color: C.red, fontSize: 12,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <i className="pi pi-exclamation-circle" />
            {error}
            <button onClick={() => setError("")} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: C.red }}>×</button>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div style={{ textAlign: "center", padding: "24px 0", color: C.muted }}>
            <i className="pi pi-spin pi-spinner" style={{ fontSize: 22, color: C.purple }} />
            <div style={{ marginTop: 8, fontSize: 12 }}>Loading treatment team…</div>
          </div>
        )}

        {/* ── Add Consultation Form ── */}
        {showAdd && isPrimary && (
          <div style={{
            background: C.purpleL, border: `1.5px solid ${C.purple}30`,
            borderRadius: 12, padding: "16px", marginBottom: 16,
          }}>
            <div style={{ fontWeight: 700, color: C.purple, fontSize: 13, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <i className="pi pi-user-plus" style={{ fontSize: 13 }} />
              Request Consultation — {patientName || "Patient"} ({UHID})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", display: "block", marginBottom: 4 }}>
                  Department *
                </label>
                <select value={addForm.departmentId} onChange={e => onDeptChange(e.target.value)} className="his-select">
                  <option value="">Select department…</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", display: "block", marginBottom: 4 }}>
                  Consultant *
                </label>
                <select value={addForm.doctorId} onChange={e => onDoctorChange(e.target.value)} className="his-select"
                  disabled={!addForm.departmentId || loadingDoctors}>
                  <option value="">
                    {loadingDoctors ? "Loading…" : !addForm.departmentId ? "Select dept first…" : "Select doctor…"}
                  </option>
                  {doctors.map(d => <option key={d.id} value={d.id}>{d.name}{d.specialization ? ` (${d.specialization})` : ""}</option>)}
                </select>
                {/* Manual name if doctor not in system */}
                {addForm.departmentId && doctors.length === 0 && !loadingDoctors && (
                  <input
                    value={addForm.doctorName}
                    onChange={e => setAddForm(f => ({ ...f, doctorName: e.target.value }))}
                    placeholder="Type doctor name manually"
                    className="his-field" style={{ marginTop: 6 }}
                  />
                )}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", display: "block", marginBottom: 4 }}>Role</label>
                <select value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))} className="his-select">
                  {ROLES.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", display: "block", marginBottom: 4 }}>Urgency</label>
                <select value={addForm.urgency} onChange={e => setAddForm(f => ({ ...f, urgency: e.target.value }))} className="his-select">
                  {URGENCY_OPTS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", display: "block", marginBottom: 4 }}>Specialization</label>
                <input value={addForm.specialization} onChange={e => setAddForm(f => ({ ...f, specialization: e.target.value }))}
                  placeholder="e.g. Cardiology" className="his-field" />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", display: "block", marginBottom: 4 }}>
                Reason for Consultation *
              </label>
              <textarea
                value={addForm.reason}
                onChange={e => setAddForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="Clinical reason for requesting this consultation… (e.g. Uncontrolled diabetes requiring Endocrinology review)"
                rows={2} className="his-textarea"
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setShowAdd(false); setError(""); }} style={{
                background: "none", border: `1.5px solid ${C.border}`, borderRadius: 8,
                padding: "7px 16px", cursor: "pointer", fontFamily: FF, fontWeight: 600, fontSize: 12, color: C.muted,
              }}>Cancel</button>
              <button
                onClick={submitAdd}
                disabled={adding || !addForm.doctorName || !addForm.reason}
                style={{
                  background: adding || !addForm.doctorName || !addForm.reason ? "#94a3b8" : C.purple,
                  color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px",
                  cursor: adding ? "wait" : "pointer", fontFamily: FF, fontWeight: 700, fontSize: 12,
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                <i className={`pi ${adding ? "pi-spin pi-spinner" : "pi-check"}`} style={{ fontSize: 11 }} />
                {adding ? "Adding…" : "Add to Team"}
              </button>
            </div>
          </div>
        )}

        {/* ── Team Members ── */}
        {team && !loading && (
          <div>
            {/* Primary Consultant */}
            <TeamMemberCard
              member={{
                ...team.primary, _id: "primary",
                role: "Primary Consultant", status: "Active", isPrimary: true,
              }}
              isPrimaryView={isPrimary}
              isMe={team.primary?.doctorId?.toString() === userId}
              canAddNotes={false}
              canChangeStatus={false}
              canRemove={false}
              C={C} FF={FF}
            />

            {/* Consulting team */}
            {(team.team || []).map(member => {
              const isThisMe = member.doctorId?.toString() === userId;
              return (
                <TeamMemberCard
                  key={member._id}
                  member={member}
                  isPrimaryView={isPrimary}
                  isMe={isThisMe}
                  canAddNotes={isThisMe || isPrimary}
                  canChangeStatus={isPrimary}
                  canRemove={isPrimary}
                  onAddNotes={() => { setNotesModal(member); setNoteText(member.consultationNotes || ""); }}
                  onChangeStatus={(status) => changeStatus(member._id, status)}
                  onRemove={() => removeConsultant(member._id, member.doctorName)}
                  C={C} FF={FF}
                />
              );
            })}

            {team.team?.length === 0 && (
              <div style={{
                textAlign: "center", padding: "20px 0", color: C.muted, fontSize: 12,
                borderTop: `1px dashed ${C.border}`, marginTop: 4,
              }}>
                <i className="pi pi-users" style={{ fontSize: 18, display: "block", marginBottom: 6, opacity: .4 }} />
                No additional consultants yet.
                {isPrimary && <span> Click <strong>Add Consultation</strong> to appoint a specialist.</span>}
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Notes Modal ── */}
      {notesModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999, padding: 20,
        }} onClick={e => e.target === e.currentTarget && setNotesModal(null)}>
          <div style={{
            background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560,
            boxShadow: "0 20px 60px rgba(0,0,0,.25)", overflow: "hidden",
          }}>
            <div style={{ background: C.purple, padding: "16px 20px", color: "#fff" }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                {notesModal.doctorName} — Consultation Notes
              </div>
              <div style={{ fontSize: 12, opacity: .8, marginTop: 2 }}>
                {notesModal.department} · {notesModal.role} · Reason: {notesModal.reason}
              </div>
            </div>
            <div style={{ padding: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", display: "block", marginBottom: 6 }}>
                Consultation Findings / Recommendations
              </label>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                rows={6}
                placeholder="Document your clinical findings, assessment, and recommendations for the primary team…"
                className="his-textarea" style={{ minHeight: 140 }}
                autoFocus
              />
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
                <button onClick={() => setNotesModal(null)} style={{
                  background: "none", border: `1.5px solid ${C.border}`,
                  borderRadius: 8, padding: "8px 18px", cursor: "pointer",
                  fontFamily: FF, fontWeight: 600, fontSize: 12, color: C.muted,
                }}>Cancel</button>
                <button onClick={saveNotes} disabled={savingNotes} style={{
                  background: savingNotes ? "#94a3b8" : C.purple,
                  color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px",
                  cursor: "pointer", fontFamily: FF, fontWeight: 700, fontSize: 12,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <i className={`pi ${savingNotes ? "pi-spin pi-spinner" : "pi-check"}`} style={{ fontSize: 11 }} />
                  {savingNotes ? "Saving…" : "Save Notes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TEAM MEMBER CARD
══════════════════════════════════════════════════════════════ */
function TeamMemberCard({
  member, isPrimaryView, isMe, canAddNotes, canChangeStatus, canRemove,
  onAddNotes, onChangeStatus, onRemove, C, FF,
}) {
  const rc  = ROLE_COLORS[member.role] || ROLE_COLORS.Other;
  const uc  = URGENCY_COLORS[member.urgency] || URGENCY_COLORS.Routine;
  const sc  = STATUS_COLORS[member.status] || STATUS_COLORS.Active;
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  return (
    <div style={{
      border: `1.5px solid ${member.isPrimary ? rc.color + "40" : C.border}`,
      borderRadius: 12, marginBottom: 10, overflow: "hidden",
      background: isMe ? rc.bg + "60" : "#fafafa",
      boxShadow: isMe ? `0 2px 8px ${rc.color}15` : "none",
    }}>
      <div style={{
        padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 14,
        background: member.isPrimary ? rc.color + "08" : "transparent",
        borderBottom: `1px solid ${C.border}`,
      }}>
        {/* Avatar */}
        <div style={{
          width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
          background: `linear-gradient(135deg, ${rc.color}, ${rc.color}bb)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 800, color: "#fff",
          border: isMe ? `3px solid ${rc.color}` : `2px solid ${rc.color}30`,
          boxShadow: isMe ? `0 0 0 3px ${rc.color}20` : "none",
        }}>{initials(member.doctorName)}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", fontFamily: FF }}>
              {member.doctorName}
            </span>
            {isMe && (
              <span style={{
                background: rc.color, color: "#fff",
                fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 10, letterSpacing: 1,
              }}>YOU</span>
            )}
            <span style={{
              background: rc.bg, color: rc.color, border: `1px solid ${rc.color}30`,
              fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
              display: "flex", alignItems: "center", gap: 4,
            }}>
              <i className={`pi ${rc.icon}`} style={{ fontSize: 9 }} />
              {member.role}
            </span>
            {member.isPrimary && (
              <span style={{
                background: "#f0fdf4", color: C.green, border: "1px solid #bbf7d0",
                fontSize: 9, fontWeight: 700, padding: "1px 7px", borderRadius: 4, letterSpacing: .8,
              }}>NABH COP.1</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 3, fontFamily: FF }}>
            {member.department && <span>{member.department}</span>}
            {member.specialization && <span> · {member.specialization}</span>}
            {member.addedAt && !member.isPrimary && (
              <span> · Added {fmtDate(member.addedAt)}</span>
            )}
          </div>
        </div>

        {/* Status + urgency badges */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          {!member.isPrimary && (
            <>
              <span style={{
                background: sc.bg, color: sc.color, border: `1px solid ${sc.color}30`,
                fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: 10,
              }}>{member.status}</span>
              <span style={{
                background: uc.bg, color: uc.color, border: `1px solid ${uc.color}30`,
                fontSize: 9, fontWeight: 700, padding: "1px 7px", borderRadius: 10, letterSpacing: .5,
              }}>{member.urgency}</span>
            </>
          )}
        </div>

        {/* Actions */}
        {!member.isPrimary && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", position: "relative" }}>
            {canAddNotes && (
              <button onClick={onAddNotes} style={{
                background: rc.bg, color: rc.color,
                border: `1px solid ${rc.color}30`, borderRadius: 7,
                padding: "5px 10px", cursor: "pointer", fontFamily: FF,
                fontWeight: 700, fontSize: 11,
                display: "flex", alignItems: "center", gap: 5,
              }}>
                <i className="pi pi-pencil" style={{ fontSize: 10 }} />
                {member.consultationNotes ? "Edit Notes" : "Add Notes"}
              </button>
            )}
            {canChangeStatus && (
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowStatusMenu(s => !s)} style={{
                  background: "#f8fafc", border: `1px solid ${C.border}`,
                  borderRadius: 7, padding: "5px 8px", cursor: "pointer", color: C.muted,
                }} title="Change status">
                  <i className="pi pi-ellipsis-v" style={{ fontSize: 11 }} />
                </button>
                {showStatusMenu && (
                  <div style={{
                    position: "absolute", right: 0, top: "100%", marginTop: 4,
                    background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8,
                    boxShadow: "0 4px 16px rgba(0,0,0,.12)", zIndex: 999, minWidth: 140,
                    overflow: "hidden",
                  }}>
                    {["Active", "Completed", "Declined"].map(s => (
                      <button key={s} onClick={() => { onChangeStatus(s); setShowStatusMenu(false); }} style={{
                        width: "100%", padding: "8px 14px", background: "none",
                        border: "none", cursor: "pointer", textAlign: "left",
                        fontFamily: FF, fontSize: 12, color: C.text,
                        borderBottom: "1px solid #f1f5f9",
                        display: "flex", alignItems: "center", gap: 8,
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                        onMouseLeave={e => e.currentTarget.style.background = "none"}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS[s]?.color, flexShrink: 0 }} />
                        Mark {s}
                      </button>
                    ))}
                    {canRemove && (
                      <button onClick={() => { onRemove(); setShowStatusMenu(false); }} style={{
                        width: "100%", padding: "8px 14px", background: "none",
                        border: "none", cursor: "pointer", textAlign: "left",
                        fontFamily: FF, fontSize: 12, color: C.red,
                        display: "flex", alignItems: "center", gap: 8,
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = "#fef2f2"}
                        onMouseLeave={e => e.currentTarget.style.background = "none"}
                      >
                        <i className="pi pi-times" style={{ fontSize: 10 }} />
                        Remove from Team
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reason / Notes body */}
      {!member.isPrimary && (member.reason || member.consultationNotes) && (
        <div style={{ padding: "10px 16px", background: "#fff" }}>
          {member.reason && (
            <div style={{ marginBottom: member.consultationNotes ? 10 : 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: .6, marginBottom: 3 }}>
                <i className="pi pi-question-circle" style={{ marginRight: 4 }} />
                Reason for Consultation
              </div>
              <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{member.reason}</div>
            </div>
          )}
          {member.consultationNotes && (
            <div style={{
              background: rc.bg, border: `1px solid ${rc.color}20`,
              borderRadius: 8, padding: "10px 12px",
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: rc.color, textTransform: "uppercase", letterSpacing: .6, marginBottom: 4 }}>
                <i className="pi pi-file-edit" style={{ marginRight: 4 }} />
                Consultation Notes
                {member.notesUpdatedAt && (
                  <span style={{ fontWeight: 400, marginLeft: 6, color: C.muted }}>
                    — {fmtDate(member.notesUpdatedAt)}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: C.text, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{member.consultationNotes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
