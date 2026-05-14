/**
 * AccountsConsole.jsx — Accountant's primary workspace.
 *
 * One page, five tabs covering the full daily accountant workflow:
 *   1. Day Book          — today's collection by mode / visit / doctor
 *   2. Revenue           — service-wise + MTD trend
 *   3. GST Returns       — CGST/SGST/IGST bucket-wise for GSTR-1 / GSTR-3B feeder
 *   4. Outstanding       — TPA pending, IPD advance dues, patient credit
 *   5. Refunds & Audit   — refund queue, today's cancellations, audit trail link
 *
 * URL: /accounts
 *
 * API used (all already live):
 *   GET  /api/billing/collection-summary?date=YYYY-MM-DD
 *   GET  /api/billing/summary
 *   GET  /api/billing/tpa-cases
 *   GET  /api/billing?status=...&from=...&to=...&limit=...
 *   GET  /api/pharmacy/registers/gst?from=...&to=...
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, TabStrip, KPI, Card, Table, EmptyRow, Badge,
  PrimaryButton, C,
} from "../../Components/admin-theme";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
const authHdr = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("his_token")}` } });

const fmtINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtINR2 = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };

/* ──────────────────────────────────────────────────────────── */
export default function AccountsConsole() {
  // Sidebar links pass ?tab=daybook|revenue|gst|outstanding|refunds so a
  // single route serves five entry points. Default = daybook.
  const [params, setParams] = useSearchParams();
  const initialTab = params.get("tab") || "daybook";
  const [tab, setTab] = useState(initialTab);
  // Keep URL in sync when the user clicks an in-page tab (so deep links work).
  useEffect(() => {
    if (params.get("tab") !== tab) setParams({ tab }, { replace: true });
  }, [tab]);
  // Respond to back/forward navigation between sidebar entries.
  useEffect(() => {
    const t = params.get("tab") || "daybook";
    if (t !== tab) setTab(t);
  }, [params]);
  return (
    <AdminPage>
      <Hero icon="pi-receipt" color="amber"
        title="Accounts & Finance"
        subtitle="Daily collections · GST · receivables · refunds — the accountant's command centre" />

      <TabStrip
        value={tab}
        onChange={setTab}
        accent={C.amber}
        accentL={C.amberL || "#fffbeb"}
        tabs={[
          { id: "daybook",     label: "Day Book",       icon: "pi-book" },
          { id: "revenue",     label: "Revenue",        icon: "pi-chart-line" },
          { id: "gst",         label: "GST Returns",    icon: "pi-percentage" },
          { id: "outstanding", label: "Outstanding",    icon: "pi-clock" },
          { id: "refunds",     label: "Refunds & Audit",icon: "pi-undo" },
        ]}
      />

      <div style={{ marginTop: 16 }}>
        {tab === "daybook"     && <DayBookTab />}
        {tab === "revenue"     && <RevenueTab />}
        {tab === "gst"         && <GSTTab />}
        {tab === "outstanding" && <OutstandingTab />}
        {tab === "refunds"     && <RefundsTab />}
      </div>
    </AdminPage>
  );
}

