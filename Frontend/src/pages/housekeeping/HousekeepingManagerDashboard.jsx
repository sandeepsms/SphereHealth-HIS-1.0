/**
 * HousekeepingManagerDashboard.jsx — KPI page for the housekeeping
 * supervisor / nurse-in-charge.
 *
 * URL: /housekeeping-manager
 */
import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  AdminPage, Hero, KPI, Card, Table, Empty, Badge, PrimaryButton, C,
} from "../../Components/admin-theme";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
const authHdr = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("his_token")}` } });

export default function HousekeepingManagerDashboard() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    setLoading(true);
    try { const r = await axios.get(`${API}/housekeeping/manager-stats?days=${days}`, authHdr()); setData(r.data); }
    catch {}
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [days]);

  const k = data?.kpis || {};
  const lb = data?.leaderboard || [];
  const lowStock = data?.lowStock || [];
  const spill = data?.spillageRecent || [];

  return (
    <AdminPage>
      <Hero icon="pi-chart-bar" color="teal"
        title="Housekeeping — Manager View"
        subtitle="Team KPIs · leaderboard · inventory alerts · spillage feed · compliance %" />

      <Card title="Window" color={C.teal} icon="pi-calendar"
        right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.teal} onClick={refresh} busy={loading} />}>
        <div style={{ display: "flex", gap: 8 }}>
          {[1, 7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              style={{ padding: "5px 14px", borderRadius: 999, border: `1.5px solid ${d === days ? C.teal : C.border}`, background: d === days ? C.teal + "15" : "#fff", color: d === days ? C.teal : C.muted, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
              Last {d} day{d === 1 ? "" : "s"}
            </button>
          ))}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, margin: "14px 0" }}>
        <KPI label="Tasks done"          value={k.tasksDone ?? "—"}            color={C.green}  icon="pi-check-circle" />
        <KPI label="Compliance %"        value={k.checklistCompliancePct != null ? `${k.checklistCompliancePct}%` : "—"} color={(k.checklistCompliancePct || 0) < 80 ? C.red : C.green} icon="pi-percentage" />
        <KPI label="Checklists logged"   value={k.checklistTotal ?? "—"}       color={C.blue}   icon="pi-check-square" />
        <KPI label="Spillage events"     value={k.spillageCount ?? "—"}        color={C.amber}  icon="pi-exclamation-triangle" />
        <KPI label="Low-stock products"  value={k.lowStockCount ?? "—"}        color={(k.lowStockCount || 0) > 0 ? C.red : C.muted} icon="pi-box" />
        <KPI label="Pest overdue"        value={k.pestOverdue ?? "—"}          color={(k.pestOverdue || 0) > 0 ? C.red : C.muted} icon="pi-shield" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card title="Team leaderboard" color={C.green} icon="pi-trophy">
          {lb.length === 0 ? <Empty icon="pi-trophy" text="No completions in window." /> : (
            <Table cols={[{ label: "#" }, { label: "Name" }, { label: "Done", align: "right" }, { label: "Urgent", align: "right" }, { label: "Avg min", align: "right" }]}>
              {lb.map((u, i) => (
                <tr key={u.userId}>
                  <td style={{ fontWeight: 800, color: C.muted, width: 28 }}>#{i + 1}</td>
                  <td style={{ fontWeight: 700 }}>{u.name}</td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{u.completed}</td>
                  <td style={{ textAlign: "right", color: u.urgent > 0 ? C.red : C.muted }}>{u.urgent || 0}</td>
                  <td style={{ textAlign: "right", color: u.avgMinutes > 30 ? C.amber : C.green }}>{u.avgMinutes}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title={`Low-stock alerts (${lowStock.length})`} color={C.red} icon="pi-exclamation-triangle">
          {lowStock.length === 0 ? <Empty icon="pi-check" text="All products above reorder level." /> : (
            <Table cols={[{ label: "Product" }, { label: "Stock", align: "right" }, { label: "Reorder at", align: "right" }]}>
              {lowStock.map((p, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{p.productName}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: C.red }}>{p.currentStock} {p.unit}</td>
                  <td style={{ textAlign: "right", color: C.muted }}>{p.reorderLevel} {p.unit}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 14 }}>
        <Card title="Recent spillage" color={C.amber} icon="pi-exclamation-triangle">
          {spill.length === 0 ? <Empty icon="pi-shield" text="No spillage events in window." /> : (
            <Table cols={[{ label: "When" }, { label: "Area" }, { label: "Type" }, { label: "Volume" }, { label: "Status" }]}>
              {spill.map((s, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 11.5 }}>{new Date(s.reportedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td style={{ fontWeight: 700 }}>{s.area}</td>
                  <td><Badge value={(s.type || "").toUpperCase()} /></td>
                  <td>{s.volumeEst}</td>
                  <td><Badge value={(s.status || "").toUpperCase()} /></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </AdminPage>
  );
}
