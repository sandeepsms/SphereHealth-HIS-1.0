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
  AdminPage, Hero, TabStrip, KPI, Card, Table, EmptyRow, Empty, Badge, Field,
  PrimaryButton, C,
} from "../../Components/admin-theme";

import { API_BASE_URL as API } from "../../config/api";
// R7ap-F16: shared Decimal128-safe money helpers — replaces ad-hoc Number()
// coercion that NaN'd on raw {$numberDecimal} payloads.
import { toMoney, fmtINR0 as fmtINR, fmtINR2 } from "../../utils/money";
// R7ap-F22/D4-16: per-tab error boundary so one component crash doesn't
// blank the whole Accounts page.
import ErrorBoundary from "../../Components/ErrorBoundary";
const authHdr = () => ({ headers: { Authorization: `Bearer ${(sessionStorage.getItem("his_token") || localStorage.getItem("his_token"))}` } });
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
          { id: "bills",       label: "All Bills",      icon: "pi-list" },
          { id: "refunds",     label: "Refunds & Audit",icon: "pi-undo" },
          { id: "shift",       label: "Shift / Cashier",icon: "pi-user-edit" },
        ]}
      />

      <div style={{ marginTop: 16 }}>
        {/* R7ap-F22: wrap each tab in its own ErrorBoundary so an exception
            (e.g. a Decimal128 reduce NaN) doesn't unmount the tab strip. */}
        {tab === "daybook"     && <ErrorBoundary label="Day Book"><DayBookTab /></ErrorBoundary>}
        {tab === "revenue"     && <ErrorBoundary label="Revenue"><RevenueTab /></ErrorBoundary>}
        {tab === "gst"         && <ErrorBoundary label="GST Returns"><GSTTab /></ErrorBoundary>}
        {tab === "outstanding" && <ErrorBoundary label="Outstanding"><OutstandingTab /></ErrorBoundary>}
        {tab === "bills"       && <ErrorBoundary label="All Bills"><AllBillsTab /></ErrorBoundary>}
        {tab === "refunds"     && <ErrorBoundary label="Refunds & Audit"><RefundsTab /></ErrorBoundary>}
        {tab === "shift"       && <ErrorBoundary label="Shift / Cashier"><ShiftTab /></ErrorBoundary>}
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
      {/* R7ar-P1-12/D5-aq-04: explicit cash-flow strip so the cashier can
          see in/out at a glance. Backend already computes these four —
          they were just not rendered. netCashFlow = totalCollected −
          billRefundsOut − advanceRefundsOut. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, margin: "0 0 12px" }}>
        <KPI label="Advance deposits IN"  value={fmtINR(s.advanceDepositsIn)} color={C.amber}  icon="pi-arrow-down-left" />
        <KPI label="Advance refunds OUT"  value={fmtINR(s.advanceRefundsOut)} color={C.red}    icon="pi-arrow-up-right" />
        <KPI label="Bill refunds OUT"     value={fmtINR(s.billRefundsOut)}    color={C.red}    icon="pi-undo" />
        <KPI label="Net cash flow (today)"
             value={fmtINR(s.netCashFlow)}
             color={(s.netCashFlow ?? 0) < 0 ? C.red : C.green}
             icon={(s.netCashFlow ?? 0) < 0 ? "pi-arrow-down" : "pi-arrow-up"} />
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
  const navigate = useNavigate();
  // Default window — last 90 days so the page lands on data even on a
  // hospital where finalised bills are sparse. The user can tighten to
  // MTD via the date picker.
  const ninetyAgo = () => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); };
  const [from, setFrom] = useState(ninetyAgo());
  const [to, setTo]     = useState(todayISO());
  const [breakdown, setBreakdown] = useState(null);  // /billing/revenue-breakdown payload
  const [snapshot, setSnapshot] = useState(null);    // /billing/summary today snapshot
  const [pharmacy, setPharmacy] = useState(null);    // /pharmacy/stats
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [bd, snap, ph] = await Promise.all([
        axios.get(`${API}/billing/revenue-breakdown?from=${from}&to=${to}`, authHdr()).then(r => r.data).catch(() => null),
        axios.get(`${API}/billing/summary`, authHdr()).then(r => r.data?.data).catch(() => null),
        axios.get(`${API}/pharmacy/stats`, authHdr()).then(r => r.data?.data).catch(() => null),
      ]);
      setBreakdown(bd);
      setSnapshot(snap);
      setPharmacy(ph);
    } catch (e) {}
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [from, to]);
  const t = breakdown?.totals || {};

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
          {breakdown?.window?.days || Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1} day window · {from} → {to}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, margin: "12px 0" }}>
        <KPI label="Collected (range)"  value={fmtINR(t.paid)}        color={C.green}   icon="pi-money-bill" />
        <KPI label="Gross billed"       value={fmtINR(t.gross)}       color={C.blue}    icon="pi-receipt" />
        <KPI label="Outstanding"        value={fmtINR(t.outstanding)} color={C.red}     icon="pi-clock" />
        <KPI label="Bills counted"      value={t.count ?? 0}          color={C.purple}  icon="pi-list" />
        <KPI label="Pharmacy MTD"       value={fmtINR(pharmacy?.monthSales?.net ?? 0)}         color={C.amber}   icon="pi-box" />
        <KPI label="Pharmacy today"     value={fmtINR(pharmacy?.todaySales?.net ?? 0)}         color={C.orange}  icon="pi-shopping-cart" />
      </div>

      {/* Live snapshot — today's bills awaiting payment + TPA outstanding */}
      <Card title="Today's snapshot" color={C.purple} icon="pi-flag">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <KPI label="Bills today"        value={snapshot?.todayBills ?? "—"}                  color={C.blue}    icon="pi-receipt" />
          <KPI label="Today's revenue"    value={fmtINR(snapshot?.todayRevenue ?? 0)}          color={C.green}   icon="pi-money-bill" />
          <KPI label="Pending bills"      value={snapshot?.pendingBills ?? "—"}                color={C.amber}   icon="pi-clock" />
          <KPI label="TPA pending (live)" value={fmtINR(snapshot?.tpaPending ?? 0)}            color={C.red}     icon="pi-briefcase" />
        </div>
      </Card>

      {/* Service-line + visit-type + payer breakdown — 2x2 grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
        <BreakdownCard title="Service categories"  rows={breakdown?.byCategory}   keyField="category"  color={C.amber}  icon="pi-tag"           total={t.gross || t.paid} valueField="gross" />
        <BreakdownCard title="Visit types"         rows={breakdown?.byVisitType}  keyField="visitType" color={C.blue}   icon="pi-th-large"      total={t.paid}            valueField="paid" />
        <BreakdownCard title="Payment / payer type"rows={breakdown?.byPayer}      keyField="payer"     color={C.green}  icon="pi-wallet"        total={t.paid}            valueField="paid" />
        <BreakdownCard title="Departments"         rows={breakdown?.byDepartment} keyField="department"color={C.purple} icon="pi-sitemap"       total={t.paid}            valueField="paid" />
      </div>

      <div style={{ marginTop: 12 }}>
        <Card title="Top 20 doctors by collection" color={C.teal} icon="pi-user-edit">
          {!breakdown?.byDoctor?.length ? (
            <Empty icon="pi-user-edit" text="No doctor-attributed collection in this window. (System debt: bills created without a `doctor` ref don't appear here.)" />
          ) : (
            <Table cols={[{ label: "Doctor" }, { label: "Bills", align: "right" }, { label: "Collected", align: "right" }]}>
              {breakdown.byDoctor.map((d, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{d.name}</td>
                  <td style={{ textAlign: "right" }}>{d.count}</td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{fmtINR2(d.paid)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {/* R7ah: "Open Bills List" button removed — was wired to the deleted
            /billing route. Billing Counter covers the same flow. */}
        <PrimaryButton label="Billing Counter"          icon="pi-credit-card" color={C.purple} onClick={() => navigate("/reception-billing")} />
        <PrimaryButton label="Pharmacy Sales Register"  icon="pi-receipt" color={C.orange} onClick={() => navigate("/pharmacy?tab=registers")} />
      </div>
    </>
  );
}

