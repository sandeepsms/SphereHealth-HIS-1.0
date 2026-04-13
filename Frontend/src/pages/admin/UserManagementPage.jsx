import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { toast } from "react-toastify";

/* ── Design tokens ── */
const C = {
  bg: "#f0f2f5", card: "#fff", border: "#e2e6ea", text: "#1a1d23", muted: "#6b7280",
  accent: "#1e40af", accentL: "#eff6ff",
  green: "#16a34a", greenL: "#dcfce7",
  red: "#dc2626", redL: "#fef2f2",
  amber: "#d97706", amberL: "#fffbeb",
  teal: "#0d9488", tealL: "#f0fdfa",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  slate: "#1e293b",
};

const fld = {
  padding: "8px 11px", border: `1.5px solid ${C.border}`, borderRadius: 8,
  fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: C.text,
  outline: "none", background: "white", width: "100%", boxSizing: "border-box",
};

const ROLES = [
  "Admin", "Doctor", "Nurse", "Receptionist",
  "Pharmacist", "Lab Technician", "Dietician", "TPA Coordinator",
  "Radiologist", "Physiotherapist", "Accountant",
];

const ROLE_COLOR = {
  Admin:              { bg: "#fef2f2", color: C.red },
  Doctor:             { bg: C.purpleL, color: C.purple },
  Nurse:              { bg: "#fdf2f8", color: "#db2777" },
  Receptionist:       { bg: C.tealL,  color: C.teal },
  Pharmacist:         { bg: "#fff7ed", color: "#ea580c" },
  "Lab Technician":   { bg: C.accentL, color: C.accent },
  Dietician:          { bg: C.greenL, color: C.green },
  "TPA Coordinator":  { bg: C.amberL, color: C.amber },
};

const EMPTY_FORM = {
  firstName: "", lastName: "", email: "", phone: "",
  role: "Nurse", employeeId: "", password: "",
  department: "", gender: "Male",
};

