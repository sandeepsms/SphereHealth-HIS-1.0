/**
 * GateLogPage.jsx — Security workstation: log entries/exits at hospital gates.
 *
 * URL: /gate-log
 *
 * Layout:
 *   • 3 live KPIs (today in / out / approx on-premises delta)
 *   • Card with "+ Log entry" / "+ Log exit" buttons opening the same modal
 *   • Table of the most-recent 100 entries with type / gate / person / pass
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
  headers: { Authorization: `Bearer ${localStorage.getItem("his_token")}` },
});

const fmtDT = (d) =>
  d ? new Date(d).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  }) : "—";

const PERSON_TYPES = ["Visitor", "Patient", "Staff", "Vendor", "Ambulance", "Other"];
const GATES = ["Main", "Emergency", "Service", "Pharmacy", "Other"];
const ID_PROOFS = ["Aadhaar", "PAN", "Voter ID", "Driving License", "Passport", "Employee ID", "Other"];

const EMPTY_FORM = {
  direction: "in",
  gate: "Main",
  personType: "Visitor",
  personName: "",
  contactNumber: "",
  idProofType: "",
  idProofNumber: "",
  purpose: "",
  vehicleNumber: "",
  linkedPassNumber: "",
  notes: "",
};

export default function GateLogPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [filterDir, setFilterDir] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/gate-log/stats`, authHdr());
      setStats(r.data?.data || null);
    } catch { /* keep previous */ }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterDir) params.set("direction", filterDir);
      params.set("limit", "100");
      const r = await axios.get(`${API}/gate-log?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error("Failed to load gate log");
    }
    setLoading(false);
  }, [filterDir]);

  useEffect(() => {
    fetchStats();
    fetchList();
    const i = setInterval(() => { fetchStats(); fetchList(); }, 60000);
    return () => clearInterval(i);
  }, [fetchStats, fetchList]);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter((r) =>
      (r.personName || "").toLowerCase().includes(ql) ||
      (r.contactNumber || "").includes(ql) ||
      (r.vehicleNumber || "").toLowerCase().includes(ql) ||
      (r.linkedPassNumber || "").toLowerCase().includes(ql),
    );
  }, [rows, q]);

  const openFor = (direction) => {
    setForm({ ...EMPTY_FORM, direction });
    setModalOpen(true);
  };

  const submit = async () => {
    if (!form.personName?.trim()) {
      toast.warn("Person name is required");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/gate-log`, {
        ...form,
        recordedBy: user?.fullName || user?.firstName || "Security",
      }, authHdr());
      toast.success(`${form.direction === "in" ? "Entry" : "Exit"} logged`);
      setModalOpen(false);
      setForm(EMPTY_FORM);
      fetchStats(); fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to log gate event");
    }
    setSaving(false);
  };

  return (
    <AdminPage>
      <Hero icon="pi-shield" color="amber"
        title="Gate Log"
        subtitle="Every entry and exit, captured at the gate desk." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Today — In"     value={stats?.todayIn          ?? "—"} color={C.green}  icon="pi-sign-in" />
        <KPI label="Today — Out"    value={stats?.todayOut         ?? "—"} color={C.amber}  icon="pi-sign-out" />
        <KPI label="On premises ≈"  value={stats?.onPremisesDelta  ?? "—"} color={C.blue}   icon="pi-users" />
      </div>

      <Card title="Today's traffic" color={C.amber} icon="pi-id-card"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name / phone / vehicle…" />
            <select value={filterDir} onChange={(e) => setFilterDir(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              <option value="in">Entries only</option>
              <option value="out">Exits only</option>
            </select>
            <PrimaryButton label="+ Log Entry" icon="pi-sign-in"  color={C.green}  onClick={() => openFor("in")} />
            <PrimaryButton label="+ Log Exit"  icon="pi-sign-out" color={C.amber}  onClick={() => openFor("out")} />
          </div>
        }>
        {filtered.length === 0 ? (
          <Empty icon="pi-inbox" text={loading ? "Loading…" : "No gate events recorded yet."} />
        ) : (
          <Table cols={[
            { label: "Time" }, { label: "Direction" }, { label: "Gate" },
            { label: "Person" }, { label: "Type" }, { label: "Contact / ID" },
            { label: "Purpose / Pass" }, { label: "By" },
          ]}>
            {filtered.map((r) => (
              <tr key={r._id}>
                <td style={{ fontSize: 11.5, color: C.muted }}>{fmtDT(r.createdAt)}</td>
                <td>
                  <Badge value={r.direction === "in" ? "IN" : "OUT"}
                    color={r.direction === "in" ? C.green : C.amber} />
                </td>
                <td style={{ fontSize: 12 }}>{r.gate}</td>
                <td style={{ fontWeight: 700 }}>{r.personName}</td>
                <td style={{ fontSize: 11.5, color: C.muted }}>{r.personType}</td>
                <td style={{ fontSize: 11.5, color: C.muted }}>
                  {r.contactNumber || "—"}
                  {r.idProofType ? <span style={{ marginLeft: 6, fontStyle: "italic" }}>· {r.idProofType} {r.idProofNumber}</span> : null}
                </td>
                <td style={{ fontSize: 11.5 }}>
                  {r.linkedPassNumber
                    ? <Badge value={r.linkedPassNumber} color={C.purple} />
                    : (r.purpose || "—")}
                </td>
                <td style={{ fontSize: 11.5, color: C.muted }}>{r.recordedBy}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={`Log gate ${form.direction === "in" ? "entry" : "exit"}`}
        right={<PrimaryButton label={saving ? "Saving…" : "Save"} icon="pi-check" color={C.amber} onClick={submit} busy={saving} />}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Direction" required>
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              <option value="in">In</option><option value="out">Out</option>
            </select>
          </Field>
          <Field label="Gate" required>
            <select value={form.gate} onChange={(e) => setForm({ ...form, gate: e.target.value })}>
              {GATES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Person type">
            <select value={form.personType} onChange={(e) => setForm({ ...form, personType: e.target.value })}>
              {PERSON_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Name" required>
            <input value={form.personName} onChange={(e) => setForm({ ...form, personName: e.target.value })} />
          </Field>
          <Field label="Contact number">
            <input value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} />
          </Field>
          <Field label="Vehicle number">
            <input value={form.vehicleNumber} onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="ID proof type">
            <select value={form.idProofType} onChange={(e) => setForm({ ...form, idProofType: e.target.value })}>
              <option value="">—</option>
              {ID_PROOFS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="ID proof number">
            <input value={form.idProofNumber} onChange={(e) => setForm({ ...form, idProofNumber: e.target.value })} />
          </Field>
          <Field label="Visitor pass # (if any)">
            <input value={form.linkedPassNumber} onChange={(e) => setForm({ ...form, linkedPassNumber: e.target.value })} placeholder="VP-20260517-0001" />
          </Field>
          <Field label="Purpose">
            <input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Patient visit, delivery, OPD…" />
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Notes">
              <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>
    </AdminPage>
  );
}
