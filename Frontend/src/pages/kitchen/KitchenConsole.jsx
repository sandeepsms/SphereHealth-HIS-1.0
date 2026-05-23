/**
 * KitchenConsole.jsx — R7bj-F2 / R7bi-1-CRIT-13 close-loop UI.
 *
 * URL: /kitchen   (query ?tab=pending|served|delivered)
 *
 * Three pill tabs:
 *   1. Today's Indents  — PENDING + PREPARED. Mark Prepared / Mark
 *                         Served buttons.
 *   2. Served Today     — SERVED rows (kitchen tray dispatched; Ward
 *                         Boy delivery pending). Visible for context
 *                         only on this console; the Ward Boy claims
 *                         them from the Ward Boy delivery queue.
 *   3. Delivered        — DELIVERED rows. Chain-of-custody closed.
 *
 * Backend: /api/kitchen-indent — gated by kitchen.indent.read +
 * kitchen.indent.write (F-coord wires the permission map).
 *
 * Token: sessionStorage only — R7bj-F2 instruction explicitly bans
 * the localStorage fallback that older consoles still use.
 */
import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, TabStrip, KPI, Card, Table, EmptyRow, Badge,
  PrimaryButton, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";
import { useVisiblePoll } from "../../utils/pollingHelpers";
import { API_BASE_URL as API } from "../../config/api";

// R7bj-F2 — sessionStorage-only auth header. No localStorage fallback.
const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token") || ""}` },
});

const MEAL_LABEL = {
  EARLY_MORNING:   "Early Morning",
  BREAKFAST:       "Breakfast",
  MID_MORNING:     "Mid-Morning",
  LUNCH:           "Lunch",
  AFTERNOON_SNACK: "Afternoon Snack",
  DINNER:          "Dinner",
  BEDTIME:         "Bedtime",
  RT_FEED:         "RT Feed",
  OTHER:           "Other",
};
const STATUS_PALETTE = {
  PENDING:   "amber",
  PREPARED:  "blue",
  SERVED:    "purple",
  DELIVERED: "green",
  CANCELLED: "red",
};

const fmtTime = (d) => d
  ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
  : "—";
const fmtDateTime = (d) => d
  ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
  : "—";

// Per-button refinement — page is gated by kitchen.indent.read in
// App.jsx (F-coordinator wires that). Buttons gate on the .write
// action so an observer (e.g. Dietician auditing) can see the queue
// without seeing the CTAs the backend would 403.
function useCanWriteKitchen() {
  const { can } = useAuth();
  return typeof can === "function" ? can("kitchen.indent.write") : false;
}