/* ── Modal backdrop ── */
function Modal({ title, onClose, children }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000,
    }} onClick={onClose}>
      <div style={{ background: C.card, borderRadius: 16, width: "100%", maxWidth: 560,
        boxShadow: "0 24px 64px rgba(0,0,0,.28)", overflow: "hidden" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`,
          background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer",
            fontSize: 18, color: C.muted, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: "22px 24px", maxHeight: "75vh", overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ── Field row ── */
function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
        textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 5 }}>
        {label}{required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

/* ════════════════════════════════════════════════════ */
export default function UserManagementPage() {
  const [users, setUsers]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [roleFilter, setRoleFilter] = useState("All");

  /* ── Modals ── */
  const [showCreate, setShowCreate]   = useState(false);
  const [editUser, setEditUser]       = useState(null);    // user object for edit
  const [pwdUser, setPwdUser]         = useState(null);    // user object for password reset
  const [confirmDel, setConfirmDel]   = useState(null);    // user object for deactivate confirm

  /* ── Forms ── */
  const [form, setForm]         = useState({ ...EMPTY_FORM });
  const [newPwd, setNewPwd]     = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /* ── Load users ── */
  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await axios.get(API_ENDPOINTS.USERS + "?limit=200");
      setUsers(res.data?.data || res.data || []);
    } catch { toast.error("Failed to load users"); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadUsers(); }, []);

  /* ── Filtered users ── */
  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchQ = !q || (u.fullName || `${u.firstName} ${u.lastName}`).toLowerCase().includes(q)
      || u.email?.toLowerCase().includes(q)
      || u.employeeId?.toLowerCase().includes(q)
      || u.phone?.includes(q);
    const matchR = roleFilter === "All" || u.role === roleFilter;
    return matchQ && matchR;
  });

  /* ── Role counts ── */
  const roleCounts = ROLES.reduce((acc, r) => {
    acc[r] = users.filter(u => u.role === r).length;
    return acc;
  }, {});

  /* ── Create user ── */
  const handleCreate = async () => {
    if (!form.firstName || !form.email || !form.password || !form.role) {
      toast.warn("First name, email, role, and password are required"); return;
    }
    setSubmitting(true);
    try {
      await axios.post(API_ENDPOINTS.USERS, form);
      toast.success(`User ${form.firstName} created`);
      setShowCreate(false); setForm({ ...EMPTY_FORM });
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || "Create failed");
    } finally { setSubmitting(false); }
  };

  /* ── Update user ── */
  const handleUpdate = async () => {
    if (!editUser) return;
    setSubmitting(true);
    try {
      await axios.put(`${API_ENDPOINTS.USERS}/${editUser._id}`, form);
      toast.success("User updated");
      setEditUser(null); setForm({ ...EMPTY_FORM });
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || "Update failed");
    } finally { setSubmitting(false); }
  };

  /* ── Change password ── */
  const handleChangePassword = async () => {
    if (!newPwd || newPwd.length < 6) { toast.warn("Password must be at least 6 characters"); return; }
    setSubmitting(true);
    try {
      // Admin override: PUT the password field directly
      await axios.put(`${API_ENDPOINTS.USERS}/${pwdUser._id}`, { password: newPwd });
      toast.success(`Password updated for ${pwdUser.fullName || pwdUser.firstName}`);
      setPwdUser(null); setNewPwd("");
    } catch (err) {
      toast.error(err.response?.data?.message || "Password change failed");
    } finally { setSubmitting(false); }
  };

  /* ── Deactivate / Activate ── */
  const toggleStatus = async (u) => {
    try {
      const endpoint = u.isActive ? "deactivate" : "activate";
      await axios.put(`${API_ENDPOINTS.USERS}/${u._id}/${endpoint}`);
      toast.success(`User ${u.isActive ? "deactivated" : "activated"}`);
      setConfirmDel(null);
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || "Status change failed");
    }
  };

  /* ── Open edit modal ── */
  const openEdit = (u) => {
    setForm({
      firstName: u.firstName || "",
      lastName: u.lastName || "",
      email: u.email || "",
      phone: u.phone || "",
      role: u.role || "Nurse",
      employeeId: u.employeeId || "",
      password: "",
      department: u.department || "",
      gender: u.gender || "Male",
    });
    setEditUser(u);
  };

  const setF = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  /* ── Stats strip ── */
  const totalActive = users.filter(u => u.isActive !== false).length;

  return (
    <div style={{ maxWidth: 1300, margin: "0 auto" }}>

      {/* ── Page header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>User Management</div>
          <div style={{ fontSize: 12, color: C.muted }}>Admin panel — manage staff IDs, roles, and passwords</div>
        </div>
        <button onClick={() => { setForm({ ...EMPTY_FORM }); setShowCreate(true); }}
          style={{ padding: "10px 22px", border: "none", borderRadius: 9,
            background: C.accent, color: "white", cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 700,
            display: "flex", alignItems: "center", gap: 8,
            boxShadow: `0 4px 14px ${C.accent}40` }}>
          <i className="pi pi-user-plus" style={{ fontSize: 14 }} /> Add New User
        </button>
      </div>

      {/* ── Stats strip ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginBottom: 20 }}>
        <div style={{ background: C.accentL, border: `1.5px solid ${C.accent}20`, borderRadius: 10,
          padding: "12px 16px", gridColumn: "span 1" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".7px" }}>Total Active</div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 26, fontWeight: 800, color: C.accent }}>{totalActive}</div>
        </div>
        {Object.entries(roleCounts).filter(([, v]) => v > 0).map(([role, count]) => {
          const rc = ROLE_COLOR[role] || { bg: C.bg, color: C.muted };
          return (
            <div key={role} style={{ background: rc.bg, border: `1.5px solid ${rc.color}20`,
              borderRadius: 10, padding: "12px 16px", cursor: "pointer" }}
              onClick={() => setRoleFilter(role === roleFilter ? "All" : role)}>
              <div style={{ fontSize: 9, fontWeight: 700, color: rc.color,
                textTransform: "uppercase", letterSpacing: ".7px" }}>{role}</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 22, fontWeight: 800, color: rc.color }}>{count}</div>
            </div>
          );
        })}
      </div>

      {/* ── Search + filter ── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        overflow: "hidden", marginBottom: 0 }}>
        <div style={{ padding: "13px 20px", borderBottom: `1px solid ${C.border}`,
          background: "#f8fafc", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ position: "relative", flex: 1, maxWidth: 340 }}>
            <i className="pi pi-search" style={{ position: "absolute", left: 10, top: "50%",
              transform: "translateY(-50%)", fontSize: 13, color: C.muted }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, employee ID…"
              style={{ ...fld, paddingLeft: 32 }} />
          </div>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
            style={{ ...fld, maxWidth: 180 }}>
            <option value="All">All Roles</option>
            {ROLES.map(r => <option key={r}>{r}</option>)}
          </select>
          <span style={{ fontSize: 12, color: C.muted, marginLeft: "auto" }}>
            {filtered.length} of {users.length} users
          </span>
        </div>

        {/* ── Table ── */}
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: C.muted }}>
            <i className="pi pi-spin pi-spinner" style={{ fontSize: 22, display: "block", marginBottom: 10 }} />
            Loading users…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: C.muted }}>
            <i className="pi pi-users" style={{ fontSize: 32, display: "block", marginBottom: 10, color: "#cbd5e1" }} />
            No users found
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="his-table">
              <thead>
                <tr>
                  {["Employee ID", "Name", "Email / Phone", "Role", "Status", "Last Login", "Actions"].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const rc = ROLE_COLOR[u.role] || { bg: C.bg, color: C.muted };
                  const name = u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "—";
                  const active = u.isActive !== false && u.status !== "Inactive";
                  return (
                    <tr key={u._id} style={{ opacity: active ? 1 : 0.55 }}>
                      <td>
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12,
                          fontWeight: 600, color: C.accent }}>{u.employeeId || "—"}</span>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 32, height: 32, borderRadius: "50%",
                            background: rc.bg, border: `1.5px solid ${rc.color}30`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontWeight: 800, fontSize: 12, color: rc.color, flexShrink: 0 }}>
                            {name[0]?.toUpperCase() || "?"}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{name}</div>
                            <div style={{ fontSize: 11, color: C.muted }}>{u.gender || "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: 12, color: C.text }}>{u.email || "—"}</div>
                        <div style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono', monospace" }}>{u.phone || "—"}</div>
                      </td>
                      <td>
                        <span style={{ background: rc.bg, color: rc.color,
                          border: `1px solid ${rc.color}30`, padding: "2px 8px",
                          borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: ".6px" }}>
                          {u.role || "—"}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          background: active ? C.greenL : C.redL,
                          color: active ? C.green : C.red,
                          border: `1px solid ${active ? C.green : C.red}30`,
                          padding: "2px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700 }}>
                          {active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono', monospace" }}>
                        {u.lastLogin
                          ? new Date(u.lastLogin).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) +
                            " " + new Date(u.lastLogin).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                          : "Never"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 5 }}>
                          <button onClick={() => openEdit(u)}
                            title="Edit user details"
                            style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`,
                              background: "white", cursor: "pointer", fontSize: 11, fontWeight: 600, color: C.accent }}>
                            <i className="pi pi-pencil" style={{ fontSize: 10 }} />
                          </button>
                          <button onClick={() => setPwdUser(u)}
                            title="Change password"
                            style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.amber}40`,
                              background: C.amberL, cursor: "pointer", fontSize: 11, fontWeight: 600, color: C.amber }}>
                            <i className="pi pi-lock" style={{ fontSize: 10 }} />
                          </button>
                          <button onClick={() => setConfirmDel(u)}
                            title={active ? "Deactivate user" : "Activate user"}
                            style={{ padding: "4px 10px", borderRadius: 6,
                              border: `1px solid ${active ? C.red : C.green}40`,
                              background: active ? C.redL : C.greenL, cursor: "pointer",
                              fontSize: 11, fontWeight: 600,
                              color: active ? C.red : C.green }}>
                            <i className={`pi ${active ? "pi-ban" : "pi-check-circle"}`} style={{ fontSize: 10 }} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ════ CREATE USER MODAL ════ */}
      {(showCreate || editUser) && (
        <Modal
          title={editUser ? `Edit — ${editUser.fullName || editUser.firstName}` : "Add New User"}
          onClose={() => { setShowCreate(false); setEditUser(null); setForm({ ...EMPTY_FORM }); }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="First Name" required>
              <input value={form.firstName} onChange={setF("firstName")} placeholder="First name" style={fld} />
            </Field>
            <Field label="Last Name">
              <input value={form.lastName} onChange={setF("lastName")} placeholder="Last name" style={fld} />
            </Field>
            <Field label="Email" required>
              <input type="email" value={form.email} onChange={setF("email")}
                placeholder="staff@hospital.com" style={fld} />
            </Field>
            <Field label="Phone" required>
              <input value={form.phone} onChange={setF("phone")} placeholder="10-digit mobile" style={fld} />
            </Field>
            <Field label="Employee ID">
              <input value={form.employeeId} onChange={setF("employeeId")}
                placeholder="e.g. EMP001 (auto if blank)" style={fld} />
            </Field>
            <Field label="Gender">
              <select value={form.gender} onChange={setF("gender")} style={fld}>
                {["Male", "Female", "Other"].map(g => <option key={g}>{g}</option>)}
              </select>
            </Field>
            <Field label="Role" required>
              <select value={form.role} onChange={setF("role")} style={fld}>
                {ROLES.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Department">
              <input value={form.department} onChange={setF("department")}
                placeholder="Department name" style={fld} />
            </Field>
          </div>

          {!editUser && (
            <Field label="Password" required>
              <div style={{ position: "relative" }}>
                <input type={showPwd ? "text" : "password"} value={form.password}
                  onChange={setF("password")} placeholder="Minimum 6 characters"
                  style={{ ...fld, paddingRight: 36 }} />
                <button onClick={() => setShowPwd(p => !p)} type="button"
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", color: C.muted }}>
                  <i className={`pi ${showPwd ? "pi-eye-slash" : "pi-eye"}`} style={{ fontSize: 14 }} />
                </button>
              </div>
            </Field>
          )}

          {editUser && (
            <div style={{ background: C.amberL, border: `1px solid ${C.amber}30`, borderRadius: 8,
              padding: "10px 14px", marginBottom: 14, fontSize: 12, color: C.amber, display: "flex", gap: 8 }}>
              <i className="pi pi-info-circle" style={{ fontSize: 13, flexShrink: 0 }} />
              To change the password, use the <strong>lock icon</strong> on the user row instead.
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={() => { setShowCreate(false); setEditUser(null); setForm({ ...EMPTY_FORM }); }}
              style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                background: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                fontSize: 13, fontWeight: 600, color: C.muted }}>
              Cancel
            </button>
            <button onClick={editUser ? handleUpdate : handleCreate} disabled={submitting}
              style={{ padding: "9px 24px", border: "none", borderRadius: 8,
                background: submitting ? "#93c5fd" : C.accent, cursor: submitting ? "not-allowed" : "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white" }}>
              <i className={`pi ${editUser ? "pi-check" : "pi-user-plus"}`} style={{ marginRight: 6, fontSize: 12 }} />
              {submitting ? "Saving…" : editUser ? "Save Changes" : "Create User"}
            </button>
          </div>
        </Modal>
      )}

      {/* ════ CHANGE PASSWORD MODAL ════ */}
      {pwdUser && (
        <Modal title={`Change Password — ${pwdUser.fullName || pwdUser.firstName}`}
          onClose={() => { setPwdUser(null); setNewPwd(""); setShowPwd(false); }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20,
              background: C.bg, borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%",
                background: (ROLE_COLOR[pwdUser.role] || { bg: C.accentL }).bg,
                border: `2px solid ${(ROLE_COLOR[pwdUser.role] || { color: C.accent }).color}30`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: 16, color: (ROLE_COLOR[pwdUser.role] || { color: C.accent }).color }}>
                {(pwdUser.fullName || pwdUser.firstName || "?")[0]}
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>{pwdUser.fullName || `${pwdUser.firstName} ${pwdUser.lastName}`}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{pwdUser.email} · {pwdUser.role}</div>
              </div>
            </div>

            <Field label="New Password" required>
              <div style={{ position: "relative" }}>
                <input type={showPwd ? "text" : "password"} value={newPwd}
                  onChange={e => setNewPwd(e.target.value)}
                  placeholder="Enter new password (min 6 characters)"
                  style={{ ...fld, paddingRight: 36 }} autoFocus />
                <button onClick={() => setShowPwd(p => !p)} type="button"
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", color: C.muted }}>
                  <i className={`pi ${showPwd ? "pi-eye-slash" : "pi-eye"}`} style={{ fontSize: 14 }} />
                </button>
              </div>
              {newPwd && newPwd.length < 6 && (
                <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>
                  <i className="pi pi-times-circle" style={{ marginRight: 4, fontSize: 10 }} />
                  At least 6 characters required
                </div>
              )}
              {newPwd && newPwd.length >= 6 && (
                <div style={{ fontSize: 11, color: C.green, marginTop: 4 }}>
                  <i className="pi pi-check-circle" style={{ marginRight: 4, fontSize: 10 }} />
                  Password strength OK
                </div>
              )}
            </Field>
          </div>

          <div style={{ background: C.amberL, border: `1px solid ${C.amber}30`, borderRadius: 8,
            padding: "10px 14px", marginBottom: 18, fontSize: 12, color: "#92400e" }}>
            <i className="pi pi-exclamation-triangle" style={{ marginRight: 6, fontSize: 12 }} />
            The user will need to use this new password on their next login. Inform them securely.
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => { setPwdUser(null); setNewPwd(""); setShowPwd(false); }}
              style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                background: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                fontSize: 13, fontWeight: 600, color: C.muted }}>
              Cancel
            </button>
            <button onClick={handleChangePassword} disabled={submitting || newPwd.length < 6}
              style={{ padding: "9px 24px", border: "none", borderRadius: 8,
                background: submitting || newPwd.length < 6 ? "#fcd34d" : C.amber,
                cursor: submitting || newPwd.length < 6 ? "not-allowed" : "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "white" }}>
              <i className="pi pi-lock" style={{ marginRight: 6, fontSize: 12 }} />
              {submitting ? "Updating…" : "Update Password"}
            </button>
          </div>
        </Modal>
      )}

      {/* ════ CONFIRM DEACTIVATE MODAL ════ */}
      {confirmDel && (
        <Modal
          title={confirmDel.isActive !== false ? "Deactivate User?" : "Activate User?"}
          onClose={() => setConfirmDel(null)}>
          <div style={{ textAlign: "center", padding: "12px 0 20px" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", margin: "0 auto 14px",
              background: confirmDel.isActive !== false ? C.redL : C.greenL,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className={`pi ${confirmDel.isActive !== false ? "pi-ban" : "pi-check-circle"}`}
                style={{ fontSize: 26, color: confirmDel.isActive !== false ? C.red : C.green }} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.text, marginBottom: 8 }}>
              {confirmDel.fullName || confirmDel.firstName}
            </div>
            <div style={{ fontSize: 13, color: C.muted }}>
              {confirmDel.isActive !== false
                ? "This user will no longer be able to log in. Their data is preserved."
                : "This user will be able to log in again."}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setConfirmDel(null)}
              style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                background: "white", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                fontSize: 13, fontWeight: 600, color: C.muted }}>
              Cancel
            </button>
            <button onClick={() => toggleStatus(confirmDel)}
              style={{ padding: "9px 24px", border: "none", borderRadius: 8,
                background: confirmDel.isActive !== false ? C.red : C.green,
                cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                fontSize: 13, fontWeight: 700, color: "white" }}>
              {confirmDel.isActive !== false ? "Yes, Deactivate" : "Yes, Activate"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
