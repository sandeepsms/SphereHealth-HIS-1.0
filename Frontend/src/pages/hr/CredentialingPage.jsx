/**
 * CredentialingPage.jsx  (R7bf-G / A5-CRIT-6 / NABH HRD.3)
 *
 * Staff credentialing register — degrees / licences / privileges with
 * verification + expiry tracking.
 *
 *   URL: /credentials
 *
 * Layout:
 *   • 4 KPIs (pending / verified / expiring-90d / revoked)
 *   • "+ Add Credential" button
 *   • Table with staff / type / title / status / expiry
 *   • Per-row Verify + Revoke actions
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, KPI, Card, Table, Empty, Badge, Modal, Field,
  PrimaryButton, SearchInput, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";
import { API_BASE_URL as API } from "../../config/api";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${(sessionStorage.getItem("his_token") || localStorage.getItem("his_token"))}` },
});

const fmtD = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const TYPES = [
  "MBBS", "MD", "MS", "MCh", "DM",
  "PG_DIPLOMA", "FELLOWSHIP",
  "LICENCE", "BSc_NURSING", "GNM", "ANM",
  "DIPLOMA_PHARMACY", "BPHARM", "MPHARM",
  "DMLT", "BMLT", "MMLT",
  "BPT", "MPT",
  "OTHER",
];
const STATUSES = ["PENDING", "VERIFIED", "EXPIRED", "REVOKED"];
const STATUS_COLOR = { PENDING: "amber", VERIFIED: "green", EXPIRED: "red", REVOKED: "muted" };

const EMPTY_FORM = {
  userId: "",
  credentialType: "MBBS",
  title: "",
  institution: "",
  year: new Date().getFullYear(),
  registrationNumber: "",
  councilName: "",
  expiryDate: "",
  scopeOfPractice: "",
  privilegesGranted: "",
  documentUrl: "",
  notes: "",
};

export default function CredentialingPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      params.set("limit", "300");
      const r = await axios.get(`${API}/credentials?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load credentials");
    }
    setLoading(false);
  }, [filterStatus]);

  // Load users for the userId picker (Admin can manage everyone; non-admin
  // sees nothing in the picker because backend hr.credential.write is Admin-only).
  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/users?limit=300`, authHdr());
        setUsers(r.data?.data || r.data || []);
      } catch (_) { /* non-fatal */ }
    })();
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter((r) =>
      (r.userFullName || "").toLowerCase().includes(ql) ||
      (r.userEmployeeId || "").toLowerCase().includes(ql) ||
      (r.title || "").toLowerCase().includes(ql) ||
      (r.registrationNumber || "").toLowerCase().includes(ql),
    );
  }, [rows, q]);

  const kpis = useMemo(() => {
    const now = Date.now();
    return {
      pending: rows.filter((r) => r.status === "PENDING").length,
      verified: rows.filter((r) => r.status === "VERIFIED").length,
      expiring: rows.filter((r) =>
        r.status === "VERIFIED" && r.expiryDate &&
        new Date(r.expiryDate).getTime() - now < 90 * 86400000 &&
        new Date(r.expiryDate).getTime() > now,
      ).length,
      revoked: rows.filter((r) => r.status === "REVOKED").length,
    };
  }, [rows]);

  const create = async () => {
    if (!form.userId || !form.credentialType || !form.title.trim()) {
      toast.warn("User + type + title required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...form,
        scopeOfPractice: form.scopeOfPractice
          ? form.scopeOfPractice.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        privilegesGranted: form.privilegesGranted
          ? form.privilegesGranted.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      };
      await axios.post(`${API}/credentials`, body, authHdr());
      toast.success("Credential added (PENDING verification)");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to add");
    }
    setSaving(false);
  };

  const verify = async (row) => {
    if (!window.confirm(`Mark ${row.title} as VERIFIED?`)) return;
    try {
      await axios.put(`${API}/credentials/${row._id}/verify`, {}, authHdr());
      toast.success("Verified");
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to verify");
    }
  };

  const revoke = async (row) => {
    const reason = window.prompt("Revocation reason?");
    if (!reason) return;
    try {
      await axios.put(`${API}/credentials/${row._id}/revoke`, { reason }, authHdr());
      toast.success("Revoked");
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to revoke");
    }
  };

  return (
    <AdminPage>
      <Hero icon="pi-id-card" color="purple"
        title="Staff Credentialing"
        subtitle="NABH HRD.3 — degrees, registration numbers, scope of practice, privileges + expiry tracking." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Pending"          value={kpis.pending}  color={C.amber}  icon="pi-clock" />
        <KPI label="Verified"         value={kpis.verified} color={C.green}  icon="pi-check-circle" />
        <KPI label="Expiring (90d)"   value={kpis.expiring} color={C.red}    icon="pi-exclamation-triangle" />
        <KPI label="Revoked"          value={kpis.revoked}  color={C.muted}  icon="pi-ban" />
      </div>

      <Card title="Credential Register" color={C.purple} icon="pi-id-card"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name / EID / title / reg #…" />
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {can("hr.credential.write") && (
              <PrimaryButton label="+ Add Credential" icon="pi-plus" color={C.purple}
                onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }} />
            )}
          </div>
        }>
        {filtered.length === 0 ? (
          <Empty icon="pi-id-card" text={loading ? "Loading…" : "No credentials on file."} />
        ) : (
          <Table cols={[
            { label: "Staff" }, { label: "EID" }, { label: "Type" }, { label: "Title" },
            { label: "Reg #" }, { label: "Expiry" }, { label: "Status" }, { label: "Action" },
          ]}>
            {filtered.map((r) => (
              <tr key={r._id}>
                <td style={{ fontSize: 12 }}>{r.userFullName || "—"}</td>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.userEmployeeId || "—"}</td>
                <td style={{ fontSize: 11 }}>{r.credentialType}</td>
                <td style={{ fontSize: 11.5 }}>{r.title}</td>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.registrationNumber || "—"}</td>
                <td style={{ fontSize: 11.5 }}>{fmtD(r.expiryDate)}</td>
                <td><Badge value={r.status} palette={STATUS_COLOR[r.status] || "muted"} /></td>
                <td style={{ display: "flex", gap: 6 }}>
                  {can("hr.credential.write") && r.status === "PENDING" && (
                    <button onClick={() => verify(r)}
                      style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.green}`,
                        background: "#fff", color: C.green, fontSize: 11, cursor: "pointer" }}>
                      Verify
                    </button>
                  )}
                  {can("hr.credential.write") && r.status !== "REVOKED" && (
                    <button onClick={() => revoke(r)}
                      style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.red}`,
                        background: "#fff", color: C.red, fontSize: 11, cursor: "pointer" }}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}
          title="Add credential"
          color={C.purple}
          onSubmit={create}
          submitting={saving}
          submitLabel="Add"
          size={680}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Staff member" required>
              <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                <option value="">— Select user —</option>
                {users.map((u) => (
                  <option key={u._id} value={u._id}>
                    {(u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email)} — {u.role}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Credential type" required>
              <select value={form.credentialType} onChange={(e) => setForm({ ...form, credentialType: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Title" required>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. MBBS — KGMU 2012" />
            </Field>
            <Field label="Institution">
              <input value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
            </Field>
            <Field label="Year">
              <input type="number" value={form.year}
                onChange={(e) => setForm({ ...form, year: Number(e.target.value) || form.year })} />
            </Field>
            <Field label="Registration #">
              <input value={form.registrationNumber}
                onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })} />
            </Field>
            <Field label="Council">
              <input value={form.councilName}
                onChange={(e) => setForm({ ...form, councilName: e.target.value })}
                placeholder="NMC / MCI / State Pharmacy Council…" />
            </Field>
            <Field label="Expiry date">
              <input type="date" value={form.expiryDate}
                onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Scope of practice (comma-separated)">
                <input value={form.scopeOfPractice}
                  onChange={(e) => setForm({ ...form, scopeOfPractice: e.target.value })}
                  placeholder="General Medicine, Diabetology" />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Privileges granted (comma-separated)">
                <input value={form.privilegesGranted}
                  onChange={(e) => setForm({ ...form, privilegesGranted: e.target.value })}
                  placeholder="Admit IPD, Prescribe Schedule X, Sign discharge" />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Document URL">
                <input value={form.documentUrl}
                  onChange={(e) => setForm({ ...form, documentUrl: e.target.value })}
                  placeholder="https:// link to PDF / image" />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