export default function KitchenConsole() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "pending");
  useEffect(() => {
    if (params.get("tab") !== tab) setParams({ tab }, { replace: true });
  }, [tab]);  // eslint-disable-line react-hooks/exhaustive-deps

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const canWrite = useCanWriteKitchen();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The pending tab needs PENDING + PREPARED; the others are
      // single-status. We fetch with a status filter only when the
      // tab maps to a single status — otherwise we fetch everything
      // for today and filter client-side.
      const qs = new URLSearchParams();
      if (tab === "served")    qs.set("status", "SERVED");
      if (tab === "delivered") qs.set("status", "DELIVERED");
      const r = await axios.get(`${API}/kitchen-indent?${qs.toString()}`, authHdr());
      let data = r.data?.data || [];
      if (tab === "pending") {
        data = data.filter((d) => d.status === "PENDING" || d.status === "PREPARED");
      }
      setRows(data);
    } catch (e) {
      // Soft-fail — keep the previous list rather than wiping the UI
      // on a transient 401 / network blip. Toasting once is enough.
      if (e?.response?.status === 403) {
        toast.error("Access denied — kitchen.indent.read permission missing");
      } else if (e?.response?.status >= 500) {
        toast.error("Kitchen indent load failed — retrying");
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  // 15-second visibility-gated poll per R7bj-F2 spec.
  useVisiblePoll(load, 15000, [tab]);

  const counts = {
    pending:   rows.filter((r) => r.status === "PENDING" || r.status === "PREPARED").length,
    served:    rows.filter((r) => r.status === "SERVED").length,
    delivered: rows.filter((r) => r.status === "DELIVERED").length,
  };

  const transition = async (id, action, label) => {
    try {
      await axios.put(`${API}/kitchen-indent/${id}/${action}`, {}, authHdr());
      toast.success(label);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || `Could not ${label.toLowerCase()}`);
      load();
    }
  };

  return (
    <AdminPage>
      <Hero icon="pi-shopping-bag" color="orange"
        title="Kitchen Console"
        subtitle="Today's diet indents · prepare → serve → deliver" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
        <KPI label="Pending + Prepared" value={counts.pending}   color={C.amber}  icon="pi-clock" />
        <KPI label="Served (awaiting delivery)" value={counts.served}    color={C.purple} icon="pi-send" />
        <KPI label="Delivered today" value={counts.delivered} color={C.green}  icon="pi-check-circle" />
      </div>

      <TabStrip
        value={tab}
        onChange={setTab}
        accent={C.orange}
        accentL="#fff7ed"
        tabs={[
          { id: "pending",   label: "Today's Indents", icon: "pi-list", badge: counts.pending },
          { id: "served",    label: "Served Today",    icon: "pi-send", badge: counts.served },
          { id: "delivered", label: "Delivered",       icon: "pi-check-circle", badge: counts.delivered },
        ]}
      />

      <div style={{ marginTop: 16 }}>
        <Card
          title={tab === "pending" ? "Pending + Prepared" : tab === "served" ? "Served" : "Delivered"}
          color={C.orange}
          icon="pi-list"
          right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.orange} onClick={load} busy={loading} />}
        >
          <Table cols={["Time", "Patient", "Bed / Ward", "Meal", "Items", "Allergens", "Status", "Actions"]}>
            {rows.length === 0 && <EmptyRow span={8} text="No indents in this view" />}
            {rows.map((r) => (
              <tr key={r._id}>
                <td>{fmtTime(r.scheduledFor)}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.patientName || "—"}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{r.UHID}</div>
                </td>
                <td>
                  <div>{r.bedNumber || "—"}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{r.ward || ""}</div>
                </td>
                <td>{MEAL_LABEL[r.mealSlot] || r.mealSlotLabel || r.mealSlot}</td>
                <td style={{ maxWidth: 260, whiteSpace: "normal" }}>
                  {(r.items || []).join(", ") || <span style={{ color: "#94a3b8" }}>—</span>}
                </td>
                <td style={{ maxWidth: 200, whiteSpace: "normal" }}>
                  {(r.allergens || []).length > 0
                    ? <span style={{ color: "#b91c1c", fontWeight: 600 }}>{r.allergens.join(", ")}</span>
                    : <span style={{ color: "#94a3b8" }}>—</span>}
                </td>
                <td><Badge value={r.status} palette={STATUS_PALETTE[r.status] || "muted"} /></td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {canWrite && r.status === "PENDING" && (
                      <PrimaryButton label="Mark Prepared" icon="pi-flag"
                        color={C.blue}
                        onClick={() => transition(r._id, "mark-prepared", "Marked Prepared")}
                      />
                    )}
                    {canWrite && r.status === "PREPARED" && (
                      <PrimaryButton label="Mark Served" icon="pi-send"
                        color={C.purple}
                        onClick={() => transition(r._id, "mark-served", "Marked Served")}
                      />
                    )}
                    {r.status === "SERVED" && (
                      <span style={{ fontSize: 11, color: "#7c3aed" }}>
                        Awaiting Ward Boy delivery
                      </span>
                    )}
                    {r.status === "DELIVERED" && r.deliveredAt && (
                      <span style={{ fontSize: 11, color: "#059669" }}>
                        Delivered {fmtDateTime(r.deliveredAt)} · {r.deliveredByName || "—"}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </AdminPage>
  );
}