// Generic breakdown card — given an array of { <keyField>, count, paid, gross }
// rows, renders a compact bar-chart-ish table with each row's share of the
// grand total. Used by RevenueTab × 4 (services, visits, payers, depts).
function BreakdownCard({ title, rows, keyField, color, icon, total, valueField = "paid" }) {
  return (
    <Card title={title} color={color} icon={icon}>
      {!rows?.length ? (
        <Empty icon={icon} text="No data in this window." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.slice(0, 8).map((r, i) => {
            const v = Number(r[valueField] || 0);
            const pct = total > 0 ? (v / total) * 100 : 0;
            return (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, color: C.text }}>{r[keyField] || "—"}</span>
                  <span style={{ fontWeight: 800, color }}>{fmtINR2(v)}<span style={{ color: C.muted, fontWeight: 500, marginLeft: 6 }}>{pct.toFixed(1)}%</span></span>
                </div>
                <div style={{ height: 6, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width .3s" }} />
                </div>
              </div>
            );
          })}
          {rows.length > 8 && <div style={{ fontSize: 11, color: C.muted, textAlign: "right", marginTop: 4 }}>+{rows.length - 8} more</div>}
        </div>
      )}
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════
   GST — CGST/SGST/IGST bucket-wise for monthly returns
══════════════════════════════════════════════════════════════ */
function GSTTab() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo]     = useState(todayISO());
  const [data, setData] = useState(null);
  const [hospitalData, setHospitalData] = useState(null);   // R7ap-F13
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      // R7ap-F13: fetch pharmacy + hospital GST in parallel.
      const [pharmaR, hospR] = await Promise.all([
        axios.get(`${API}/pharmacy/registers/gst?from=${from}&to=${to}`, authHdr()).catch(() => null),
        axios.get(`${API}/billing/gst-register?from=${from}&to=${to}`, authHdr()).catch(() => null),
      ]);
      setData(pharmaR?.data || {});
      setHospitalData(hospR?.data?.data || null);
    } catch (e) { toast.error("GST register load failed"); }
    setLoading(false);
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [from, to]);

  const buckets = data?.data?.buckets || data?.buckets || [];
  const hospitalBuckets = hospitalData?.buckets || [];
  const hospitalTotals  = hospitalData?.totals  || { taxableValue: 0, cgst: 0, sgst: 0, taxAmount: 0 };
  // Pharmacy + Hospital combined view: union both bucket arrays by rate.
  const totals  = buckets.reduce((acc, b) => ({
    taxable: acc.taxable + (b.netTaxable ?? b.taxable ?? 0),
    cgst:    acc.cgst    + (b.cgst ?? 0),
    sgst:    acc.sgst    + (b.sgst ?? 0),
    total:   acc.total   + (b.netTax ?? b.tax ?? 0),
  }), { taxable: 0, cgst: 0, sgst: 0, total: 0 });
  const grandTotals = {
    taxable: totals.taxable + hospitalTotals.taxableValue,
    cgst:    totals.cgst    + hospitalTotals.cgst,
    sgst:    totals.sgst    + hospitalTotals.sgst,
    total:   totals.total   + hospitalTotals.taxAmount,
  };

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

      {/* R7ap-F13: grand totals = pharmacy + hospital */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, margin: "12px 0" }}>
        <KPI label="Taxable value"  value={fmtINR(grandTotals.taxable)} color={C.blue}   icon="pi-receipt" />
        <KPI label="CGST"           value={fmtINR(grandTotals.cgst)}    color={C.amber}  icon="pi-percentage" />
        <KPI label="SGST"           value={fmtINR(grandTotals.sgst)}    color={C.amber}  icon="pi-percentage" />
        <KPI label="Net tax"        value={fmtINR(grandTotals.total)}   color={C.green}  icon="pi-money-bill" />
      </div>

      <Card title="Pharmacy GST · bucket-wise" color={C.purple} icon="pi-list">
        {buckets.length === 0 ? (
          <div style={{ padding: 18, textAlign: "center", color: C.muted, fontSize: 12.5 }}>No pharmacy GST in the selected range.</div>
        ) : (
          <Table cols={[
            { label: "Rate" },
            { label: "Qty", align: "right" },
            { label: "Bills", align: "right" },
            { label: "Net Taxable", align: "right" },
            { label: "CGST", align: "right" },
            { label: "SGST", align: "right" },
            { label: "Net Tax", align: "right" },
          ]}>
            {buckets.map((b, i) => (
              <tr key={i}>
                <td><Badge value={`${b.gstRate ?? b.rate ?? 0}%`} /></td>
                <td style={{ textAlign: "right" }}>{b.qty ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{b.billCount ?? "—"}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtINR2(b.netTaxable ?? b.taxable ?? 0)}</td>
                <td style={{ textAlign: "right" }}>{fmtINR2(b.cgst ?? 0)}</td>
                <td style={{ textAlign: "right" }}>{fmtINR2(b.sgst ?? 0)}</td>
                <td style={{ textAlign: "right", fontWeight: 800, color: C.green }}>{fmtINR2(b.netTax ?? b.tax ?? 0)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* R7ap-F13/C-08/D5-10: hospital-service GST aggregator — was a known gap,
          consultation/room/procedure/investigation GST is now surfaced. */}
      <div style={{ marginTop: 12 }}>
        <Card title="Hospital service GST · bucket-wise" color={C.purple} icon="pi-list">
          {hospitalBuckets.length === 0 ? (
            <div style={{ padding: 18, textAlign: "center", color: C.muted, fontSize: 12.5 }}>No hospital-service GST in the selected range.</div>
          ) : (
            <Table cols={[
              { label: "Rate" },
              { label: "Items", align: "right" },
              { label: "Bills", align: "right" },
              { label: "Net Taxable", align: "right" },
              { label: "CGST", align: "right" },
              { label: "SGST", align: "right" },
              { label: "Net Tax", align: "right" },
            ]}>
              {hospitalBuckets.map((b, i) => (
                <tr key={i}>
                  <td><Badge value={`${b.rate}%`} palette={C.purple} /></td>
                  <td style={{ textAlign: "right" }}>{b.itemCount}</td>
                  <td style={{ textAlign: "right" }}>{b.billCount}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtINR2(b.taxableValue)}</td>
                  <td style={{ textAlign: "right" }}>{fmtINR2(b.cgst)}</td>
                  <td style={{ textAlign: "right" }}>{fmtINR2(b.sgst)}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: C.green }}>{fmtINR2(b.taxAmount)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 12, fontSize: 11.5, color: C.muted, padding: "0 4px" }}>
        <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
        R7ap: Hospital-service GST now aggregated alongside Pharmacy. CGST/SGST 50/50 split assumes intra-state supplies; IGST handling for inter-state patients requires place-of-supply on bills (R7ap-D6-04, pending).
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   OUTSTANDING — TPA pending + IPD advance + credit ledger
══════════════════════════════════════════════════════════════ */
function OutstandingTab() {
  const navigate = useNavigate();
  const [tpaCases, setTpaCases] = useState([]);
  const [collection, setCollection] = useState(null);
  const [aging, setAging] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [t, c, a] = await Promise.all([
        axios.get(`${API}/billing/tpa-cases`, authHdr()).catch(() => null),
        axios.get(`${API}/billing/collection-summary?date=${todayISO()}`, authHdr()).catch(() => null),
        axios.get(`${API}/billing/aging`, authHdr()).catch(() => null),
      ]);
      setTpaCases(t?.data?.data || t?.data?.cases || t?.data || []);
      setCollection(c?.data?.summary || null);
      setAging(a?.data || null);
    } catch (e) {}
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const tpaTotal = useMemo(() => (Array.isArray(tpaCases) ? tpaCases.reduce((s, c) => s + Number(c.outstanding ?? c.balance ?? c.netAmount ?? 0), 0) : 0), [tpaCases]);
  const bucketColor = { "0-30": C.green, "31-60": C.amber, "61-90": C.orange || C.amber, "90+": C.red };

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
          <Empty icon="pi-briefcase" text="No open TPA cases. Pre-auth submissions appear here once filed." />
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

      {/* Aging buckets — 0-30 / 31-60 / 61-90 / 90+ */}
      <div style={{ marginTop: 14 }}>
        <Card title={`Aging analysis · as of ${aging?.asOf || todayISO()} · total outstanding ${fmtINR(aging?.totalOutstanding)}`} color={C.amber} icon="pi-clock">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {(aging?.buckets || [{bucket:"0-30"},{bucket:"31-60"},{bucket:"61-90"},{bucket:"90+"}]).map((b, i) => (
              <div key={i} style={{
                padding: 14, borderRadius: 10,
                background: (bucketColor[b.bucket] || C.muted) + "10",
                border: `1.5px solid ${(bucketColor[b.bucket] || C.muted) + "40"}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: bucketColor[b.bucket] || C.muted, letterSpacing: ".5px" }}>
                  {b.bucket} DAYS
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: C.text, margin: "4px 0" }}>
                  {fmtINR(b.amount ?? 0)}
                </div>
                <div style={{ fontSize: 11, color: C.muted }}>
                  {b.count ?? 0} bill{(b.count ?? 0) === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Patient credit ledger — non-TPA outstanding bills */}
      <div style={{ marginTop: 14 }}>
        <Card title={`Patient credit ledger · ${aging?.patientCredit?.length || 0} bill${(aging?.patientCredit?.length || 0) === 1 ? "" : "s"} with balance due`} color={C.red} icon="pi-exclamation-circle">
          {!aging?.patientCredit?.length ? (
            <Empty icon="pi-money-bill" text="No patient credit outstanding. All non-TPA bills are paid in full." />
          ) : (
            <Table cols={[
              { label: "Bill #" }, { label: "Patient" }, { label: "Age" },
              { label: "Bucket" }, { label: "Gross", align: "right" }, { label: "Paid", align: "right" },
              { label: "Due", align: "right" }, { label: "Action" },
            ]}>
              {aging.patientCredit.slice(0, 30).map((b, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: "monospace", fontSize: 11.5 }}>{b.billNumber}</td>
                  <td style={{ fontWeight: 700 }}>{b.patientName || b.UHID}</td>
                  <td style={{ color: C.muted, fontSize: 11.5 }}>{b.ageDays}d</td>
                  <td><Badge value={b.bucket} /></td>
                  <td style={{ textAlign: "right" }}>{fmtINR2(b.gross)}</td>
                  <td style={{ textAlign: "right" }}>{fmtINR2(b.paid)}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: C.red }}>{fmtINR2(b.due)}</td>
                  <td>
                    {/* R7ap-F4: route /billing/view/:id was deleted in R7ah.
                        Open the workflow page (Reception Billing Counter) so
                        the accountant can drill into payments, refund, print. */}
                    <button onClick={() => navigate(`/reception-billing/${b.UHID}`)}
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
        <PrimaryButton label="All TPA Cases" icon="pi-briefcase" color={C.purple} onClick={() => navigate("/tpa-cases")} />
        <PrimaryButton label="Discharge Queue (pending bills)" icon="pi-sign-out" color={C.green} onClick={() => navigate("/discharge-queue")} />
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   ALL BILLS — filtered ledger with date / status / payer / search
══════════════════════════════════════════════════════════════ */
function AllBillsTab() {
  const navigate = useNavigate();
  const [bills, setBills] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [visitType, setVisitType] = useState("");
  const [payer, setPayer] = useState("");
  const ninetyAgo = () => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0,10); };
  const [from, setFrom] = useState(ninetyAgo());
  const [to, setTo]     = useState(todayISO());

  const refresh = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        limit: 100, startDate: from, endDate: to,
        ...(status ? { status } : {}), ...(visitType ? { visitType } : {}),
        ...(payer ? { paymentType: payer } : {}), ...(q ? { UHID: q } : {}),
      });
      const r = await axios.get(`${API}/billing?${qs}`, authHdr());
      setBills(r.data?.data || r.data?.bills || []);
      setTotal(r.data?.pagination?.total ?? (r.data?.data?.length || 0));
    } catch (e) {}
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [from, to, status, visitType, payer]);

  const Pill = ({ label, value, current, setCurrent, color = C.amber }) => (
    <button onClick={() => setCurrent(value === current ? "" : value)}
      style={{
        padding: "5px 12px", borderRadius: 999,
        border: `1.5px solid ${value === current ? color : C.border}`,
        background: value === current ? color + "15" : "#fff",
        color: value === current ? color : C.muted,
        fontWeight: 700, fontSize: 11.5, cursor: "pointer",
      }}>{label}</button>
  );

  return (
    <>
      <Card title="Filter bills" color={C.amber} icon="pi-filter"
        right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.amber} onClick={refresh} busy={loading} />}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            style={{ padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontWeight: 700 }} />
          <span style={{ color: C.muted, fontSize: 12 }}>to</span>
          <input type="date" value={to} max={todayISO()} onChange={(e) => setTo(e.target.value)}
            style={{ padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontWeight: 700 }} />
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && refresh()}
            placeholder="UHID…" style={{ flex: 1, minWidth: 140, padding: "6px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5 }} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginRight: 4, paddingTop: 6 }}>STATUS:</span>
          {["DRAFT","GENERATED","PARTIAL","PAID","CANCELLED","REFUNDED"].map(s =>
            <Pill key={s} label={s} value={s} current={status} setCurrent={setStatus} color={C.amber} />)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginRight: 4, paddingTop: 6 }}>VISIT:</span>
          {["OPD","IPD","ER","Day Care","Services"].map(v =>
            <Pill key={v} label={v} value={v} current={visitType} setCurrent={setVisitType} color={C.blue} />)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginRight: 4, paddingTop: 6 }}>PAYER:</span>
          {["CASH","CARD","UPI","TPA","CORPORATE","INSURANCE"].map(p =>
            <Pill key={p} label={p} value={p} current={payer} setCurrent={setPayer} color={C.green} />)}
        </div>
      </Card>

      <div style={{ marginTop: 12 }}>
        <Card title={`${bills.length} bill${bills.length === 1 ? "" : "s"} ${total > bills.length ? `(of ${total})` : ""}`} color={C.amber} icon="pi-list">
          {!bills.length ? (
            <Empty icon="pi-inbox" text="No bills match these filters." />
          ) : (
            <Table cols={[
              { label: "Bill #" }, { label: "Patient" }, { label: "Date" },
              { label: "Visit" }, { label: "Payer" }, { label: "Status" },
              { label: "Net", align: "right" }, { label: "Paid", align: "right" }, { label: "Action" },
            ]}>
              {bills.map((b, i) => (
                <tr key={b._id || i}>
                  <td style={{ fontFamily: "monospace", fontSize: 11.5 }}>{b.billNumber || b._id?.slice(-8)}</td>
                  <td style={{ fontWeight: 700 }}>{b.patientName || b.UHID || "—"}</td>
                  <td style={{ color: C.muted, fontSize: 11.5 }}>{b.createdAt ? new Date(b.createdAt).toLocaleDateString("en-IN") : "—"}</td>
                  <td style={{ color: C.muted, fontSize: 11.5 }}>{b.visitType || "—"}</td>
                  <td style={{ color: C.muted, fontSize: 11.5 }}>{b.paymentType || "—"}</td>
                  <td><Badge value={b.billStatus || "—"} /></td>
                  <td style={{ textAlign: "right" }}>{fmtINR2(b.netAmount ?? b.totalAmount ?? 0)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtINR2(b.advancePaid ?? b.totalPaid ?? 0)}</td>
                  <td>
                    {/* R7ap-F4: route /billing/view/:id deleted — use UHID workflow page */}
                    <button onClick={() => navigate(`/reception-billing/${b.UHID}`)}
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
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   SHIFT / CASHIER — open + close shift + drawer reconciliation
   Phase 1: UI scaffold backed by localStorage so each cashier can
   self-track a session even before the persistent backend ships.
   Phase 2 (TBD): /api/cashier-sessions endpoints.
══════════════════════════════════════════════════════════════ */
// R7ar-P1-10/D6-aq-10: Cashier shift backed by the /api/cashier-sessions
// endpoint (Mongo-persisted, cross-device, audited). Pre-R7ar this tab
// kept the session in localStorage — so a cashier opening on terminal A
// couldn't close from terminal B, and the variance never landed in the
// audit register. The CashierSession backend was built in R7ap-F20 but
// the frontend was left on the localStorage shim until now.
function ShiftTab() {
  const [session,      setSession]      = useState(null);
  const [loadingSess,  setLoadingSess]  = useState(true);
  const [openingCash,  setOpeningCash]  = useState("");
  const [openNotes,    setOpenNotes]    = useState("");
  const [closingCash,  setClosingCash]  = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [varianceNote, setVarianceNote] = useState("");
  const [today,        setToday]        = useState(null);
  const [busy,         setBusy]         = useState(false);

  const refreshSession = async () => {
    setLoadingSess(true);
    try {
      const r = await axios.get(`${API}/cashier-sessions/current`, authHdr());
      setSession(r.data?.data || null);
    } catch (e) {
      // 401/403 surface clean — no session shown
      setSession(null);
    } finally {
      setLoadingSess(false);
    }
  };

  useEffect(() => {
    refreshSession();
    axios.get(`${API}/billing/collection-summary?date=${todayISO()}`, authHdr())
      .then(r => setToday(r.data?.summary))
      .catch(() => {});
  }, []);

  const openShift = async () => {
    if (!openingCash) { toast.error("Enter opening cash"); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API}/cashier-sessions/open`,
        { openingCash: Number(openingCash), openNotes: openNotes || undefined },
        authHdr());
      setSession(r.data?.data || null);
      setOpeningCash("");
      setOpenNotes("");
      toast.success(`Shift opened · opening ${fmtINR(Number(openingCash))}`);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Open shift failed");
    } finally { setBusy(false); }
  };

  const closeShift = async () => {
    if (!session) return;
    if (!closingCash) { toast.error("Enter closing cash"); return; }
    setBusy(true);
    try {
      const r = await axios.post(
        `${API}/cashier-sessions/${session._id}/close`,
        {
          closingCash:  Number(closingCash),
          varianceNote: varianceNote || undefined,
          closeNotes:   closingNotes || undefined,
        },
        authHdr(),
      );
      setSession(null);
      setClosingCash("");
      setClosingNotes("");
      setVarianceNote("");
      const v = Number(r.data?.data?.variance || 0);
      toast.success(`Shift closed · variance ${v >= 0 ? "+" : ""}${fmtINR(v)}`);
    } catch (e) {
      const msg = e?.response?.data?.message || "Close shift failed";
      // Backend asks for varianceNote on > ₹0.50 variance — surface inline
      // instead of just toasting, so the cashier can fix it without losing
      // the closingCash they already typed.
      if (msg.includes("varianceNote")) toast.error("Variance > ₹0.50 — provide a note explaining the difference.");
      else                                toast.error(msg);
    } finally { setBusy(false); }
  };

  const cashCollected = today?.byMode?.find(m => /cash/i.test(m.mode))?.amount || 0;
  const openingCashN = toMoney(session?.openingCash);
  const expectedClosing = session ? openingCashN + cashCollected : 0;
  const variance = closingCash ? Number(closingCash) - expectedClosing : 0;

  return (
    <>
      <Card title="Cashier shift" color={C.teal} icon="pi-user-edit"
        right={session
          ? <Badge value={`Open since ${new Date(session.openedAt).toLocaleTimeString("en-IN")}`} />
          : <Badge value={loadingSess ? "Checking…" : "No active session"} />}>
        {!session ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 10, alignItems: "flex-end" }}>
            <Field label="Opening cash in drawer">
              <input type="number" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)}
                placeholder="e.g. 2000"
                style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontWeight: 700 }} />
            </Field>
            <Field label="Notes (optional)">
              <input value={openNotes} onChange={(e) => setOpenNotes(e.target.value)}
                placeholder="e.g. Morning till — Sunita"
                style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5 }} />
            </Field>
            <PrimaryButton label="Open Shift" icon="pi-play" color={C.teal} onClick={openShift} busy={busy} />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <KPI label="Opening cash"      value={fmtINR(openingCashN)}         color={C.muted}  icon="pi-wallet" />
            <KPI label="Cash collected"    value={fmtINR(cashCollected)}        color={C.green}  icon="pi-money-bill" />
            <KPI label="Expected closing"  value={fmtINR(expectedClosing)}      color={C.blue}   icon="pi-calculator" />
            {closingCash && (
              <KPI label="Variance"          value={`${variance >= 0 ? "+" : ""}${fmtINR(variance)}`}
                color={Math.abs(variance) < 100 ? C.green : C.red} icon="pi-arrow-up-arrow-down" />
            )}
          </div>
        )}
      </Card>

      {session && (
        <div style={{ marginTop: 14 }}>
          <Card title="Close shift" color={C.red} icon="pi-stop">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 12 }}>
              <Field label="Actual cash in drawer">
                <input type="number" value={closingCash} onChange={(e) => setClosingCash(e.target.value)}
                  placeholder="Count the drawer"
                  style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontWeight: 700 }} />
              </Field>
              <Field label="Variance note (required if > ₹0.50 off)">
                <input value={varianceNote} onChange={(e) => setVarianceNote(e.target.value)}
                  placeholder="e.g. ₹500 short — refund #1234 paid without slip"
                  style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5 }} />
              </Field>
              <Field label="General notes (optional)">
                <textarea value={closingNotes} onChange={(e) => setClosingNotes(e.target.value)} rows={2}
                  placeholder="Handover instructions, anything the next shift should know."
                  style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} />
              </Field>
            </div>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
              <PrimaryButton label="Close Shift" icon="pi-stop" color={C.red} onClick={closeShift}
                busy={busy} disabled={!closingCash} />
            </div>
          </Card>
        </div>
      )}

      <ShiftHistory />
    </>
  );
}