/* ══════════════════════════════════════════════════════════════
   DAY BOOK — Today's cash book + mode-wise + per-visit
══════════════════════════════════════════════════════════════ */
function DayBookTab() {
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/billing/collection-summary?date=${date}`, authHdr());
      setData(r.data || {});
    } catch (e) { toast.error("Day Book load failed"); }
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [date]);

  const s = data?.summary || {};
  const byMode    = data?.byMode || [];
  const byVisit   = data?.byVisitType || [];
  const byDoctor  = data?.byDoctor || [];

  return (
    <>
      {/* Date picker + actions */}
      <Card title="Date selector" color={C.amber} icon="pi-calendar"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)}
              style={{ padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontWeight: 700, color: C.text }} />
            <PrimaryButton label="Refresh" icon="pi-refresh" color={C.amber} onClick={refresh} busy={loading} />
          </div>
        }>
        <div style={{ fontSize: 12.5, color: C.muted }}>
          Showing collection breakdown for <b style={{ color: C.text }}>{new Date(date).toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</b>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, margin: "12px 0" }}>
        <KPI label="Total collected"  value={fmtINR(s.totalCollected)}  color={C.green}   icon="pi-money-bill" />
        <KPI label="Gross billed"     value={fmtINR(s.totalGross)}      color={C.blue}    icon="pi-receipt" />
        <KPI label="Outstanding"      value={fmtINR(s.totalPending)}    color={C.red}     icon="pi-clock" />
        <KPI label="Transactions"     value={s.txnCount ?? 0}           color={C.purple}  icon="pi-list" />
        <KPI label="IPD advance due"  value={fmtINR(s.advanceDue)}      color={C.amber}   icon="pi-home" />
        <KPI label="TPA pending"      value={fmtINR(s.tpaPending)}      color={C.teal}    icon="pi-briefcase" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Mode-wise */}
        <Card title="Collection by payment mode" color={C.green} icon="pi-wallet">
          {byMode.length === 0 ? (
            <div style={{ padding: 18, textAlign: "center", color: C.muted, fontSize: 12.5 }}>No payments recorded for {date}.</div>
          ) : (
            <Table cols={[{ label: "Mode" }, { label: "Amount", align: "right" }, { label: "Share", align: "right" }]}>
              {byMode.map((m, i) => {
                const share = s.totalCollected ? ((m.amount / s.totalCollected) * 100).toFixed(1) : "0.0";
                return (
                  <tr key={i}>
                    <td><Badge value={m.mode} palette={C.green} /></td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtINR2(m.amount)}</td>
                    <td style={{ textAlign: "right", color: C.muted, fontSize: 12 }}>{share}%</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        {/* Visit-type */}
        <Card title="Collection by visit type" color={C.blue} icon="pi-th-large">
          {byVisit.length === 0 ? (
            <div style={{ padding: 18, textAlign: "center", color: C.muted, fontSize: 12.5 }}>No data.</div>
          ) : (
            <Table cols={[{ label: "Visit" }, { label: "Bills", align: "right" }, { label: "Collected", align: "right" }]}>
              {byVisit.filter(v => v.amount > 0 || v.count > 0).map((v, i) => (
                <tr key={i}>
                  <td><Badge value={v.type} palette={C.blue} /></td>
                  <td style={{ textAlign: "right" }}>{v.count}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtINR2(v.amount)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {/* By doctor */}
      <div style={{ marginTop: 14 }}>
        <Card title="Consultation collection by doctor" color={C.purple} icon="pi-user-edit">
          {byDoctor.length === 0 ? (
            <div style={{ padding: 18, textAlign: "center", color: C.muted, fontSize: 12.5 }}>
              No doctor-attributed collection on {date}. (System-debt: bills without <code>doctor</code> ref don't appear here.)
            </div>
          ) : (
            <Table cols={[
              { label: "Doctor" },
              { label: "Specialisation" },
              { label: "Bills", align: "right" },
              { label: "Collected", align: "right" },
            ]}>
              {byDoctor.map((d, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{d.name}</td>
                  <td style={{ color: C.muted }}>{d.specialization || "—"}</td>
                  <td style={{ textAlign: "right" }}>{d.count}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtINR2(d.amount)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   REVENUE — month-to-date overview
══════════════════════════════════════════════════════════════ */
function RevenueTab() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo]     = useState(todayISO());
  const [billing, setBilling] = useState(null);
  const [pharmacy, setPharmacy] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [b, p] = await Promise.all([
        axios.get(`${API}/billing/summary?startDate=${from}&endDate=${to}`, authHdr()).catch(() => null),
        axios.get(`${API}/pharmacy/stats`, authHdr()).catch(() => null),
      ]);
      setBilling(b?.data || null);
      setPharmacy(p?.data?.data || null);
    } catch (e) {}
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [from, to]);

  const bs = billing?.summary || billing?.data || billing || {};
  return (
    <>
      <Card title="Date range" color={C.blue} icon="pi-calendar"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              style={{ padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontWeight: 700 }} />
            <span style={{ color: C.muted }}>to</span>
            <input type="date" value={to} max={todayISO()} onChange={(e) => setTo(e.target.value)}
              style={{ padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontWeight: 700 }} />
            <PrimaryButton label="Refresh" icon="pi-refresh" color={C.blue} onClick={refresh} busy={loading} />
          </div>
        }>
        <div style={{ fontSize: 12.5, color: C.muted }}>
          {Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1} day window · {from} → {to}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, margin: "12px 0" }}>
        <KPI label="Hospital billing"   value={fmtINR(bs.totalBilled ?? bs.netAmount ?? 0)}    color={C.blue}    icon="pi-receipt" />
        <KPI label="Collected"          value={fmtINR(bs.totalCollected ?? bs.totalPaid ?? 0)} color={C.green}   icon="pi-money-bill" />
        <KPI label="Outstanding"        value={fmtINR(bs.totalPending ?? bs.outstanding ?? 0)} color={C.red}     icon="pi-clock" />
        <KPI label="Bills generated"    value={bs.totalBills ?? bs.billCount ?? "—"}           color={C.purple}  icon="pi-list" />
        <KPI label="Pharmacy MTD"       value={fmtINR(pharmacy?.monthSales?.net ?? 0)}         color={C.amber}   icon="pi-box" />
        <KPI label="Pharmacy today"     value={fmtINR(pharmacy?.todaySales?.net ?? 0)}         color={C.orange}  icon="pi-shopping-cart" />
      </div>

      <Card title="Revenue stream snapshot" color={C.amber} icon="pi-chart-bar">
        <div style={{ fontSize: 12.5, color: C.muted, padding: "8px 0 14px" }}>
          Service-wise revenue breakdown wiring is pending a backend aggregator (<code>/api/billing/revenue-streams</code>).
          For now use the cards above + Bills List for line-item drill-downs.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <PrimaryButton label="Open Bills List" icon="pi-list" color={C.amber} onClick={() => location.assign("/billing")} />
          <PrimaryButton label="Billing Intelligence" icon="pi-bolt" color={C.purple} onClick={() => location.assign("/billing-intelligence")} />
          <PrimaryButton label="Pharmacy Sales Register" icon="pi-receipt" color={C.orange} onClick={() => location.assign("/pharmacy?tab=registers")} />
        </div>
      </Card>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   GST — CGST/SGST/IGST bucket-wise for monthly returns
══════════════════════════════════════════════════════════════ */
function GSTTab() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo]     = useState(todayISO());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/pharmacy/registers/gst?from=${from}&to=${to}`, authHdr());
      setData(r.data || {});
    } catch (e) { toast.error("GST register load failed"); }
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [from, to]);

  const buckets = data?.data?.buckets || data?.buckets || [];
  const totals  = buckets.reduce((acc, b) => ({
    taxable: acc.taxable + (b.netTaxable ?? b.taxable ?? 0),
    cgst:    acc.cgst    + (b.cgst ?? 0),
    sgst:    acc.sgst    + (b.sgst ?? 0),
    igst:    acc.igst    + (b.igst ?? 0),
    total:   acc.total   + (b.netTax ?? b.tax ?? 0),
  }), { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });

  return (
    <>
      <Card title="Return period" color={C.purple} icon="pi-calendar"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              style={{ padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontWeight: 700 }} />
            <span style={{ color: C.muted }}>to</span>
            <input type="date" value={to} max={todayISO()} onChange={(e) => setTo(e.target.value)}
              style={{ padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontWeight: 700 }} />
            <PrimaryButton label="Refresh" icon="pi-refresh" color={C.purple} onClick={refresh} busy={loading} />
          </div>
        }>
        <div style={{ fontSize: 12.5, color: C.muted }}>
          Pharmacy GST snapshot — bucket-wise CGST/SGST split with debit-note (supplements) and credit-note (refunds) adjustments.
          Use this as the source for GSTR-1 outward supplies and GSTR-3B tax-paid worksheet.
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, margin: "12px 0" }}>
        <KPI label="Taxable value"  value={fmtINR(totals.taxable)} color={C.blue}   icon="pi-receipt" />
        <KPI label="CGST"           value={fmtINR(totals.cgst)}    color={C.amber}  icon="pi-percentage" />
        <KPI label="SGST"           value={fmtINR(totals.sgst)}    color={C.amber}  icon="pi-percentage" />
        <KPI label="IGST"           value={fmtINR(totals.igst)}    color={C.purple} icon="pi-percentage" />
        <KPI label="Total tax"      value={fmtINR(totals.total)}   color={C.green}  icon="pi-money-bill" />
      </div>

      <Card title="Bucket-wise GST breakdown" color={C.purple} icon="pi-list">
        {buckets.length === 0 ? (
          <div style={{ padding: 18, textAlign: "center", color: C.muted, fontSize: 12.5 }}>No GST data in the selected range.</div>
        ) : (
          <Table cols={[
            { label: "Rate" },
            { label: "Qty", align: "right" },
            { label: "Bills", align: "right" },
            { label: "Net Taxable", align: "right" },
            { label: "CGST", align: "right" },
            { label: "SGST", align: "right" },
            { label: "IGST", align: "right" },
            { label: "Tax Total", align: "right" },
          ]}>
            {buckets.map((b, i) => (
              <tr key={i}>
                <td><Badge value={`${b.gstRate ?? b.rate ?? 0}%`} palette={C.purple} /></td>
                <td style={{ textAlign: "right" }}>{b.qty ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{b.billCount ?? "—"}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtINR2(b.netTaxable ?? b.taxable ?? 0)}</td>
                <td style={{ textAlign: "right" }}>{fmtINR2(b.cgst ?? 0)}</td>
                <td style={{ textAlign: "right" }}>{fmtINR2(b.sgst ?? 0)}</td>
                <td style={{ textAlign: "right" }}>{fmtINR2(b.igst ?? 0)}</td>
                <td style={{ textAlign: "right", fontWeight: 800, color: C.green }}>{fmtINR2(b.netTax ?? b.tax ?? 0)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div style={{ marginTop: 12, fontSize: 11.5, color: C.muted, padding: "0 4px" }}>
        <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
        Hospital-service GST (consultation, room, procedures) wiring to this view is pending a unified aggregator on the billing side.
        Pharmacy GST shown above is GST-Act compliant (Sale + supplement debit notes − refund credit notes).
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   OUTSTANDING — TPA pending + IPD advance + credit ledger
══════════════════════════════════════════════════════════════ */
function OutstandingTab() {
  const [tpaCases, setTpaCases] = useState([]);
  const [collection, setCollection] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [t, c] = await Promise.all([
        axios.get(`${API}/billing/tpa-cases`, authHdr()).catch(() => null),
        axios.get(`${API}/billing/collection-summary?date=${todayISO()}`, authHdr()).catch(() => null),
      ]);
      setTpaCases(t?.data?.data || t?.data?.cases || t?.data || []);
      setCollection(c?.data?.summary || null);
    } catch (e) {}
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const tpaTotal = useMemo(() => (Array.isArray(tpaCases) ? tpaCases.reduce((s, c) => s + Number(c.outstanding ?? c.balance ?? c.netAmount ?? 0), 0) : 0), [tpaCases]);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="TPA cases open"    value={Array.isArray(tpaCases) ? tpaCases.length : 0} color={C.purple} icon="pi-briefcase" />
        <KPI label="TPA outstanding"   value={fmtINR(tpaTotal)}                              color={C.amber}  icon="pi-clock" />
        <KPI label="IPD advance due"   value={fmtINR(collection?.advanceDue)}                color={C.red}    icon="pi-home" />
        <KPI label="Today pending"     value={fmtINR(collection?.totalPending)}              color={C.teal}   icon="pi-exclamation-circle" />
      </div>

      <Card title="TPA / Insurance cases — outstanding" color={C.purple} icon="pi-briefcase"
        right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.purple} onClick={refresh} busy={loading} />}>
        {!Array.isArray(tpaCases) || tpaCases.length === 0 ? (
          <EmptyRow span={1} text="No open TPA cases. Pre-auth submissions appear here once filed." />
        ) : (
          <Table cols={[
            { label: "Bill #" },
            { label: "Patient" },
            { label: "TPA" },
            { label: "Status" },
            { label: "Bill amt", align: "right" },
            { label: "Outstanding", align: "right" },
          ]}>
            {tpaCases.slice(0, 50).map((c, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "monospace", fontSize: 11.5 }}>{c.billNumber || c.billId || c._id?.slice(-8)}</td>
                <td style={{ fontWeight: 700 }}>{c.patientName || c.UHID || "—"}</td>
                <td style={{ color: C.muted }}>{c.tpaName || c.tpaCode || "—"}</td>
                <td><Badge value={c.status || c.tpaStatus || "Open"} palette={C.purple} /></td>
                <td style={{ textAlign: "right" }}>{fmtINR2(c.netAmount ?? c.billAmount ?? 0)}</td>
                <td style={{ textAlign: "right", fontWeight: 800, color: C.red }}>{fmtINR2(c.outstanding ?? c.balance ?? 0)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <PrimaryButton label="All TPA Cases" icon="pi-briefcase" color={C.purple} onClick={() => location.assign("/tpa-cases")} />
        <PrimaryButton label="Discharge Queue (pending bills)" icon="pi-sign-out" color={C.green} onClick={() => location.assign("/discharge-queue")} />
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   REFUNDS & AUDIT
══════════════════════════════════════════════════════════════ */
function RefundsTab() {
  const navigate = useNavigate();
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("REFUNDED");

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/billing?status=${filter}&limit=50`, authHdr());
      setBills(r.data?.data || r.data?.bills || r.data || []);
    } catch (e) {}
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [filter]);

  return (
    <>
      <Card title="Filter" color={C.red} icon="pi-filter"
        right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.red} onClick={refresh} busy={loading} />}>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { id: "REFUNDED",  label: "Refunded bills",   color: C.red },
            { id: "CANCELLED", label: "Cancelled bills",  color: C.amber },
            { id: "PARTIAL",   label: "Partial payments", color: C.purple },
          ].map(o => (
            <button key={o.id} onClick={() => setFilter(o.id)}
              style={{
                padding: "6px 14px", borderRadius: 999,
                border: `1.5px solid ${filter === o.id ? o.color : C.border}`,
                background: filter === o.id ? o.color + "15" : "#fff",
                color: filter === o.id ? o.color : C.muted,
                fontWeight: 800, fontSize: 12, cursor: "pointer",
              }}>
              {o.label}
            </button>
          ))}
        </div>
      </Card>

      <div style={{ marginTop: 12 }}>
        <Card title={`Bills · ${filter}`} color={C.red} icon="pi-list">
          {!Array.isArray(bills) || bills.length === 0 ? (
            <EmptyRow span={1} text={`No ${filter.toLowerCase()} bills found.`} />
          ) : (
            <Table cols={[
              { label: "Bill #" },
              { label: "Patient" },
              { label: "Date" },
              { label: "Status" },
              { label: "Net", align: "right" },
              { label: "Paid", align: "right" },
              { label: "Action" },
            ]}>
              {bills.slice(0, 50).map((b, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: "monospace", fontSize: 11.5 }}>{b.billNumber || b._id?.slice(-8)}</td>
                  <td style={{ fontWeight: 700 }}>{b.patientName || b.UHID || "—"}</td>
                  <td style={{ color: C.muted, fontSize: 12 }}>{b.createdAt ? new Date(b.createdAt).toLocaleDateString("en-IN") : "—"}</td>
                  <td><Badge value={b.billStatus || b.status || "—"} palette={C.red} /></td>
                  <td style={{ textAlign: "right" }}>{fmtINR2(b.netAmount ?? b.totalAmount ?? 0)}</td>
                  <td style={{ textAlign: "right" }}>{fmtINR2(b.advancePaid ?? b.totalPaid ?? 0)}</td>
                  <td>
                    <button onClick={() => navigate(`/billing/view/${b._id}`)}
                      style={{ padding: "4px 10px", borderRadius: 5, border: `1px solid ${C.blue}40`, background: "#fff", color: C.blue, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <PrimaryButton label="Billing Audit Trail" icon="pi-shield" color={C.teal} onClick={() => navigate("/billing-audit-trail")} />
        <PrimaryButton label="All Bills" icon="pi-list" color={C.amber} onClick={() => navigate("/billing")} />
      </div>
    </>
  );
}
