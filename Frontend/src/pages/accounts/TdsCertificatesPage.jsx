/**
 * TdsCertificatesPage.jsx  (R7bk — sidebar nav coverage)
 *
 * TDS Form 16A — preview + generate for a fiscal-year quarter.
 *
 *   URL: /tds
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, KPI, Card, Table, Empty, Badge,
  PrimaryButton, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";
import { API_BASE_URL as API } from "../../config/api";
import { toNum } from "../../utils/printUtils";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token") || ""}` },
});

// R7bm-F4 / R7bl-4-HIGH-2 — toNum() unwraps the Decimal128 wire shape
// (`{$numberDecimal:"…"}`). Bare `Number(field)` on that object returns
// NaN → 0, which was the root cause of the ₹0 KPI tiles on this page
// for any TDS row that arrived from a .lean() backend read.
const fmtINR = (n) =>
  toNum(n).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }) : "—";

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

const currentFY = () => {
  const d = new Date();
  const y = d.getFullYear();
  // Apr 1 is start of FY in India
  if (d.getMonth() >= 3) return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  return `${y - 1}-${String(y % 100).padStart(2, "0")}`;
};

export default function TdsCertificatesPage() {
  const { can } = useAuth();
  const [quarter, setQuarter] = useState("Q1");
  const [fy, setFy] = useState(currentFY());
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/tds/16a`, authHdr());
      setHistory(r.data?.data || []);
    } catch (e) { /* silent */ }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const doPreview = async () => {
    setLoading(true); setPreview(null);
    try {
      const r = await axios.get(`${API}/tds/16a/preview?quarter=${quarter}&fy=${fy}`, authHdr());
      setPreview(r.data?.data || null);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to preview");
    }
    setLoading(false);
  };

  const generate = async () => {
    if (!preview || !preview.parties || preview.parties.length === 0) {
      toast.warn("No TDS data for this quarter"); return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/tds/16a/generate`, { quarter, financialYear: fy }, authHdr());
      toast.success("Form 16A certificates generated (DRAFT)");
      fetchHistory();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to generate");
    }
    setSaving(false);
  };

  const totals = useMemo(() => {
    if (!preview?.parties) return null;
    // R7bm-F4 / R7bl-4-HIGH-2 — toNum() instead of Number(): tolerates
    // the `{$numberDecimal:"…"}` shape if any read path bypasses the
    // model's toJSON unwrap.
    return {
      partyCount: preview.parties.length,
      totalPaid: preview.parties.reduce((s, p) => s + toNum(p.totalAmountPaid), 0),
      totalTds: preview.parties.reduce((s, p) => s + toNum(p.totalTdsDeducted), 0),
    };
  }, [preview]);

  return (
    <AdminPage>
      <Hero icon="pi-percentage" color="amber"
        title="TDS Form 16A Certificates"
        subtitle="Income Tax §194J / §194O — quarterly TDS certificates for TPA payments." />

      <Card title="Quarter Selection" icon="pi-calendar">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 12, color: C.muted, display: "block" }}>Quarter</label>
            <select value={quarter} onChange={e => setQuarter(e.target.value)}>
              {QUARTERS.map(q => <option key={q}>{q}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.muted, display: "block" }}>FY (e.g. 2026-27)</label>
            <input value={fy} onChange={e => setFy(e.target.value)} placeholder="2026-27" style={{ width: 110 }} />
          </div>
          <PrimaryButton onClick={doPreview} disabled={loading}>{loading ? "Loading…" : "Preview"}</PrimaryButton>
          {preview && can("tax.tds.write") && (
            <PrimaryButton onClick={generate} disabled={saving}>{saving ? "…" : "Generate Certificates"}</PrimaryButton>
          )}
        </div>
      </Card>

      {totals && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14, marginTop: 14 }}>
          <KPI label="Parties" value={totals.partyCount} color={C.blue} icon="pi-users" />
          <KPI label="Total Paid" value={`₹${fmtINR(totals.totalPaid)}`} color={C.green} icon="pi-money-bill" />
          <KPI label="Total TDS" value={`₹${fmtINR(totals.totalTds)}`} color={C.amber} icon="pi-minus-circle" />
        </div>
      )}

      {preview?.parties && preview.parties.length > 0 && (
        <Card title={`TDS by Party — ${quarter} ${fy}`} icon="pi-table">
          <Table
            headers={["Party", "PAN", "GSTIN", "Amount Paid (₹)", "TDS Deducted (₹)", "Payments"]}
            rows={preview.parties.map(p => [
              p.tpaParty?.name || "—",
              p.tpaParty?.pan || "—",
              p.tpaParty?.gstin || "—",
              fmtINR(p.totalAmountPaid),
              fmtINR(p.totalTdsDeducted),
              p.paymentRows?.length || 0,
            ])}
          />
        </Card>
      )}

      <Card title="Generated Certificates" icon="pi-history">
        {history.length === 0 ? <Empty msg="No certificates yet." /> : (
          <Table
            headers={["Cert #", "Period", "Party", "Paid (₹)", "TDS (₹)", "Status"]}
            rows={history.map(h => [
              h.certificateNumber,
              `${h.quarter} ${h.financialYear}`,
              h.tpaParty?.name || "—",
              fmtINR(h.totalAmountPaid),
              fmtINR(h.totalTdsDeducted),
              <Badge tone={h.status === "FILED" ? "green" : h.status === "ISSUED" ? "amber" : "muted"}>{h.status}</Badge>,
            ])}
          />
        )}
      </Card>
    </AdminPage>
  );
}
