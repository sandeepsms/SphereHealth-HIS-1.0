/**
 * TaxReturnsPage.jsx  (R7bk — sidebar nav coverage)
 *
 * GSTR-1 / GSTR-3B preview + generate + finalize. Reads the same data
 * the F6 service (gstr1Exporter / gstr3bExporter) returns.
 *
 *   URL: /tax-returns
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, KPI, Card, Table, Empty, Badge, Modal,
  PrimaryButton, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";
import { API_BASE_URL as API } from "../../config/api";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token") || ""}` },
});

const fmtINR = (n) =>
  (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }) : "—";

const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function TaxReturnsPage() {
  const { can } = useAuth();
  const [period, setPeriod] = useState(currentPeriod());
  const [returnKind, setReturnKind] = useState("GSTR-1");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/tax-returns/gstr1`, authHdr());
      setHistory(r.data?.data || []);
    } catch (e) { /* silent — history is optional */ }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const doPreview = async () => {
    setLoading(true); setPreview(null);
    try {
      const path = returnKind === "GSTR-1" ? "gstr1" : "gstr3b";
      const r = await axios.post(`${API}/tax-returns/${path}/preview?period=${period}`, {}, authHdr());
      setPreview(r.data?.data || null);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to preview");
    }
    setLoading(false);
  };

  const generate = async () => {
    if (!preview) { toast.warn("Preview first"); return; }
    setSaving(true);
    try {
      const path = returnKind === "GSTR-1" ? "gstr1" : "gstr3b";
      await axios.post(`${API}/tax-returns/${path}/generate?period=${period}`, {}, authHdr());
      toast.success("Return generated (DRAFT)");
      fetchHistory();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to generate");
    }
    setSaving(false);
  };

  const totals = useMemo(() => {
    if (!preview) return null;
    if (returnKind === "GSTR-1") {
      const b2c = preview.b2c || [];
      const b2b = preview.b2b || [];
      const hsn = preview.hsn || [];
      return {
        b2cTaxable: b2c.reduce((s, x) => s + Number(x.taxableValue || 0), 0),
        b2bTaxable: b2b.reduce((s, x) => s + Number(x.taxableValue || 0), 0),
        totalCgst: [...b2c, ...b2b].reduce((s, x) => s + Number(x.cgstAmount || 0), 0),
        totalSgst: [...b2c, ...b2b].reduce((s, x) => s + Number(x.sgstAmount || 0), 0),
        totalIgst: [...b2c, ...b2b].reduce((s, x) => s + Number(x.igstAmount || 0), 0),
        hsnCount: hsn.length,
        invoiceCount: b2c.reduce((s, x) => s + Number(x.invoiceCount || 0), 0) +
                       b2b.reduce((s, x) => s + Number(x.invoiceCount || 0), 0),
      };
    }
    return preview;
  }, [preview, returnKind]);

  return (
    <AdminPage>
      <Hero icon="pi-file" color="green"
        title="GST Tax Returns"
        subtitle="GSTR-1 / GSTR-3B preview, generate, finalize, mark-filed. Pulls hospital + pharmacy via union aggregator." />

      <Card title="Period Selection" icon="pi-calendar">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 12, color: C.muted, display: "block" }}>Return</label>
            <select value={returnKind} onChange={e => setReturnKind(e.target.value)}>
              <option>GSTR-1</option>
              <option>GSTR-3B</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.muted, display: "block" }}>Period</label>
            <input type="month" value={period} onChange={e => setPeriod(e.target.value)} />
          </div>
          <PrimaryButton onClick={doPreview} disabled={loading}>{loading ? "Loading…" : "Preview"}</PrimaryButton>
          {preview && can("tax.returns.write") && (
            <PrimaryButton onClick={generate} disabled={saving}>{saving ? "…" : "Generate (DRAFT)"}</PrimaryButton>
          )}
        </div>
      </Card>

      {preview && totals && returnKind === "GSTR-1" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14, marginTop: 14 }}>
            <KPI label="B2C Taxable" value={`₹${fmtINR(totals.b2cTaxable)}`} color={C.blue} icon="pi-users" />
            <KPI label="B2B Taxable" value={`₹${fmtINR(totals.b2bTaxable)}`} color={C.green} icon="pi-briefcase" />
            <KPI label="CGST" value={`₹${fmtINR(totals.totalCgst)}`} color={C.amber} icon="pi-percentage" />
            <KPI label="SGST" value={`₹${fmtINR(totals.totalSgst)}`} color={C.amber} icon="pi-percentage" />
            <KPI label="IGST" value={`₹${fmtINR(totals.totalIgst)}`} color={C.purple} icon="pi-percentage" />
            <KPI label="HSN Lines" value={totals.hsnCount} color={C.muted} icon="pi-tag" />
          </div>

          <Card title={`HSN Summary (Line 12) — ${period}`} icon="pi-table">
            {(preview.hsn || []).length === 0 ? <Empty msg="No HSN lines for period." /> : (
              <Table
                headers={["HSN/SAC", "UQC", "Qty", "Value (₹)", "Taxable (₹)", "Rate %", "CGST", "SGST", "IGST"]}
                rows={(preview.hsn || []).map(h => [
                  h.hsnSac || "—",
                  h.uqc || "—",
                  h.totalQuantity || 0,
                  fmtINR(h.totalValue),
                  fmtINR(h.taxableValue),
                  h.rate || 0,
                  fmtINR(h.cgstAmount),
                  fmtINR(h.sgstAmount),
                  fmtINR(h.igstAmount),
                ])}
              />
            )}
          </Card>
        </>
      )}

      {preview && returnKind === "GSTR-3B" && (
        <Card title={`GSTR-3B Summary — ${period}`} icon="pi-file">
          <pre style={{ background: "#f8fafc", padding: 12, borderRadius: 6, fontSize: 12, overflow: "auto" }}>
            {JSON.stringify(preview, null, 2)}
          </pre>
        </Card>
      )}

      <Card title="Generated Returns" icon="pi-history">
        {history.length === 0 ? <Empty msg="No returns generated yet." /> : (
          <Table
            headers={["Period", "Kind", "Status", "Generated", "Filed", "ARN"]}
            rows={history.map(h => [
              h.period,
              h.returnKind,
              <Badge tone={h.filingStatus === "FILED" ? "green" : h.filingStatus === "FINALIZED" ? "amber" : "muted"}>
                {h.filingStatus}
              </Badge>,
              fmtDate(h.generatedAt),
              fmtDate(h.filedAt),
              h.arn || "—",
            ])}
          />
        )}
      </Card>
    </AdminPage>
  );
}
