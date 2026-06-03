/**
 * StatutoryComplianceRegisterPage.jsx — R7gw-B10-T07 / NABH AAC.16
 *
 * Statutory Compliance register. Compliance / Admin facing chronological
 * register of every statutory licence in force (Hospital, Pharmacy,
 * Blood-Bank, Fire-NOC, PCB-Consent, BMW-Authorisation, Atomic-Energy,
 * PNDT, CTL, PRA, Drug-Licence, Lift-Inspection) with issued / expiry /
 * renewal status + document pointer.
 *
 *   URL: /compliance/nabh-registers/statutory
 *
 * Layout:
 *   • KPIs (total active / expiring in 60d / expired / renewal pending)
 *   • Filter strip (q text + licenseType + renewalStatus + status +
 *     expiringWithinDays + date range)
 *   • Add-Entry modal: licenceType / licenceNo / issuedBy / issuedDate /
 *     expiryDate / renewalAppliedDate / renewalStatus / documentPath / notes
 *   • Table: licenceType / licenceNo / issuedBy / issuedDate / expiryDate /
 *     daysToExpiry (computed) / renewalStatus / status
 *
 * Role-gated: Admin / ComplianceOfficer (writes); reads also allow MRD.
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
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  }) : "—";

const todayISO = () => new Date().toISOString().slice(0, 10);

const LICENSE_TYPES = [
  "Hospital",
  "Pharmacy",
  "BloodBank",
  "Fire-NOC",
  "PCB-Consent",
  "BMW-Authorization",
  "Atomic-Energy",
  "PNDT",
  "CTL",
  "PRA",
  "Drug-License",
  "Lift-Inspection",
];

const RENEWAL_STATUSES = ["NotStarted", "Pending", "Approved", "Rejected"];
const STATUSES = ["Active", "Expired", "Superseded", "Closed"];

const EMPTY_FORM = {
  licenseType: "Hospital",
  licenseNo: "",
  issuedBy: "",
  issuedDate: todayISO(),
  expiryDate: "",
  renewalAppliedDate: "",
  renewalStatus: "NotStarted",
  documentPath: "",
  notes: "",
  status: "Active",
};

const daysToExpiry = (d) => {
  if (!d) return null;
  const ms = new Date(d).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
};

export default function StatutoryComplianceRegisterPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterLicenseType, setFilterLicenseType] = useState("");
  const [filterRenewalStatus, setFilterRenewalStatus] = useState("");
  const [expiringWithinDays, setExpiringWithinDays] = useState("");

  // Modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const canWrite = can ? can("compliance.nabh.write") : false;

  // ── Fetch list ────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterLicenseType) params.set("licenseType", filterLicenseType);
      if (filterRenewalStatus) params.set("renewalStatus", filterRenewalStatus);
      if (expiringWithinDays) params.set("expiringWithinDays", expiringWithinDays);
      if (q) params.set("q", q);
      params.set("limit", "300");
      const r = await axios.get(`${API}/nabh-registers/statutory?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load Statutory register");
    }
    setLoading(false);
  }, [filterStatus, filterLicenseType, filterRenewalStatus, expiringWithinDays, q]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── KPIs ──────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r) => r.status === "Active").length;
    let expiringSoon = 0;
    let expired = 0;
    let renewalPending = 0;
    rows.forEach((r) => {
      const d = daysToExpiry(r.expiryDate);
      if (d !== null && d < 0) expired += 1;
      else if (d !== null && d <= 60) expiringSoon += 1;
      if (r.renewalStatus === "Pending") renewalPending += 1;
    });
    return { total, active, expiringSoon, expired, renewalPending };
  }, [rows]);

  // ── Create row ────────────────────────────────────────────────
  const create = async () => {
    if (!form.licenseType || !form.licenseNo) {
      toast.warn("Licence type and licence number are required");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/nabh-registers/statutory`, {
        ...form,
        issuedDate: form.issuedDate ? new Date(form.issuedDate).toISOString() : null,
        expiryDate: form.expiryDate ? new Date(form.expiryDate).toISOString() : null,
        renewalAppliedDate: form.renewalAppliedDate ? new Date(form.renewalAppliedDate).toISOString() : null,
      }, authHdr());
      toast.success("Licence record saved");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to save");
    }
    setSaving(false);
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <AdminPage>
      <Hero
        icon="pi-id-card"
        color="blue"
        title="Statutory Compliance Register"
        subtitle="NABH AAC.16 — Living register of statutory licences (Hospital, Pharmacy, Blood-Bank, Fire-NOC, PCB, BMW, etc.) with issued / expiry / renewal status."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Total licences" value={kpis.total} color={C.blue} icon="pi-list" />
        <KPI label="Active" value={kpis.active} color={C.green} icon="pi-check-circle" />
        <KPI label="Expiring ≤60d" value={kpis.expiringSoon} color={C.orange || "#f59e0b"} icon="pi-clock" />
        <KPI label="Expired" value={kpis.expired} color={C.red} icon="pi-times-circle" />
        <KPI label="Renewal Pending" value={kpis.renewalPending} color={C.muted} icon="pi-hourglass" />
      </div>

      {/* ── Filter strip ─────────────────────────────────────── */}
      <Card title="Filters" color={C.blue} icon="pi-filter">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Search</label>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Licence no / issuer / notes…" />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Licence Type</label>
            <select value={filterLicenseType} onChange={(e) => setFilterLicenseType(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              {LICENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Renewal Status</label>
            <select value={filterRenewalStatus} onChange={(e) => setFilterRenewalStatus(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              {RENEWAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Expiring within (days)</label>
            <input type="number" value={expiringWithinDays} onChange={(e) => setExpiringWithinDays(e.target.value)}
              placeholder="e.g. 60"
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12, width: 110 }} />
          </div>
          {canWrite && (
            <div style={{ marginLeft: "auto" }}>
              <PrimaryButton label="+ Add Licence" icon="pi-plus" color={C.blue}
                onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }} />
            </div>
          )}
        </div>
      </Card>

      {/* ── Table ────────────────────────────────────────────── */}
      <Card title={`Statutory Compliance · ${rows.length} entries`} color={C.blue} icon="pi-list">
        {rows.length === 0 ? (
          <Empty icon="pi-inbox" text={loading ? "Loading…" : "No licences in this view. Add one with + Add Licence above."} />
        ) : (
          <Table cols={[
            { label: "Licence Type" },
            { label: "Licence No" },
            { label: "Issued By" },
            { label: "Issued" },
            { label: "Expiry" },
            { label: "Days to Expiry" },
            { label: "Renewal" },
            { label: "Status" },
            { label: "Doc" },
          ]}>
            {rows.map((r) => {
              const dExp = daysToExpiry(r.expiryDate);
              const expPalette = dExp === null ? "muted" : dExp < 0 ? "red" : dExp <= 60 ? "orange" : "green";
              return (
                <tr key={r._id}>
                  <td style={{ fontSize: 12, padding: "6px 8px" }}>
                    <Badge value={r.licenseType} palette="blue" />
                  </td>
                  <td style={{ fontSize: 12, padding: "6px 8px", fontFamily: "monospace" }}>{r.licenseNo || "—"}</td>
                  <td style={{ fontSize: 12, padding: "6px 8px" }}>{r.issuedBy || "—"}</td>
                  <td style={{ fontSize: 11.5, padding: "6px 8px" }}>{fmtDate(r.issuedDate)}</td>
                  <td style={{ fontSize: 11.5, padding: "6px 8px" }}>{fmtDate(r.expiryDate)}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {dExp === null ? <span style={{ color: C.muted }}>—</span> :
                      <Badge value={dExp < 0 ? `${Math.abs(dExp)}d ago` : `${dExp}d`} palette={expPalette} />}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Badge value={r.renewalStatus} palette={
                      r.renewalStatus === "Approved" ? "green" :
                      r.renewalStatus === "Pending" ? "orange" :
                      r.renewalStatus === "Rejected" ? "red" : "muted"
                    } />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Badge value={r.status} palette={
                      r.status === "Active" ? "green" :
                      r.status === "Expired" ? "red" : "muted"
                    } />
                  </td>
                  <td style={{ fontSize: 11, padding: "6px 8px", color: C.muted, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.documentPath ? <i className="pi pi-file" title={r.documentPath} /> : "—"}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {/* ── Add modal ─────────────────────────────────────────── */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}
          title="Add Statutory Licence"
          color={C.blue}
          icon="pi-id-card"
          onSubmit={create}
          submitting={saving}
          submitLabel="Save licence"
          size={680}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Licence Type" required>
              <select value={form.licenseType} onChange={(e) => setForm({ ...form, licenseType: e.target.value })}>
                {LICENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Licence No" required>
              <input value={form.licenseNo}
                onChange={(e) => setForm({ ...form, licenseNo: e.target.value })}
                placeholder="e.g. HOSP-2026-01234" />
            </Field>
            <Field label="Issued By">
              <input value={form.issuedBy} onChange={(e) => setForm({ ...form, issuedBy: e.target.value })}
                placeholder="State Health Authority / Fire Dept / PCB…" />
            </Field>
            <Field label="Issued Date">
              <input type="date" value={form.issuedDate}
                onChange={(e) => setForm({ ...form, issuedDate: e.target.value })} />
            </Field>
            <Field label="Expiry Date">
              <input type="date" value={form.expiryDate}
                onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
            </Field>
            <Field label="Renewal Applied Date">
              <input type="date" value={form.renewalAppliedDate}
                onChange={(e) => setForm({ ...form, renewalAppliedDate: e.target.value })} />
            </Field>
            <Field label="Renewal Status">
              <select value={form.renewalStatus} onChange={(e) => setForm({ ...form, renewalStatus: e.target.value })}>
                {RENEWAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Document Path">
                <input value={form.documentPath}
                  onChange={(e) => setForm({ ...form, documentPath: e.target.value })}
                  placeholder="/uploads/compliance/hospital-licence-2026.pdf" />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Notes">
                <textarea rows={2} value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="e.g. renewal application filed via online portal; awaiting inspection date" />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
