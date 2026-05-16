/**
 * WardManagerDashboard.jsx — KPI page for the ward in-charge nurse /
 * admin to monitor ward boy operations across the team.
 *
 * URL: /ward-manager
 *
 * Sections:
 *   • KPI strip          tasks done / shifts active / equipment out /
 *                        code-blue count / avg code-blue delay /
 *                        mortuary pending
 *   • Leaderboard table  per-ward-boy completed task count + avg time
 *   • Active shifts      who's clocked in right now + on-break flag
 *   • Recent code-blues  last 10 alerts with location + outcome
 */
import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  AdminPage, Hero, KPI, Card, Table, Empty, Badge, PrimaryButton, C,
} from "../../Components/admin-theme";

import { API_BASE_URL as API } from "../../config/api";
const authHdr = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("his_token")}` } });

export default function WardManagerDashboard() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/ward-ops/manager-stats?days=${days}`, authHdr());
      setData(r.data);
    } catch (e) {}
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [days]);

  const k = data?.kpis || {};
  const lb = data?.leaderboard || [];
  const shifts = data?.activeShifts || [];
  const codeBlues = data?.codeBlueRecent || [];

  return (
    <AdminPage>
      <Hero icon="pi-chart-bar" color="blue"
        title="Ward Operations — Manager View"
        subtitle="Team KPIs · leaderboard · active shifts · code-blue response" />

      <Card title="Window" color={C.blue} icon="pi-calendar"
        right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.blue} onClick={refresh} busy={loading} />}>
        <div style={{ display: "flex", gap: 8 }}>
          {[1, 7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              style={{
                padding: "5px 14px", borderRadius: 999,
                border: `1.5px solid ${d === days ? C.blue : C.border}`,
                background: d === days ? C.blue + "15" : "#fff",
                color: d === days ? C.blue : C.muted,
                fontWeight: 800, fontSize: 12, cursor: "pointer",
              }}>Last {d} day{d === 1 ? "" : "s"}</button>
          ))}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, margin: "14px 0" }}>
        <KPI label="Tasks completed"     value={k.tasksDone ?? "—"}             color={C.green}  icon="pi-check-circle" />
        <KPI label="Active shifts"       value={k.activeShiftCount ?? "—"}      color={C.blue}   icon="pi-user-edit" />
        <KPI label="Equipment out"       value={k.equipmentOutstanding ?? "—"}  color={C.purple} icon="pi-cog" />
        <KPI label="Equipment overdue"   value={k.equipmentOverdue ?? "—"}      color={(k.equipmentOverdue || 0) > 0 ? C.red : C.muted} icon="pi-exclamation-triangle" />
        <KPI label="Code Blue events"    value={k.codeBlueCount ?? "—"}         color={C.red}    icon="pi-bolt" />
        <KPI label="Avg arrival (s)"     value={k.avgCodeBlueDelaySec ?? "—"}   color={(k.avgCodeBlueDelaySec || 0) > 120 ? C.red : C.green} icon="pi-stopwatch" />
        <KPI label="Mortuary pending"    value={k.mortuaryPending ?? "—"}       color={C.muted}  icon="pi-shield" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Leaderboard */}
        <Card title="Team leaderboard (by completed)" color={C.green} icon="pi-trophy">
          {lb.length === 0 ? (
            <Empty icon="pi-trophy" text="No completed tasks in this window." />
          ) : (
            <Table cols={[
              { label: "#" }, { label: "Ward Boy" },
              { label: "Done", align: "right" }, { label: "Urgent", align: "right" },
              { label: "Avg min", align: "right" },
            ]}>
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

        {/* Active shifts */}
        <Card title={`Active shifts (${shifts.length})`} color={C.blue} icon="pi-clock">
          {shifts.length === 0 ? (
            <Empty icon="pi-clock" text="No ward boys clocked in." />
          ) : (
            <Table cols={[
              { label: "Ward Boy" }, { label: "Ward" }, { label: "Started" }, { label: "Active min", align: "right" }, { label: "State" },
            ]}>
              {shifts.map((s, i) => {
                const liveMin = Math.floor((Date.now() - new Date(s.startedAt)) / 60000);
                const onBreak = s.breaks?.length && !s.breaks[s.breaks.length - 1].endedAt;
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 700 }}>{s.userName}</td>
                    <td>{s.ward || "—"}</td>
                    <td style={{ fontSize: 11.5, color: C.muted }}>{new Date(s.startedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td style={{ textAlign: "right", fontWeight: 800 }}>{liveMin}</td>
                    <td><Badge value={onBreak ? "ON BREAK" : "ACTIVE"} /></td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 14 }}>
        <Card title="Recent Code Blue events" color={C.red} icon="pi-bolt">
          {codeBlues.length === 0 ? (
            <Empty icon="pi-shield" text="No code blue events in this window." />
          ) : (
            <Table cols={[
              { label: "When" }, { label: "Location" }, { label: "Delay (s)", align: "right" }, { label: "Outcome" },
            ]}>
              {codeBlues.map((e, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 11.5 }}>{new Date(e.alertedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td style={{ fontWeight: 700 }}>{e.location}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: e.arrivalDelaySec > 120 ? C.red : C.green }}>
                    {e.arrivalDelaySec ?? "—"}
                  </td>
                  <td><Badge value={(e.outcome || "ongoing").replace(/-/g, " ").toUpperCase()} /></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </AdminPage>
  );
}
