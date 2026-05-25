/**
 * PatientCreditLedger.jsx — shared "bills with balance due" card.
 *
 * Renders the patient-credit aging list that originated in AccountsConsole's
 * Outstanding tab. Extracted into its own component so the same card can be
 * mounted on the Receptionist landing without copy-paste maintenance.
 *
 * Props
 *   rows         — Array of {billNumber, UHID, patientName, ageDays, bucket,
 *                            gross, paid, due, status, createdAt}
 *                  (the `patientCredit` shape returned by /api/billing/aging).
 *   onOpenBill   — (row) => void.  Fires when the cashier clicks Open on a
 *                  row.  Defaults to navigating to /reception-billing/:UHID
 *                  via react-router if not provided.
 *   onCollectAll — ({ UHID, billIds, totalDue }) => void.  Fires when the
 *                  receptionist clicks "Collect All for Patient" with one or
 *                  more rows selected.  Optional — when omitted the
 *                  selection footer hides the button.
 *   selectable   — boolean (default true).  When false, leading checkbox
 *                  column is hidden — used by AccountsConsole, which only
 *                  needs the read-only ledger view.
 *   maxRows      — integer (default 10).  Trims the list to keep the
 *                  receptionist landing compact.  Pass 30 from AccountsConsole
 *                  to preserve the legacy listing.
 *
 * Selection contract
 *   The receptionist may multi-select rows only when every selected row
 *   belongs to the SAME UHID.  As soon as one row is checked the other
 *   UHIDs are visually disabled and their checkboxes are inert — this
 *   enforces the rule that a single Collect-All transaction always lands on
 *   one patient.  A hint banner under the table header reminds the user
 *   why some rows are now greyed out.
 *
 *   Selection state lives in this component so the parent only learns about
 *   the final {billIds, totalDue, UHID} tuple via onCollectAll.
 */

import React, { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Table, Empty, Badge, C } from "../admin-theme";
import { fmtINR2 } from "../../utils/money";

