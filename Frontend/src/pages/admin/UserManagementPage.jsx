/**
 * UserManagementPage.jsx — admin page to create / edit / deactivate
 * staff accounts and manage digital signatures.
 *
 * Redesigned to the latest theme. Role colours and meta come from the
 * single source of truth (config/permissions.js). All inline styles
 * replaced with admin-theme primitives — KPI strip, Card, Table,
 * Modal, Field, etc.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { ROLES as ROLE_META } from "../../config/permissions";
import SignaturePad from "../../Components/signature/SignaturePad";
import {
  AdminPage, Hero, KPI, Card, Table, EmptyRow, RowAction, Badge,
  Modal, Field, SearchInput, PrimaryButton, SubCard, C,
} from "../../Components/admin-theme";

const ROLES = ROLE_META.map(r => r.key);
const META_BY_ROLE = ROLE_META.reduce((acc, r) => { acc[r.key] = r; return acc; }, {});

const EMPTY_FORM = {
  firstName: "", lastName: "", email: "", phone: "",
  role: "Nurse", employeeId: "", password: "",
  department: "", gender: "Male",
};

const fullNameOf = (u) => u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "—";

export default function UserManagementPage() {
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState("");
  const [roleFilter, setRoleF]  = useState("All");

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser]     = useState(null);
  const [pwdUser, setPwdUser]       = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [sigUser, setSigUser]       = useState(null);

  // Forms
  const [form, setForm]         = useState({ ...EMPTY_FORM });
  const [newPwd, setNewPwd]     = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [submitting, setSubmit] = useState(false);
  const [sigSaving, setSigSaving] = useState(false);

  /* ── Load ── */
  useEffect(() => { loadUsers(); }, []);
  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await axios.get(API_ENDPOINTS.USERS + "?limit=200");
      setUsers(res.data?.data || res.data || []);
    } catch { toast.error("Failed to load users"); }
    finally { setLoading(false); }
  };

  /* ── Derived ── */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(u => {
      const matchQ = !q
        || fullNameOf(u).toLowerCase().includes(q)
        || (u.email   || "").toLowerCase().includes(q)
        || (u.employeeId || "").toLowerCase().includes(q)
        || (u.phone   || "").includes(q);
      const matchR = roleFilter === "All" || u.role === roleFilter;
      return matchQ && matchR;
    });
  }, [users, search, roleFilter]);

  const kpis = useMemo(() => {
    const total = users.length;
    const active = users.filter(u => u.isActive !== false && u.status !== "Inactive").length;
    const withSig = users.filter(u => !!u.signature).length;
    const roleCount = new Set(users.map(u => u.role).filter(Boolean)).size;
    const recentLogins = users.filter(u => u.lastLogin && (Date.now() - new Date(u.lastLogin).getTime()) < 7 * 86400000).length;
    return { total, active, withSig, roleCount, recentLogins };
  }, [users]);

  const rolePills = useMemo(() => {
    const counts = ROLES.map(r => ({
      role: r,
      count: users.filter(u => u.role === r).length,
      meta: META_BY_ROLE[r],
    })).filter(p => p.count > 0);
    return counts.sort((a, b) => b.count - a.count);
  }, [users]);

  /* ── Handlers ── */
  const setF = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const handleCreate = async () => {
    if (!form.firstName || !form.email || !form.password || !form.role) {
      toast.warn("First name, email, role, and password are required"); return;
    }
    setSubmit(true);
    try {
      await axios.post(API_ENDPOINTS.USERS, form);
      toast.success(`User ${form.firstName} created`);
      setShowCreate(false); setForm({ ...EMPTY_FORM });
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || "Create failed");
    } finally { setSubmit(false); }
  };

  const handleUpdate = async () => {
    if (!editUser) return;
    setSubmit(true);
    try {
      await axios.put(`${API_ENDPOINTS.USERS}/${editUser._id}`, form);
      toast.success("User updated");
      setEditUser(null); setForm({ ...EMPTY_FORM });
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || "Update failed");
    } finally { setSubmit(false); }
  };

  const handleChangePassword = async () => {
    if (!newPwd || newPwd.length < 6) { toast.warn("Password must be at least 6 characters"); return; }
    setSubmit(true);
    try {
      await axios.put(`${API_ENDPOINTS.USERS}/${pwdUser._id}/reset-password`, { password: newPwd });
      toast.success(`Password updated for ${fullNameOf(pwdUser)}`);
      setPwdUser(null); setNewPwd("");
    } catch (err) {
      toast.error(err.response?.data?.message || "Password change failed");
    } finally { setSubmit(false); }
  };

  const handleSaveSignature = async (dataUrl) => {
    if (!sigUser) return;
    setSigSaving(true);
    try {
      await axios.patch(`${API_ENDPOINTS.USERS}/${sigUser._id}/signature`, { signature: dataUrl });
      setUsers(prev => prev.map(u => u._id === sigUser._id ? { ...u, signature: dataUrl } : u));
      toast.success(`Signature saved for ${fullNameOf(sigUser)}`);
      setSigUser(null);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to save signature");
    } finally { setSigSaving(false); }
  };

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

  const openEdit = (u) => {
    setForm({
      firstName: u.firstName || "", lastName: u.lastName || "",
      email: u.email || "", phone: u.phone || "",
      role: u.role || "Nurse", employeeId: u.employeeId || "",
      password: "", department: u.department || "",
      gender: u.gender || "Male",
    });
    setEditUser(u);
  };

  return (
    <AdminPage>
      <Hero icon="pi-users" color="blue"
        title="User Management"
        subtitle="Staff accounts, roles, passwords, digital signatures"
        right={<PrimaryButton icon="pi-user-plus" label="Add new user" color={C.blue}
          onClick={() => { setForm({ ...EMPTY_FORM }); setShowCreate(true); }} />} />

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Total users"     value={kpis.total}        color={C.blue}    icon="pi-users" />
        <KPI label="Active"          value={kpis.active}       color={C.green}   icon="pi-check-circle" />
        <KPI label="Digital signatures" value={kpis.withSig}   color={C.purple}  icon="pi-pen-to-square" />
        <KPI label="Distinct roles"  value={kpis.roleCount}    color={C.amber}   icon="pi-tag" />
        <KPI label="Logged in (7d)"  value={kpis.recentLogins} color={C.teal}    icon="pi-clock" />
      </div>

      {/* Role pill cloud — click to filter */}
      {rolePills.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          <RolePill label="All roles" count={users.length} active={roleFilter === "All"} onClick={() => setRoleF("All")} color={C.muted} light={C.subtle} />
          {rolePills.map(p => (
            <RolePill key={p.role} label={p.role} count={p.count}
              active={roleFilter === p.role}
              onClick={() => setRoleF(roleFilter === p.role ? "All" : p.role)}
              color={p.meta?.color || C.slate} light={p.meta?.light || C.subtle}
              icon={p.meta?.icon} />
          ))}
        </div>
      )}

      <Card title={`Staff Directory${roleFilter !== "All" ? ` · ${roleFilter}` : ""}`}
        color={C.blue} icon="pi-list"
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Name / email / employee ID / phone…" width={300} />
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{filtered.length} of {users.length}</span>
          </div>
        }
        padding={0}>
        <Table cols={["Employee ID", "Name", "Email / Phone", "Role", "Status / Signature", "Last login", "Action"]}>
          {loading
            ? <EmptyRow span={7} text="Loading users…" />
            : filtered.length === 0
              ? <EmptyRow span={7} text={search || roleFilter !== "All" ? "No users match these filters" : "No users yet — click Add new user to onboard staff."} />
              : filtered.map((u, i) => {
                const meta = META_BY_ROLE[u.role] || {};
                const name = fullNameOf(u);
                const initials = name.split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase() || "?";
                const active = u.isActive !== false && u.status !== "Inactive";
                return (
                  <tr key={u._id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff", opacity: active ? 1 : 0.6 }}>
                    <td style={{ padding: "9px 12px", fontFamily: "DM Mono, monospace", fontWeight: 700, color: C.blue }}>{u.employeeId || "—"}</td>
                    <td style={{ padding: "9px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: "50%",
                          background: meta.light || C.subtle,
                          border: `1.5px solid ${(meta.color || C.muted)}40`,
                          color: meta.color || C.muted,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 800, fontSize: 11, flexShrink: 0,
                        }}>{initials}</div>
                        <div>
                          <div style={{ fontWeight: 700 }}>{name}</div>
                          <div style={{ fontSize: 10.5, color: C.muted }}>{u.gender || "—"}{u.dateOfBirth ? ` · DOB ${new Date(u.dateOfBirth).toLocaleDateString("en-IN")}` : ""}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      <div style={{ fontSize: 11.5 }}>{u.email || "—"}</div>
                      <div style={{ fontSize: 10.5, color: C.muted, fontFamily: "DM Mono, monospace" }}>{u.phone || "—"}</div>
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      <span style={{
                        padding: "2px 9px", borderRadius: 4,
                        background: meta.light || C.subtle, color: meta.color || C.muted,
                        border: `1px solid ${(meta.color || C.muted)}30`,
                        fontSize: 10, fontWeight: 800, letterSpacing: ".3px",
                        display: "inline-flex", alignItems: "center", gap: 5,
                      }}>
                        {meta.icon && <i className={`pi ${meta.icon}`} style={{ fontSize: 10 }} />}
                        {u.role || "—"}
                      </span>
                    </td>
                    <td style={{ padding: "9px 12px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <Badge value={active ? "Active" : "Inactive"} palette={active ? "active" : "inactive"} />
                        {u.signature
                          ? <span style={{ fontSize: 9.5, fontWeight: 700, color: C.purple, display: "inline-flex", alignItems: "center", gap: 3 }}>
                              <i className="pi pi-check-circle" style={{ fontSize: 9 }} /> Signature on file
                            </span>
                          : <span style={{ fontSize: 9.5, color: C.muted }}>
                              <i className="pi pi-minus-circle" style={{ fontSize: 9, marginRight: 3 }} /> No signature
                            </span>}
                      </div>
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: 11, color: C.muted, fontFamily: "DM Mono, monospace" }}>
                      {u.lastLogin
                        ? new Date(u.lastLogin).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) +
                          " " + new Date(u.lastLogin).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                        : "Never"}
                    </td>
                    <td style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>
                      <RowAction icon="pi-pencil"        label="Edit"     color={C.blue}   onClick={() => openEdit(u)} />
                      <RowAction icon="pi-lock"          label="Pass"     color={C.amber}  onClick={() => setPwdUser(u)} />
                      <RowAction icon="pi-pen-to-square" label="Sig"      color={C.purple} onClick={() => setSigUser(u)} />
                      <RowAction icon={active ? "pi-ban" : "pi-check-circle"}
                        label={active ? "Off" : "On"} color={active ? C.red : C.green}
                        onClick={() => setConfirmDel(u)} />
                    </td>
                  </tr>
                );
              })}
        </Table>
      </Card>

      {/* CREATE / EDIT */}
      {(showCreate || editUser) && (
        <Modal
          title={editUser ? `Edit · ${fullNameOf(editUser)}` : "Add new user"}
          icon={editUser ? "pi-pencil" : "pi-user-plus"}
          color={C.blue}
          onClose={() => { setShowCreate(false); setEditUser(null); setForm({ ...EMPTY_FORM }); }}
          onSubmit={editUser ? handleUpdate : handleCreate}
          submitting={submitting}
          submitLabel={editUser ? "Save changes" : "Create user"}
          size={680}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="First name" required>
              <input className="his-field" value={form.firstName} onChange={setF("firstName")} placeholder="First name" />
            </Field>
            <Field label="Last name">
              <input className="his-field" value={form.lastName} onChange={setF("lastName")} placeholder="Last name" />
            </Field>
            <Field label="Email" required>
              <input className="his-field" type="email" value={form.email} onChange={setF("email")} placeholder="staff@hospital.in" />
            </Field>
            <Field label="Phone" required>
              <input className="his-field" value={form.phone} onChange={setF("phone")} placeholder="10-digit mobile" />
            </Field>
            <Field label="Role" required>
              <select className="his-field" value={form.role} onChange={setF("role")}>
                {ROLES.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Employee ID">
              <input className="his-field" value={form.employeeId} onChange={setF("employeeId")} placeholder="Auto-generated if blank" />
            </Field>
            <Field label="Gender">
              <select className="his-field" value={form.gender} onChange={setF("gender")}>
                {["Male", "Female", "Other"].map(g => <option key={g}>{g}</option>)}
              </select>
            </Field>
            <Field label="Department">
              <input className="his-field" value={form.department} onChange={setF("department")} placeholder="Department name" />
            </Field>
          </div>

          {!editUser && (
            <div style={{ marginTop: 12 }}>
              <Field label="Password" required>
                <div style={{ position: "relative" }}>
                  <input className="his-field" type={showPwd ? "text" : "password"}
                    value={form.password} onChange={setF("password")}
                    placeholder="Min 6 characters" style={{ paddingRight: 36 }} />
                  <button type="button" onClick={() => setShowPwd(p => !p)}
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: C.muted }}>
                    <i className={`pi ${showPwd ? "pi-eye-slash" : "pi-eye"}`} />
                  </button>
                </div>
              </Field>
            </div>
          )}

          {editUser && (
            <div style={{ marginTop: 12, padding: "9px 12px", background: C.amberL, border: `1px solid ${C.amber}30`, borderRadius: 7, fontSize: 11.5, color: "#92400e", display: "flex", gap: 8 }}>
              <i className="pi pi-info-circle" />
              To change the password, click the orange <b>Pass</b> action on the user row instead.
            </div>
          )}
        </Modal>
      )}

      {/* CHANGE PASSWORD */}
      {pwdUser && (
        <Modal
          title={`Change password · ${fullNameOf(pwdUser)}`}
          icon="pi-lock"
          color={C.amber}
          onClose={() => { setPwdUser(null); setNewPwd(""); setShowPwd(false); }}
          onSubmit={handleChangePassword}
          submitting={submitting || newPwd.length < 6}
          submitLabel="Update password"
          size={520}
        >
          <SubCard title="User" icon="pi-user" color={C.muted}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <UserAvatar user={pwdUser} size={40} />
              <div>
                <div style={{ fontWeight: 700 }}>{fullNameOf(pwdUser)}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{pwdUser.email} · {pwdUser.role}</div>
              </div>
            </div>
          </SubCard>
          <div style={{ marginTop: 12 }}>
            <Field label="New password" required>
              <div style={{ position: "relative" }}>
                <input className="his-field" type={showPwd ? "text" : "password"}
                  value={newPwd} onChange={e => setNewPwd(e.target.value)}
                  placeholder="Enter new password (min 6 characters)"
                  style={{ paddingRight: 36 }} autoFocus />
                <button type="button" onClick={() => setShowPwd(p => !p)}
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: C.muted }}>
                  <i className={`pi ${showPwd ? "pi-eye-slash" : "pi-eye"}`} />
                </button>
              </div>
              {newPwd && newPwd.length < 6 && (
                <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>
                  <i className="pi pi-times-circle" style={{ marginRight: 4 }} />At least 6 characters required
                </div>
              )}
              {newPwd && newPwd.length >= 6 && (
                <div style={{ fontSize: 11, color: C.green, marginTop: 4 }}>
                  <i className="pi pi-check-circle" style={{ marginRight: 4 }} />Password length OK
                </div>
              )}
            </Field>
          </div>
          <div style={{ marginTop: 10, padding: "9px 12px", background: C.amberL, border: `1px solid ${C.amber}30`, borderRadius: 7, fontSize: 11.5, color: "#92400e" }}>
            <i className="pi pi-exclamation-triangle" style={{ marginRight: 6 }} />
            The user will need this new password on their next login. Share it securely.
          </div>
        </Modal>
      )}

      {/* CONFIRM (DE)ACTIVATE */}
      {confirmDel && (() => {
        const active = confirmDel.isActive !== false;
        return (
          <Modal
            title={active ? "Deactivate user?" : "Activate user?"}
            icon={active ? "pi-ban" : "pi-check-circle"}
            color={active ? C.red : C.green}
            onClose={() => setConfirmDel(null)}
            onSubmit={() => toggleStatus(confirmDel)}
            submitLabel={active ? "Yes, deactivate" : "Yes, activate"}
            size={460}
          >
            <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
              <UserAvatar user={confirmDel} size={56} center />
              <div style={{ fontWeight: 800, fontSize: 16, marginTop: 12 }}>{fullNameOf(confirmDel)}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                {active
                  ? "This user will no longer be able to log in. Their data is preserved."
                  : "This user will be able to log in again."}
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* SIGNATURE PAD overlay */}
      {sigUser && (
        <SignaturePad
          existing={sigUser.signature || null}
          userName={fullNameOf(sigUser)}
          onSave={handleSaveSignature}
          onCancel={() => setSigUser(null)}
        />
      )}
    </AdminPage>
  );
}

function UserAvatar({ user, size = 32, center = false }) {
  const meta = META_BY_ROLE[user.role] || {};
  const name = fullNameOf(user);
  const initials = name.split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase() || "?";
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: meta.light || C.subtle,
      border: `1.5px solid ${(meta.color || C.muted)}40`,
      color: meta.color || C.muted,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 800, fontSize: size / 2.6, flexShrink: 0,
      margin: center ? "0 auto" : undefined,
    }}>{initials}</div>
  );
}

function RolePill({ label, count, active, onClick, color, light, icon }) {
  return (
    <button onClick={onClick}
      style={{
        padding: "5px 12px", borderRadius: 999,
        border: `1.5px solid ${active ? color : (color + "30")}`,
        background: active ? light : "#fff",
        color, cursor: "pointer",
        fontSize: 11.5, fontWeight: 800, letterSpacing: ".2px",
        display: "inline-flex", alignItems: "center", gap: 6,
        boxShadow: active ? `0 1px 6px ${color}30` : "none",
        transition: "all .15s",
      }}>
      {icon && <i className={`pi ${icon}`} style={{ fontSize: 11 }} />}
      {label}
      <span style={{
        background: active ? color : color + "20", color: active ? "#fff" : color,
        fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 999, minWidth: 18, textAlign: "center",
      }}>{count}</span>
    </button>
  );
}
