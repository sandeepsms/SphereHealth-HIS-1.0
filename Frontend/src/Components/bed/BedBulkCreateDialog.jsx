// Components/bed/BedBulkCreateDialog.jsx
// Bulk bed creation (P2 #9).
// Lets an admin pick a room + numbering pattern + count and creates
// N beds in one shot. Backend's BedService.createBeds already handles
// arrays — we just POST the generated list to the existing endpoint.

import React, { useEffect, useMemo, useState } from "react";
import { Dialog }         from "primereact/dialog";
import { InputText }      from "primereact/inputtext";
import { InputNumber }    from "primereact/inputnumber";
import { Dropdown }       from "primereact/dropdown";
import { Button }         from "primereact/button";
import { roomService }    from "../../Services/roomService";
import { API_ENDPOINTS }  from "../../config/api";

const PATTERNS = [
  { label: "Numeric  (101-1, 101-2, …)",        value: "numeric" },
  { label: "Alphabetic (101-A, 101-B, …)",      value: "alpha" },
  { label: "Suffix only (1, 2, 3, …)",          value: "suffixNumber" },
];

const generateNumber = (pattern, base, idx) => {
  switch (pattern) {
    case "numeric":      return `${base}-${idx + 1}`;
    case "alpha":        return `${base}-${String.fromCharCode(65 + idx)}`;   // A,B,C...
    case "suffixNumber": return `${idx + 1}`;
    default:             return `${base}-${idx + 1}`;
  }
};

const BedBulkCreateDialog = ({ visible, onHide, onSaved }) => {
  const [rooms, setRooms]       = useState([]);
  const [roomId, setRoomId]     = useState(null);
  const [count, setCount]       = useState(5);
  const [pattern, setPattern]   = useState("numeric");
  const [startFrom, setStartFrom] = useState(0);   // skip first N positions
  const [status, setStatus]     = useState("Available");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    roomService.getAllRooms().then(setRooms).catch(() => setRooms([]));
  }, [visible]);

  const selectedRoom = useMemo(
    () => rooms.find(r => (r._id?.$oid || r._id) === roomId),
    [rooms, roomId],
  );

  const preview = useMemo(() => {
    if (!selectedRoom || !count) return [];
    const baseNo = selectedRoom.roomNumber || selectedRoom.roomCode || "BED";
    return Array.from({ length: count }, (_, i) =>
      generateNumber(pattern, baseNo, i + Number(startFrom)));
  }, [selectedRoom, count, pattern, startFrom]);

  const handleCreate = async () => {
    if (!selectedRoom || preview.length === 0) {
      setError("Select a room and enter a count.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Backend POST /bedss accepts an array of bed payloads
      // (BedService.createBeds wraps to insertMany). We resolve
      // building / floor / ward from the selected room.
      const beds = preview.map(bedNumber => ({
        bedNumber,
        room:     selectedRoom._id?.$oid || selectedRoom._id,
        building: selectedRoom.building?._id?.$oid || selectedRoom.building?._id || selectedRoom.building,
        floor:    selectedRoom.floor?._id?.$oid    || selectedRoom.floor?._id    || selectedRoom.floor,
        ward:     selectedRoom.ward?._id?.$oid     || selectedRoom.ward?._id     || selectedRoom.ward,
        status,
      }));
      const r = await fetch(API_ENDPOINTS.BEDS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(beds),
      });
      const data = await r.json();
      if (!data?.success) throw new Error(data?.message || "Bulk create failed");
      onSaved?.(data?.data?.created ?? beds.length);
    } catch (e) {
      setError(e?.message || "Bulk create failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      header={
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <i className="pi pi-clone" />
          <span>Bulk Create Beds</span>
        </span>
      }
      visible={visible}
      modal
      onHide={onHide}
      style={{ width: 540 }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
        {/* Room */}
        <Field label="Target Room">
          <Dropdown
            value={roomId}
            options={rooms.map(r => ({
              label: `${r.roomNumber || r.roomCode} · ${r.wardName || r.ward?.wardName || "—"}`,
              value: r._id?.$oid || r._id,
            }))}
            onChange={(e) => setRoomId(e.value)}
            placeholder="Select a room"
            filter
            style={{ width: "100%" }}
          />
        </Field>

        {/* Count + start offset */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="How many beds?">
            <InputNumber value={count} onValueChange={(e) => setCount(e.value || 0)}
              min={1} max={100} showButtons style={{ width: "100%" }} />
          </Field>
          <Field label="Start at index">
            <InputNumber value={startFrom} onValueChange={(e) => setStartFrom(e.value || 0)}
              min={0} max={99} showButtons style={{ width: "100%" }} />
          </Field>
        </div>

        {/* Numbering pattern */}
        <Field label="Numbering pattern">
          <Dropdown value={pattern} options={PATTERNS}
            onChange={(e) => setPattern(e.value)} style={{ width: "100%" }} />
        </Field>

        {/* Initial status */}
        <Field label="Initial status">
          <Dropdown value={status}
            options={["Available", "Blocked", "Maintenance"].map(s => ({ label: s, value: s }))}
            onChange={(e) => setStatus(e.value)} style={{ width: "100%" }} />
        </Field>

        {/* Preview */}
        {preview.length > 0 && (
          <div style={{
            background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 8,
            padding: "10px 12px", fontSize: 12, color: "#475569",
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: "#1e293b" }}>
              <i className="pi pi-eye" style={{ marginRight: 6 }} />
              Preview ({preview.length} bed{preview.length === 1 ? "" : "s"})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {preview.slice(0, 24).map(n => (
                <span key={n} style={{
                  background: "white", border: "1px solid #cbd5e1", borderRadius: 6,
                  padding: "2px 8px", fontFamily: "'DM Mono', monospace", fontWeight: 700, color: "#0f172a",
                }}>{n}</span>
              ))}
              {preview.length > 24 && (
                <span style={{ fontSize: 11, color: "#64748b" }}>… +{preview.length - 24} more</span>
              )}
            </div>
          </div>
        )}

        {error && (
          <div style={{
            background: "#fee2e2", color: "#991b1b", borderRadius: 8,
            padding: "8px 12px", fontSize: 12, fontWeight: 600,
          }}>
            <i className="pi pi-exclamation-triangle" style={{ marginRight: 6 }} />
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
          <Button label="Cancel" className="p-button-text" onClick={onHide} disabled={saving} />
          <Button label={saving ? "Creating…" : `Create ${preview.length || ""}`}
            icon={saving ? "pi pi-spin pi-spinner" : "pi pi-check"}
            onClick={handleCreate}
            disabled={saving || preview.length === 0}
            style={{ background: "#0891b2", borderColor: "#0891b2" }} />
        </div>
      </div>
    </Dialog>
  );
};

const Field = ({ label, children }) => (
  <div>
    <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>
      {label}
    </div>
    {children}
  </div>
);

export default BedBulkCreateDialog;