export default function PatientCreditLedger({
  rows = [],
  onOpenBill,
  onCollectAll,
  selectable = true,
  maxRows = 10,
}) {
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Clip the list once — the same slice drives both the table render and
  // the lookup map used by the selection footer.  Without slicing here the
  // user could check a row that later vanishes when the dataset shrinks.
  const visibleRows = useMemo(() => rows.slice(0, maxRows), [rows, maxRows]);

  // Build a fast id→row map keyed off bill number.  Bill-id is what we
  // expose to the parent (not the array index) so the selection survives
  // a refetch that reorders the rows.
  const rowById = useMemo(() => {
    const m = new Map();
    for (const r of visibleRows) m.set(r.billNumber, r);
    return m;
  }, [visibleRows]);

  // Drop stale selections whenever the dataset changes — a refetch after a
  // Collect-All can remove the just-paid rows, and we don't want the
  // footer to keep counting bills that no longer exist.
  useEffect(() => {
    if (!selectedIds.size) return;
    let dirty = false;
    const next = new Set();
    for (const id of selectedIds) {
      if (rowById.has(id)) next.add(id);
      else dirty = true;
    }
    if (dirty) setSelectedIds(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowById]);

  // The UHID anchor — once the user checks the first row, every other
  // UHID gets locked out.  Computed by reading the FIRST selected row
  // (Sets keep insertion order, so this is deterministic).
  const lockedUHID = useMemo(() => {
    if (!selectedIds.size) return null;
    const firstId = selectedIds.values().next().value;
    return rowById.get(firstId)?.UHID || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, rowById]);

  const selectedRows = useMemo(
    () => visibleRows.filter((r) => selectedIds.has(r.billNumber)),
    [visibleRows, selectedIds],
  );
  const selectedTotal = useMemo(
    () => selectedRows.reduce((s, r) => s + Number(r.due || 0), 0),
    [selectedRows],
  );

  const toggleRow = (row) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(row.billNumber)) next.delete(row.billNumber);
      else next.add(row.billNumber);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleOpen = (row) => {
    if (typeof onOpenBill === "function") return onOpenBill(row);
    // Default: open the Reception Billing Counter for the patient (mirrors
    // the legacy AccountsConsole behaviour — R7ap-F4).
    if (row.UHID) navigate(`/reception-billing/${row.UHID}`);
  };

  const handleCollectAll = () => {
    if (!lockedUHID || !selectedRows.length) return;
    if (typeof onCollectAll === "function") {
      onCollectAll({
        UHID: lockedUHID,
        billIds: selectedRows.map((r) => r.billNumber),
        totalDue: selectedTotal,
        rows: selectedRows,
      });
      return;
    }
    // Default: deep-link to Reception Billing Counter with ?action=collect-all
    // — the counter holds the BulkCollectModal which pulls every open bill
    // for the UHID and runs the FIFO collection.  We pass the UHID via the
    // URL param; the modal still posts to /billing/uhid/:uhid/collect-all
    // backend-side, so passing individual bill IDs is unnecessary (the
    // bulk endpoint is patient-scoped).
    navigate(`/reception-billing/${lockedUHID}?action=collect-all`);
  };

  /* ─── Column definitions ─── */
  // Leading checkbox column is added dynamically so AccountsConsole's
  // legacy read-only view stays untouched (selectable=false there).
  const cols = [
    ...(selectable ? [{ label: "" }] : []),
    { label: "Bill #" }, { label: "Patient" }, { label: "Age" },
    { label: "Bucket" }, { label: "Gross", align: "right" }, { label: "Paid", align: "right" },
    { label: "Due", align: "right" }, { label: "Action" },
  ];

  const cardTitle = `Patient credit ledger · ${rows.length} bill${rows.length === 1 ? "" : "s"} with balance due`;

  return (
    <Card title={cardTitle} color={C.red} icon="pi-exclamation-circle">
      {!rows.length ? (
        <Empty icon="pi-money-bill" text="No patient credit outstanding. All non-TPA bills are paid in full." />
      ) : (
        <>
          {/* UHID-lock hint banner — only shows once the receptionist has
              checked their first row.  Tells them why the rest of the rows
              are now greyed out and gives the patient identifier they're
              committed to. */}
          {selectable && lockedUHID && (
            <div style={{
              padding: "8px 12px", marginBottom: 8,
              background: C.amberL || "#fffbeb",
              border: `1px solid ${C.amber}30`,
              borderRadius: 6,
              fontSize: 11.5, fontWeight: 600, color: C.amber,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <i className="pi pi-info-circle" />
              <span>
                Select more bills for <strong style={{ fontFamily: "monospace" }}>{lockedUHID}</strong> — different patients can't be combined in one collection.
              </span>
            </div>
          )}

          <Table cols={cols}>
            {visibleRows.map((b, i) => {
              const checked = selectedIds.has(b.billNumber);
              // A row is disabled when (a) another patient is already
              // anchored AND (b) this row belongs to a different patient.
              // The currently-anchored patient's rows stay clickable so
              // the cashier can toggle them off again.
              const locked = Boolean(lockedUHID) && lockedUHID !== b.UHID;
              return (
                <tr key={b.billNumber || i} style={locked ? { opacity: 0.4 } : undefined}>
                  {selectable && (
                    <td style={{ width: 28, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={locked}
                        onChange={() => toggleRow(b)}
                        title={locked
                          ? `Locked — already selecting bills for ${lockedUHID}`
                          : `Select bill ${b.billNumber}`}
                        style={{ cursor: locked ? "not-allowed" : "pointer" }}
                      />
                    </td>
                  )}
                  <td style={{ fontFamily: "monospace", fontSize: 11.5 }}>{b.billNumber}</td>
                  <td style={{ fontWeight: 700 }}>
                    {b.patientName || b.UHID}
                    {b.patientName && b.UHID && (
                      <div style={{ fontFamily: "monospace", fontSize: 10.5, color: C.muted, fontWeight: 500 }}>
                        {b.UHID}
                      </div>
                    )}
                  </td>
                  <td style={{ color: C.muted, fontSize: 11.5 }}>{b.ageDays}d</td>
                  <td><Badge value={b.bucket} /></td>
                  <td style={{ textAlign: "right" }}>{fmtINR2(b.gross)}</td>
                  <td style={{ textAlign: "right" }}>{fmtINR2(b.paid)}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: C.red }}>{fmtINR2(b.due)}</td>
                  <td>
                    <button
                      onClick={() => handleOpen(b)}
                      style={{
                        padding: "4px 10px", borderRadius: 5,
                        border: `1px solid ${C.blue}40`, background: "#fff",
                        color: C.blue, fontSize: 11, fontWeight: 700, cursor: "pointer",
                      }}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
          </Table>

          {/* Selection footer — surfaces total due + the Collect-All
              affordance.  Sticky-ish via marginTop on the card body so it
              doesn't float over the table on short pages. */}
          {selectable && selectedRows.length > 0 && (
            <div style={{
              marginTop: 12, padding: "10px 14px",
              background: C.greenL || "#dcfce7",
              border: `1.5px solid ${C.green}40`,
              borderRadius: 8,
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}>
              <i className="pi pi-check-circle" style={{ color: C.green, fontSize: 16 }} />
              <span style={{ fontWeight: 700, fontSize: 12.5, color: C.text }}>
                Selected: <strong>{selectedRows.length} bill{selectedRows.length === 1 ? "" : "s"}</strong>
                {" · "}
                <span style={{ color: C.red, fontWeight: 800 }}>{fmtINR2(selectedTotal)} due</span>
                {lockedUHID && (
                  <span style={{ color: C.muted, fontWeight: 600, marginLeft: 6 }}>
                    for <span style={{ fontFamily: "monospace", color: C.text }}>{lockedUHID}</span>
                  </span>
                )}
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button
                  onClick={clearSelection}
                  style={{
                    padding: "6px 14px", borderRadius: 6,
                    border: `1.5px solid ${C.border}`, background: "#fff",
                    color: C.muted, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  Clear
                </button>
                <button
                  onClick={handleCollectAll}
                  style={{
                    padding: "6px 16px", borderRadius: 6,
                    border: "none",
                    background: C.green, color: "#fff",
                    fontSize: 12, fontWeight: 800, cursor: "pointer",
                    boxShadow: `0 1px 3px ${C.green}40`,
                  }}
                >
                  <i className="pi pi-wallet" style={{ marginRight: 4 }} />
                  Collect All for Patient
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
