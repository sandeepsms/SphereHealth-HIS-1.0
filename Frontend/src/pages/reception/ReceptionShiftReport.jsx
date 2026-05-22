/**
 * ReceptionShiftReport.jsx — R7bb-FIX-E-6 / D6-CRIT-3
 *
 * Receptionist-facing wrapper for the cashier shift management content.
 * The Accounts console at /accounts is gated to Admin/Accountant only —
 * Receptionists who need to open / close their cash drawer were never
 * able to reach it, leaving the audit register incomplete for any
 * Receptionist who collected cash (most desks).
 *
 * Exposed at /reception/closing-report so Receptionist + Accountant +
 * Admin can use it. The underlying /api/cashier-sessions endpoints
 * already enforce the per-cashier "only close your own" guard; this
 * page is a UI-only addition.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, Card, KPI, Field, Badge, Table,
  PrimaryButton, C,
} from "../../Components/admin-theme";
import { API_BASE_URL as API } from "../../config/api";
import { toMoney, fmtINR0 as fmtINR } from "../../utils/money";
import ErrorBoundary from "../../Components/ErrorBoundary";

const authHdr = () => ({
  headers: {
    Authorization: `Bearer ${sessionStorage.getItem("his_token") || localStorage.getItem("his_token")}`,
  },
});
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ReceptionShiftReport() {
  const navigate = useNavigate();
  return (
    <AdminPage>
      <Hero
        icon="pi-user-edit"
        color="teal"
        title="Closing Report / Cashier Shift"
        subtitle="Open + close your cash drawer, reconcile variance, hand over to the next shift"
      />
      <div style={{ marginTop: 16 }}>
        <ErrorBoundary label="Shift report">
          <ShiftBlock />
        </ErrorBoundary>
      </div>
      <div style={{ marginTop: 14 }}>
        <PrimaryButton
          label="Back to Dashboard"
          icon="pi-arrow-left"
          color={C.muted}
          onClick={() => navigate("/reception")}
        />
      </div>
    </AdminPage>
  );
}

function ShiftBlock() {
  const [session, setSession]         = useState(null);
  const [loadingSess, setLoadingSess] = useState(true);
  const [openingCash, setOpeningCash] = useState("");
  const [openNotes, setOpenNotes]     = useState("");
  const [closingCash, setClosingCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [varianceNote, setVarianceNote] = useState("");
  const [today, setToday]             = useState(null);
  const [busy, setBusy]               = useState(false);

  const refreshSession = async (signal) => {
    setLoadingSess(true);
    try {
      const r = await axios.get(`${API}/cashier-sessions/current`, { ...authHdr(), signal });
      if (!signal || !signal.aborted) setSession(r.data?.data || null);
    } catch (e) {
      if (!signal || !signal.aborted) setSession(null);
    } finally {
      if (!signal || !signal.aborted) setLoadingSess(false);
    }
  };

  useEffect(() => {
    const ctrl = new AbortController();
    refreshSession(ctrl.signal);
    // R7bh-F1 / META-4 (R7bg-6-CRIT-5): switched to /api/reports/
    // day-book — its byMode list is the reversal-aware view (voided
    // refunds netted back IN). This page only reads byMode for the
    // "cash collected today" tile, so we project the new payload's
    // summary + byMode into the legacy shape the consumer expects.
    axios
      .get(`${API}/reports/day-book?date=${todayISO()}`, { ...authHdr(), signal: ctrl.signal })
      .then((r) => {
        if (ctrl.signal.aborted) return;
        const d = r.data?.data || {};
        setToday({
          // Pre-existing consumer reads `today.byMode` for cash slice.
          byMode: d.byMode || [],
          // Keep totalCollected available for any future tiles.
          totalCollected: d.summary?.collections,
          txnCount:       d.summary?.collectionsCount,
        });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const openShift = async () => {
    if (!openingCash) { toast.error("Enter opening cash"); return; }
    setBusy(true);
    try {
      const r = await axios.post(
        `${API}/cashier-sessions/open`,
        { openingCash: Number(openingCash), openNotes: openNotes || undefined },
        authHdr(),
      );
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
      const v = Number(r.data?.data?.variance || 0);
      const pending = r.data?.data?.closeApprovalPending;
      setSession(null);
      setClosingCash("");
      setClosingNotes("");
      setVarianceNote("");
      if (pending) {
        toast.warn(`Shift closed · variance ${v >= 0 ? "+" : ""}${fmtINR(v)} — pending Admin sign-off`);
      } else {
        toast.success(`Shift closed · variance ${v >= 0 ? "+" : ""}${fmtINR(v)}`);
      }
    } catch (e) {
      const msg = e?.response?.data?.message || "Close shift failed";
      if (msg.includes("varianceNote")) toast.error("Variance > ₹0.50 — provide a note explaining the difference.");
      else                                toast.error(msg);
    } finally { setBusy(false); }
  };

  const cashCollected = today?.byMode?.find((m) => /cash/i.test(m.mode))?.amount || 0;
  const openingCashN = toMoney(session?.openingCash);
  const expectedClosing = session ? openingCashN + cashCollected : 0;
  const variance = closingCash ? Number(closingCash) - expectedClosing : 0;

  return (
    <>
      <Card
        title="Cashier shift"
        color={C.teal}
        icon="pi-user-edit"
        right={
          session
            ? <Badge value={`Open since ${new Date(session.openedAt).toLocaleTimeString("en-IN")}`} />
            : <Badge value={loadingSess ? "Checking…" : "No active session"} />
        }
      >
        {!session ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 10, alignItems: "flex-end" }}>
            <Field label="Opening cash in drawer">
              <input
                type="number"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                placeholder="e.g. 2000"
                style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontWeight: 700 }}
              />
            </Field>
            <Field label="Notes (optional)">
              <input
                value={openNotes}
                onChange={(e) => setOpenNotes(e.target.value)}
                placeholder="e.g. Morning till — Sunita"
                style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5 }}
              />
            </Field>
            <PrimaryButton label="Open Shift" icon="pi-play" color={C.teal} onClick={openShift} busy={busy} />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <KPI label="Opening cash"     value={fmtINR(openingCashN)}     color={C.muted} icon="pi-wallet" />
            <KPI label="Cash collected"   value={fmtINR(cashCollected)}    color={C.green} icon="pi-money-bill" />
            <KPI label="Expected closing" value={fmtINR(expectedClosing)}  color={C.blue}  icon="pi-calculator" />
            {closingCash && (
              <KPI
                label="Variance"
                value={`${variance >= 0 ? "+" : ""}${fmtINR(variance)}`}
                color={Math.abs(variance) < 100 ? C.green : C.red}
                icon="pi-arrow-up-arrow-down"
              />
            )}
          </div>
        )}
      </Card>

      {session && (
        <div style={{ marginTop: 14 }}>
          <Card title="Close shift" color={C.red} icon="pi-stop">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 12 }}>
              <Field label="Actual cash in drawer">
                <input
                  type="number"
                  value={closingCash}
                  onChange={(e) => setClosingCash(e.target.value)}
                  placeholder="Count the drawer"
                  style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, fontWeight: 700 }}
                />
              </Field>
              <Field label="Variance note (required if > ₹0.50 off)">
                <input
                  value={varianceNote}
                  onChange={(e) => setVarianceNote(e.target.value)}
                  placeholder="e.g. ₹500 short — refund #1234 paid without slip"
                  style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5 }}
                />
              </Field>
              <Field label="General notes (optional)">
                <textarea
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  rows={2}
                  placeholder="Handover instructions, anything the next shift should know."
                  style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }}
                />
              </Field>
            </div>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
              <PrimaryButton label="Close Shift" icon="pi-stop" color={C.red} onClick={closeShift} busy={busy} disabled={!closingCash} />
            </div>
          </Card>
        </div>
      )}

      <ShiftHistory />
    </>
  );
}

function ShiftHistory() {
  const [rows, setRows]       = useState([]);
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
        <Table
          cols={[
            { label: "Cashier" }, { label: "Opened" }, { label: "Closed" },
            { label: "Opening", align: "right" }, { label: "Expected", align: "right" },
            { label: "Closing", align: "right" }, { label: "Variance", align: "right" },
            { label: "Approval" },
          ]}
        >
          {rows.map((s) => {
            const variance = num(s.variance);
            const closedAt = s.closedAt ? new Date(s.closedAt) : null;
            return (
              <tr key={s._id}>
                <td style={{ fontSize: 11.5 }}>
                  {s.cashierName || "—"}
                  {s.closedByCron && <Badge value="AUTO" palette={C.amber} />}
                </td>
                <td style={{ fontSize: 11.5 }}>
                  {new Date(s.openedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td style={{ fontSize: 11.5 }}>
                  {closedAt
                    ? closedAt.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                    : <Badge value="OPEN" palette={C.green} />}
                </td>
                <td style={{ textAlign: "right" }}>{fmtINR(num(s.openingCash))}</td>
                <td style={{ textAlign: "right" }}>{fmtINR(num(s.expectedClosing))}</td>
                <td style={{ textAlign: "right" }}>{fmtINR(num(s.closingCash))}</td>
                <td style={{ textAlign: "right", fontWeight: 800, color: Math.abs(variance) < 100 ? C.green : C.red }}>
                  {variance >= 0 ? "+" : ""}{fmtINR(variance)}
                </td>
                <td>
                  {s.closeApprovalPending
                    ? <Badge value="PENDING" palette={C.amber} />
                    : s.closeApprovedBy
                      ? <span style={{ fontSize: 11, color: C.muted }}>✓ {s.closeApprovedBy}</span>
                      : <span style={{ fontSize: 11, color: C.muted }}>—</span>}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
