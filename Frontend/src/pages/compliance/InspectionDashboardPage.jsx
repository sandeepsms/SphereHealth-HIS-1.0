/**
 * InspectionDashboardPage.jsx — R7ek
 *
 * Extracted from NABHRegistersDashboard.jsx (R7bo). The dashboard summary
 * KPI view + Register Status table now lives on its own sidebar entry
 * under Quality & Compliance, separating "what's happening today" (this
 * page) from "drill into a specific register's log" (NABH Registers tile
 * landing page).
 *
 *   URL: /compliance/inspection-dashboard
 *
 * Backed by GET /registers/nabh/dashboard-summary. Read-only — the "Open
 * →" buttons deep-link into /compliance/nabh-registers#<register-id>,
 * which auto-selects that register on the landing page.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, KPI, Card, Table, Empty, Badge, C,
} from "../../Components/admin-theme";
import { API_BASE_URL as API } from "../../config/api";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

const fmt = (d) =>
  d ? new Date(d).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  }) : "—";

const tdStyle = {
  padding: "8px 12px",
  borderBottom: `1px solid ${C.border}`,
  fontSize: 12,
};

export default function InspectionDashboardPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(
        `${API}/registers/nabh/dashboard-summary`,
        authHdr(),
      );
      setSummary(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load dashboard");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const kpis = summary.map((s) => ({
    label: s.name,
    value: s.todayCount,
    sub: `7d: ${s.sevenDayCount} · NABH ${s.nabhRef}`,
  }));

  // Live registers (7 inline-view ones) live behind the NABH Registers tile
  // landing page with hash deep-linking; the rest (OT/ASA/Readmission/
  // Mortality/Restraint/Antimicrobial) have their own dedicated pages —
  // for those we use the backend-provided `route` field on each summary row.
  const LIVE_HASH_IDS = new Set([
    "blood-sugar", "emergency", "blood-transfusion",
    "pain", "fall-risk", "pressure-ulcer", "dvt",
  ]);
  const openRegister = (row) => {
    if (LIVE_HASH_IDS.has(row.id)) {
      navigate(`/compliance/nabh-registers#${row.id}`);
    } else if (row.route) {
      navigate(row.route);
    } else {
      navigate(`/compliance/nabh-registers#${row.id}`);
    }
  };

  return (
    <AdminPage>
      <Hero
        icon="pi-chart-bar"
        title="Inspection Dashboard"
        subtitle="Today's NABH register activity — surveyor-ready at a glance"
        color="teal"
      />

      {kpis.length > 0 && <KPI items={kpis} />}

      <Card title="Register Status">
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, marginTop: -4 }}>
          Auto-populated chronological logs. Click "Open →" to drill into a register.
        </div>
        {summary.length === 0 ? (
          <Empty text={loading ? "Loading…" : "No registers configured"} />
        ) : (
          <Table cols={["Register", "NABH Ref", "Today", "Last 7d", "Last Entry", "Action"]}>
            {summary.map((r) => (
              <tr key={r.id}>
                <td style={tdStyle}><strong>{r.name}</strong></td>
                <td style={tdStyle}><Badge value={r.nabhRef} palette="blue" /></td>
                <td style={tdStyle}><strong>{r.todayCount}</strong></td>
                <td style={tdStyle}>{r.sevenDayCount}</td>
                <td style={tdStyle}>{fmt(r.lastEntryAt)}</td>
                <td style={tdStyle}>
                  <button
                    onClick={() => openRegister(r)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: `1px solid ${C.teal}`,
                      background: "#fff",
                      color: C.teal,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >Open →</button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </AdminPage>
  );
}