function ShiftHistory() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API}/cashier-sessions?limit=30`, authHdr());
        if (!cancelled) setRows(r.data?.data || []);
      } catch (_) {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  if (loading) return null;
  if (!rows.length) return null;
  const num = (v) => toMoney(v);
  return (
    <div style={{ marginTop: 14 }}>
      <Card title="Previous shifts" color={C.muted} icon="pi-history">
        <Table cols={[
          { label: "Cashier" }, { label: "Opened" }, { label: "Closed" },
          { label: "Opening", align: "right" }, { label: "Expected", align: "right" },
          { label: "Closing", align: "right" }, { label: "Variance", align: "right" },
        ]}>
          {rows.map((s) => {
            const variance = num(s.variance);
            const closedAt = s.closedAt ? new Date(s.closedAt) : null;
            return (
              <tr key={s._id}>
                <td style={{ fontSize: 11.5 }}>{s.cashierName || "—"}{s.closedByCron && <Badge value="AUTO" palette={C.amber} />}</td>
                <td style={{ fontSize: 11.5 }}>{new Date(s.openedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td style={{ fontSize: 11.5 }}>{closedAt ? closedAt.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : <Badge value="OPEN" palette={C.green} />}</td>
                <td style={{ textAlign: "right" }}>{fmtINR(num(s.openingCash))}</td>
                <td style={{ textAlign: "right" }}>{fmtINR(num(s.expectedClosing))}</td>
                <td style={{ textAlign: "right" }}>{fmtINR(num(s.closingCash))}</td>
                <td style={{ textAlign: "right", fontWeight: 800, color: Math.abs(variance) < 100 ? C.green : C.red }}>
                  {variance >= 0 ? "+" : ""}{fmtINR(variance)}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   REFUNDS & AUDIT
══════════════════════════════════════════════════════════════ */
function RefundsTab() {
  const navigate = useNavigate();
  const [bills, setBills] = useState([]);
  const [advanceRefunds, setAdvanceRefunds] = useState([]);  // R7ap-F11
  const [creditNotes,    setCreditNotes]    = useState([]);  // R7ar-P1-15
  const [cnTotals,       setCnTotals]       = useState({ total: 0, totalTax: 0 });
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("REFUNDED");
  // R7ap-F11: default 30-day window for the advance-refund register.
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [to,   setTo]   = useState(() => new Date().toISOString().slice(0, 10));

  const refresh = async () => {
    setLoading(true);
    try {
      // Parallel fetch — bill refunds + advance refunds + credit notes.
      // R7at-FIX-15/D9-HIGH-3: thread `from`/`to` into the bills query too
      // so the Refunds tab shows ONE end-of-day picture, not "last 50 ever
      // refunded bills alongside today's CNs". The accountant reconciling
      // 2026-05-21 EOD now sees just that day's outflow.
      const [billRes, advRes, cnRes] = await Promise.all([
        axios.get(`${API}/billing?status=${filter}&limit=200&from=${from}&to=${to}`, authHdr()).catch(() => null),
        axios.get(`${API}/billing/advance/refunds?from=${from}&to=${to}`, authHdr()).catch(() => null),
        axios.get(`${API}/billing/credit-notes?from=${from}&to=${to}`, authHdr()).catch(() => null),
      ]);
      setBills(billRes?.data?.data || billRes?.data?.bills || billRes?.data || []);
      setAdvanceRefunds(advRes?.data?.data || []);
      setCreditNotes(cnRes?.data?.data || []);
      setCnTotals({
        total:    Number(cnRes?.data?.meta?.total || 0),
        totalTax: Number(cnRes?.data?.meta?.totalTax || 0),
      });
    } catch (e) { toast.error("Refunds load failed"); }
    setLoading(false);
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [filter, from, to]);

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
            <Empty icon="pi-inbox" text={`No ${filter.toLowerCase()} bills found.`} />
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
                    {/* R7ap-F4: dead /billing/view/:id route — route to UHID workflow page */}
                    <button onClick={() => navigate(`/reception-billing/${b.UHID}`)}
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

      {/* R7ap-F11: Advance refund register — surfaces R7ao refunds that
          were previously invisible to Accounts. Cashier-drawer reconciliation
          requires this list (NABH ROM.3 refund register). */}
      <div style={{ marginTop: 12 }}>
        <Card title={`Advance refunds · ${from} → ${to}`} color={C.red} icon="pi-wallet"
          right={
            <div style={{ display: "flex", gap: 6 }}>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                style={{ padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
              <input type="date" value={to}   onChange={e => setTo(e.target.value)}
                style={{ padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} />
            </div>
          }>
          {!Array.isArray(advanceRefunds) || advanceRefunds.length === 0 ? (
            <Empty icon="pi-inbox" text={`No advance refunds in ${from} → ${to}.`} />
          ) : (
            <Table cols={[
              { label: "Receipt #" },
              { label: "Patient" },
              { label: "Refunded At" },
              { label: "Mode" },
              { label: "Refunded By" },
              { label: "Reason" },
              { label: "Amount", align: "right" },
              { label: "Action" },
            ]}>
              {advanceRefunds.map((a, i) => (
                <tr key={a._id || i}>
                  <td style={{ fontFamily: "monospace", fontSize: 11.5 }}>{a.receiptNumber}</td>
                  <td style={{ fontWeight: 700 }}>{a.patientId?.fullName || a.UHID}</td>
                  <td style={{ color: C.muted, fontSize: 12 }}>{a.refundedAt ? new Date(a.refundedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  <td><Badge value={a.refundMode || "CASH"} palette={C.purple} /></td>
                  <td style={{ fontSize: 12 }}>{a.refundedBy || "—"}</td>
                  <td style={{ color: C.muted, fontSize: 11.5, maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={a.refundReason}>{a.refundReason || "—"}</td>
                  <td style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", fontWeight: 800, color: C.red }}>{fmtINR2(a.refundedAmount)}</td>
                  <td>
                    <button onClick={() => navigate(`/reception-billing/${a.UHID}`)}
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

      {/* R7ar-P1-15/D6-aq-08: Credit notes register — every GST-Act §34 CN
          emitted on a bill refund. Pre-R7ar these were data-resident only;
          the GST register subtracted them but they had no list view, so
          the accountant couldn't audit which CNs cleared this period. */}
      <div style={{ marginTop: 12 }}>
        <Card title={`Credit notes · ${from} → ${to}`} color={C.purple} icon="pi-file-edit"
          right={
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: C.muted }}>Total <b style={{ color: C.red, fontFamily: "'DM Mono', monospace" }}>{fmtINR2(cnTotals.total)}</b></span>
              <span style={{ fontSize: 12, color: C.muted }}>Tax reversed <b style={{ color: C.red, fontFamily: "'DM Mono', monospace" }}>{fmtINR2(cnTotals.totalTax)}</b></span>
            </div>
          }>
          {!Array.isArray(creditNotes) || creditNotes.length === 0 ? (
            <Empty icon="pi-inbox" text={`No credit notes in ${from} → ${to}.`} />
          ) : (
            <Table cols={[
              { label: "CN #" },
              { label: "Date" },
              { label: "Original Bill" },
              { label: "Patient" },
              { label: "Reason" },
              { label: "Refund Mode" },
              { label: "Taxable", align: "right" },
              { label: "Tax", align: "right" },
              { label: "Refund Total", align: "right" },
              { label: "Status" },
            ]}>
              {creditNotes.map((cn) => (
                <tr key={cn._id}>
                  <td style={{ fontFamily: "monospace", fontSize: 11.5 }}>{cn.creditNoteNumber}</td>
                  <td style={{ color: C.muted, fontSize: 11.5 }}>{cn.creditNoteDate ? new Date(cn.creditNoteDate).toLocaleDateString("en-IN") : "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 11.5 }}>{cn.originalBillNumber}</td>
                  <td style={{ fontWeight: 700 }}>{cn.patientId?.fullName || cn.UHID}</td>
                  <td style={{ color: C.muted, fontSize: 11.5, maxWidth: 240, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={cn.reasonText}>{cn.reasonText || "—"}</td>
                  <td><Badge value={cn.refundMode || "—"} palette={C.purple} /></td>
                  <td style={{ textAlign: "right", fontFamily: "'DM Mono', monospace" }}>{fmtINR2(cn.taxableValue)}</td>
                  <td style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", color: C.red }}>{fmtINR2(cn.taxAmount)}</td>
                  <td style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", fontWeight: 800, color: C.red }}>{fmtINR2(cn.refundAmount)}</td>
                  <td>{cn.periodLocked
                    ? <Badge value="GST LOCKED" palette={C.red} />
                    : <Badge value="OPEN" palette={C.green} />}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <PrimaryButton label="Billing Audit Trail" icon="pi-shield" color={C.teal} onClick={() => navigate("/billing-audit-trail")} />
        <PrimaryButton label="Billing Counter"     icon="pi-list"   color={C.amber} onClick={() => navigate("/reception-billing")} />
      </div>
    </>
  );
}
