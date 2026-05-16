// BedSelectionPanel.jsx — Modal-based bed selector
// Props: value, onChange, disabled

import React, { useState } from "react";
import { bedService } from "../../Services/bedService";
import { buildingService } from "../../Services/buildingService";
import { floorService } from "../../Services/floorService";
import { roomService } from "../../Services/roomService";

const getId = (v) => {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v.$oid) return v.$oid;
  if (v._id) return getId(v._id);
  return String(v);
};
const arrOf = (v) => (Array.isArray(v) ? v : v?.data || []);

const STATUS_COLOR = {
  Available: "#22c55e",
  Occupied: "#ef4444",
  Maintenance: "#f59e0b",
  Reserved: "#3b82f6",
  Blocked: "#9ca3af",
};
const STATUS_BG = {
  Available: { bg: "#d1fae5", color: "#065f46" },
  Occupied: { bg: "#fee2e2", color: "#991b1b" },
  Maintenance: { bg: "#fef3c7", color: "#92400e" },
  Reserved: { bg: "#dbeafe", color: "#1e40af" },
  Blocked: { bg: "#f3f4f6", color: "#374151" },
};
const TEAL = "#0891b2";
const TEAL_GRAD = "linear-gradient(135deg,#0f766e,#0891b2)";

const BedIcon = ({ status, size = 18 }) => {
  const col = STATUS_COLOR[status] || "#9ca3af";
  const dark =
    status === "Available"
      ? "#16a34a"
      : status === "Occupied"
        ? "#b91c1c"
        : "#78716c";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + 12,
        height: size + 12,
        borderRadius: 7,
        background: `${col}18`,
        border: `1.5px solid ${col}40`,
        flexShrink: 0,
      }}
    >
      <svg
        width={size}
        height={Math.round(size * 0.78)}
        viewBox="0 0 36 28"
        fill="none"
      >
        <rect x="2" y="13" width="32" height="9" rx="2" fill={col} />
        <rect x="2" y="7" width="5" height="15" rx="1.5" fill={dark} />
        <rect
          x="8"
          y="9"
          width="9"
          height="7"
          rx="2"
          fill="white"
          opacity=".9"
        />
        <rect x="29" y="9" width="4" height="13" rx="1.5" fill={dark} />
        <rect x="3" y="22" width="4" height="5" rx="1" fill={dark} />
        <rect x="29" y="22" width="4" height="5" rx="1" fill={dark} />
      </svg>
    </span>
  );
};

export default function BedSelectionPanel({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [beds, setBeds] = useState([]);
  const [buildings, setBldgs] = useState([]);
  const [allFloors, setAllFloors] = useState([]);
  const [allRooms, setAllRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fSearch, setFSearch] = useState("");
  const [fBldg, setFBldg] = useState(null);
  const [fFloor, setFFloor] = useState(null);
  const [tempSel, setTempSel] = useState(null);

  const loadData = async () => {
    if (loaded) return;
    setLoading(true);
    try {
      const [b, bl, allF, allR] = await Promise.all([
        bedService.getAllBeds(),
        buildingService.getAllBuildings(),
        floorService.getAllFloors(),
        roomService.getAllRooms(),
      ]);
      setBeds(arrOf(b));
      setBldgs(arrOf(bl));
      setAllFloors(arrOf(allF));
      setAllRooms(arrOf(allR));
      setLoaded(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    if (disabled) return;
    setTempSel(value?.bedId ? value : null);
    setFSearch("");
    setFBldg(null);
    setFFloor(null);
    setOpen(true);
    loadData();
  };
  const handleConfirm = () => {
    if (tempSel) onChange(tempSel);
    setOpen(false);
  };
  const handleClear = () =>
    onChange({
      bedId: null,
      bedNumber: null,
      roomId: null,
      floorId: null,
      wardId: null,
      buildingId: null,
    });

  const resolveFloorName = (bed) => {
    const fid = getId(bed.floor);
    if (!fid) return bed.floorNumber ? `Floor ${bed.floorNumber}` : "Ground";
    const f = allFloors.find((x) => getId(x._id) === fid);
    return (
      f?.floorName || (f?.floorNumber ? `Floor ${f.floorNumber}` : "Floor ?")
    );
  };
  const resolveRoomName = (bed) => {
    const rid = getId(bed.room);
    if (!rid) return bed.roomNumber ? `Room ${bed.roomNumber}` : "?";
    const r = allRooms.find((x) => getId(x._id) === rid);
    return r?.roomName || (r?.roomNumber ? `Room ${r.roomNumber}` : "Room ?");
  };

  const filtered = beds.filter((bed) => {
    if (
      bed.status !== "Available" &&
      getId(bed._id) !== value?.bedId &&
      getId(bed._id) !== tempSel?.bedId
    )
      return false;
    if (fBldg && getId(bed.building) !== fBldg) return false;
    if (fFloor && getId(bed.floor) !== fFloor) return false;
    if (fSearch) {
      const q = fSearch.toLowerCase();
      if (
        !bed.bedNumber?.toLowerCase().includes(q) &&
        !resolveRoomName(bed)?.toLowerCase().includes(q) &&
        !resolveFloorName(bed)?.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const byFloor = {};
  filtered.forEach((bed) => {
    const fk = resolveFloorName(bed);
    if (!byFloor[fk]) byFloor[fk] = { rooms: {} };
    const rk = String(getId(bed.room) || `nr_${getId(bed._id)}`);
    if (!byFloor[fk].rooms[rk])
      byFloor[fk].rooms[rk] = { roomName: resolveRoomName(bed), beds: [] };
    byFloor[fk].rooms[rk].beds.push(bed);
  });

  const availableCount = beds.filter((b) => b.status === "Available").length;
  const bldgOpts = buildings.map((b) => ({
    label: b.buildingName,
    value: getId(b._id),
  }));
  const floorOpts = allFloors
    .filter((f) => !fBldg || getId(f.building) === fBldg)
    .map((f) => ({
      label: f.floorName || `Floor ${f.floorNumber}`,
      value: getId(f._id),
    }));

  /* ══ TRIGGER BUTTON ══ */
  const TriggerUI = () => {
    if (value?.bedId) {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            background: "#f0fdf4",
            border: "2px solid #22c55e",
            borderRadius: 12,
          }}
        >
          <BedIcon status="Available" size={16} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#065f46" }}>
              ✓ Bed {value.bedNumber} Selected
            </div>
            <div style={{ fontSize: 12, color: "#16a34a", marginTop: 1 }}>
              Bed booking confirm ho gaya
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpen}
            disabled={disabled}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "1.5px solid #16a34a",
              background: "#dcfce7",
              color: "#15803d",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ✏ Change
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1.5px solid #fca5a5",
              background: "#fee2e2",
              color: "#dc2626",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "14px 20px",
          borderRadius: 12,
          border: "2px dashed #cbd5e1",
          background: disabled ? "#f8fafc" : "#fff",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          gap: 14,
          transition: "all .2s",
          opacity: disabled ? 0.6 : 1,
        }}
        onMouseEnter={(e) => {
          if (!disabled) {
            e.currentTarget.style.borderColor = TEAL;
            e.currentTarget.style.background = "#f0fdfe";
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "#cbd5e1";
          e.currentTarget.style.background = "#fff";
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 10,
            background: TEAL_GRAD,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="22" height="18" viewBox="0 0 36 28" fill="none">
            <rect x="2" y="13" width="32" height="9" rx="2" fill="white" />
            <rect
              x="2"
              y="7"
              width="5"
              height="15"
              rx="1.5"
              fill="rgba(255,255,255,0.7)"
            />
            <rect
              x="8"
              y="9"
              width="9"
              height="7"
              rx="2"
              fill="white"
              opacity=".9"
            />
            <rect
              x="29"
              y="9"
              width="4"
              height="13"
              rx="1.5"
              fill="rgba(255,255,255,0.7)"
            />
            <rect
              x="3"
              y="22"
              width="4"
              height="5"
              rx="1"
              fill="rgba(255,255,255,0.7)"
            />
            <rect
              x="29"
              y="22"
              width="4"
              height="5"
              rx="1"
              fill="rgba(255,255,255,0.7)"
            />
          </svg>
        </div>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
            Click To Select a Bed
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Available beds browse karein
          </div>
        </div>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "#f0f9ff",
            border: "1px solid #bae6fd",
            borderRadius: 20,
            padding: "4px 12px",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#22c55e",
              display: "inline-block",
            }}
          />
          <span style={{ fontSize: 12, fontWeight: 700, color: TEAL }}>
            Select Bed →
          </span>
        </div>
      </button>
    );
  };

  /* ══ MODAL ══ */
  return (
    <>
      {/* ✅ KEY FIX: Force dialog to center of viewport, not page */}
      <style>{`
        .bed-sel-dlg { position: fixed !important; }
        .bed-sel-dlg.p-dialog-mask {
          position: fixed !important;
          top: 0 !important; left: 0 !important;
          width: 100vw !important; height: 100vh !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          z-index: 9999 !important;
        }
        .bed-sel-dlg .p-dialog {
          position: relative !important;
          top: auto !important; left: auto !important;
          transform: none !important;
          margin: auto !important;
        }
        .bed-sel-dlg .p-dialog-content { padding: 0 !important; overflow: hidden !important; }
        .bed-sel-dlg .p-dialog-header  { display: none !important; }
      `}</style>

      <TriggerUI />

      {open && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.55)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            style={{
              width: "860px",
              maxWidth: "95vw",
              height: "85vh",
              maxHeight: "85vh",
              background: "#fff",
              borderRadius: 16,
              boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              fontFamily: "'Inter',-apple-system,sans-serif",
              animation: "bedModalIn .22s cubic-bezier(.34,1.3,.64,1)",
            }}
          >
            <style>{`
              @keyframes bedModalIn {
                from { opacity:0; transform:scale(0.93) translateY(-10px); }
                to   { opacity:1; transform:scale(1) translateY(0); }
              }
            `}</style>

            {/* ── Header ── */}
            <div
              style={{
                background: TEAL_GRAD,
                padding: "16px 22px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 9,
                    background: "rgba(255,255,255,.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="20" height="16" viewBox="0 0 36 28" fill="none">
                    <rect
                      x="2"
                      y="13"
                      width="32"
                      height="9"
                      rx="2"
                      fill="white"
                    />
                    <rect
                      x="2"
                      y="7"
                      width="5"
                      height="15"
                      rx="1.5"
                      fill="rgba(255,255,255,0.7)"
                    />
                    <rect
                      x="8"
                      y="9"
                      width="9"
                      height="7"
                      rx="2"
                      fill="white"
                      opacity=".9"
                    />
                    <rect
                      x="29"
                      y="9"
                      width="4"
                      height="13"
                      rx="1.5"
                      fill="rgba(255,255,255,0.7)"
                    />
                    <rect
                      x="3"
                      y="22"
                      width="4"
                      height="5"
                      rx="1"
                      fill="rgba(255,255,255,0.7)"
                    />
                    <rect
                      x="29"
                      y="22"
                      width="4"
                      height="5"
                      rx="1"
                      fill="rgba(255,255,255,0.7)"
                    />
                  </svg>
                </div>
                <div>
                  <div style={{ color: "#fff", fontWeight: 800, fontSize: 17 }}>
                    Select Bed
                  </div>
                  <div
                    style={{
                      color: "rgba(255,255,255,.75)",
                      fontSize: 11,
                      marginTop: 1,
                    }}
                  >
                    Green (Available) beds select ho sakte hain
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {availableCount > 0 && (
                  <span
                    style={{
                      background: "#d1fae5",
                      color: "#065f46",
                      borderRadius: 20,
                      padding: "4px 14px",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {availableCount} Available
                  </span>
                )}
                <button
                  onClick={() => setOpen(false)}
                  style={{
                    background: "rgba(255,255,255,.2)",
                    border: "none",
                    borderRadius: 8,
                    padding: "7px 11px",
                    cursor: "pointer",
                  }}
                >
                  <i
                    className="pi pi-times"
                    style={{ color: "#fff", fontSize: 14 }}
                  />
                </button>
              </div>
            </div>

            {/* ── Filter Bar ── */}
            <div
              style={{
                padding: "10px 18px",
                background: "#f8fafc",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                flexShrink: 0,
              }}
            >
              <div style={{ position: "relative", flex: 2, minWidth: 160 }}>
                <i
                  className="pi pi-search"
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#9ca3af",
                    fontSize: 12,
                  }}
                />
                <input
                  value={fSearch}
                  onChange={(e) => setFSearch(e.target.value)}
                  placeholder="Search bed or room..."
                  style={{
                    width: "100%",
                    padding: "8px 12px 8px 32px",
                    border: "1.5px solid #e2e8f0",
                    borderRadius: 8,
                    fontSize: 13,
                    outline: "none",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                    background: "#fff",
                  }}
                />
              </div>
              <select
                value={fBldg || ""}
                onChange={(e) => {
                  setFBldg(e.target.value || null);
                  setFFloor(null);
                }}
                style={{
                  flex: 1,
                  minWidth: 130,
                  padding: "8px 10px",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 8,
                  fontSize: 13,
                  color: fBldg ? "#0f172a" : "#94a3b8",
                  background: "#fff",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="">All Buildings</option>
                {bldgOpts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                value={fFloor || ""}
                onChange={(e) => setFFloor(e.target.value || null)}
                disabled={!fBldg}
                style={{
                  flex: 1,
                  minWidth: 130,
                  padding: "8px 10px",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 8,
                  fontSize: 13,
                  color: fFloor ? "#0f172a" : "#94a3b8",
                  background: "#fff",
                  outline: "none",
                  cursor: fBldg ? "pointer" : "not-allowed",
                  opacity: fBldg ? 1 : 0.5,
                }}
              >
                <option value="">All Floors</option>
                {floorOpts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {(fBldg || fFloor || fSearch) && (
                <button
                  onClick={() => {
                    setFBldg(null);
                    setFFloor(null);
                    setFSearch("");
                  }}
                  style={{
                    padding: "8px 12px",
                    border: "1.5px solid #e2e8f0",
                    borderRadius: 8,
                    background: "#fff",
                    fontSize: 12,
                    color: "#64748b",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  ✕ Clear
                </button>
              )}
            </div>

            {/* ── Temp selection banner ── */}
            {tempSel?.bedId && (
              <div
                style={{
                  padding: "9px 18px",
                  background: "#f0fdf4",
                  borderBottom: "1px solid #bbf7d0",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexShrink: 0,
                }}
              >
                <i
                  className="pi pi-check-circle"
                  style={{ color: "#22c55e", fontSize: 15 }}
                />
                <span
                  style={{ fontSize: 13, fontWeight: 700, color: "#15803d" }}
                >
                  Bed {tempSel.bedNumber} selected
                </span>
                <span style={{ fontSize: 12, color: "#16a34a" }}>
                  — Neeche "Confirm Selection" click karein
                </span>
                <button
                  onClick={() => setTempSel(null)}
                  style={{
                    marginLeft: "auto",
                    padding: "3px 10px",
                    borderRadius: 6,
                    border: "1px solid #86efac",
                    background: "#dcfce7",
                    fontSize: 11,
                    color: "#15803d",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  ✕ Cancel
                </button>
              </div>
            )}

            {/* ── Bed Grid (scrollable) ── */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                overscrollBehavior: "contain",
              }}
            >
              {loading ? (
                <div
                  style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}
                >
                  <i
                    className="pi pi-spin pi-spinner"
                    style={{ fontSize: 32, color: TEAL }}
                  />
                  <p style={{ marginTop: 12, fontSize: 13 }}>
                    Beds load ho rahe hain…
                  </p>
                </div>
              ) : Object.keys(byFloor).length === 0 ? (
                <div
                  style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}
                >
                  <i
                    className="pi pi-inbox"
                    style={{
                      fontSize: 44,
                      display: "block",
                      marginBottom: 12,
                      opacity: 0.35,
                    }}
                  />
                  <p style={{ margin: 0, fontSize: 14 }}>
                    Koi available bed nahi mila
                  </p>
                </div>
              ) : (
                Object.entries(byFloor)
                  .sort()
                  .map(([floorLabel, floorData]) => (
                    <div key={floorLabel}>
                      <div
                        style={{
                          background: "linear-gradient(135deg,#1e3a5f,#164e63)",
                          padding: "9px 18px",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          position: "sticky",
                          top: 0,
                          zIndex: 3,
                        }}
                      >
                        <i
                          className="pi pi-building"
                          style={{ color: "#7dd3fc", fontSize: 14 }}
                        />
                        <span
                          style={{
                            color: "#fff",
                            fontWeight: 800,
                            fontSize: 14,
                          }}
                        >
                          {floorLabel}
                        </span>
                        <div
                          style={{
                            marginLeft: "auto",
                            display: "flex",
                            gap: 8,
                          }}
                        >
                          {["Available", "Occupied"].map((k) => {
                            const cnt = Object.values(floorData.rooms)
                              .flatMap((r) => r.beds)
                              .filter((b) => b.status === k).length;
                            if (!cnt) return null;
                            return (
                              <span
                                key={k}
                                style={{
                                  background:
                                    k === "Available" ? "#d1fae5" : "#fee2e2",
                                  color:
                                    k === "Available" ? "#065f46" : "#991b1b",
                                  borderRadius: 20,
                                  padding: "2px 10px",
                                  fontSize: 11,
                                  fontWeight: 700,
                                }}
                              >
                                {k}: {cnt}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fill,minmax(240px,1fr))",
                          gap: 12,
                          padding: 14,
                          background: "#fafafa",
                        }}
                      >
                        {Object.values(floorData.rooms).map((grp, ri) => (
                          <div
                            key={ri}
                            style={{
                              border: "1px solid #e2e8f0",
                              borderRadius: 12,
                              overflow: "hidden",
                              background: "#fff",
                            }}
                          >
                            <div
                              style={{
                                padding: "8px 13px",
                                borderBottom: "1px solid #f1f5f9",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <i
                                  className="pi pi-home"
                                  style={{ color: TEAL, fontSize: 12 }}
                                />
                                <span
                                  style={{
                                    fontWeight: 700,
                                    fontSize: 13,
                                    color: "#0f172a",
                                  }}
                                >
                                  {grp.roomName}
                                </span>
                              </div>
                              <span
                                style={{
                                  fontSize: 10,
                                  color: "#64748b",
                                  background: "#f1f5f9",
                                  borderRadius: 20,
                                  padding: "2px 8px",
                                  fontWeight: 600,
                                }}
                              >
                                {grp.beds.length} Bed
                                {grp.beds.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                            <div
                              style={{
                                padding: 8,
                                display: "flex",
                                flexDirection: "column",
                                gap: 7,
                              }}
                            >
                              {grp.beds.map((bed) => {
                                const bidStr = getId(bed._id);
                                const isTemp = tempSel?.bedId === bidStr;
                                const avail = bed.status === "Available";
                                const col =
                                  STATUS_COLOR[bed.status] || "#d1d5db";
                                const sbg = STATUS_BG[bed.status] || {
                                  bg: "#f3f4f6",
                                  color: "#374151",
                                };
                                return (
                                  <div
                                    key={bidStr}
                                    onClick={() => {
                                      if (!avail) return;
                                      if (isTemp) {
                                        setTempSel(null);
                                        return;
                                      }
                                      setTempSel({
                                        bedId: bidStr,
                                        bedNumber: bed.bedNumber,
                                        roomId:    getId(bed.room),
                                        roomNumber:  bed.roomNumber  || bed.room?.roomNumber  || "",
                                        floorId:   getId(bed.floor),
                                        floorNumber: bed.floorNumber ?? bed.floor?.floorNumber ?? "",
                                        wardId:    getId(bed.ward),
                                        wardName:    bed.wardName    || bed.ward?.wardName    || "",
                                        buildingId:  getId(bed.building),
                                        buildingName:bed.buildingName|| bed.building?.buildingName || "",
                                      });
                                    }}
                                    style={{
                                      border: isTemp
                                        ? "2px solid #22c55e"
                                        : "1px solid #e2e8f0",
                                      borderLeft: isTemp
                                        ? "4px solid #22c55e"
                                        : `4px solid ${col}`,
                                      borderRadius: 9,
                                      background: isTemp
                                        ? "#f0fdf4"
                                        : avail
                                          ? "#f9fafb"
                                          : "#fafafa",
                                      cursor: avail ? "pointer" : "not-allowed",
                                      padding: "9px 11px",
                                      transition: "all .15s",
                                      boxShadow: isTemp
                                        ? "0 0 0 3px rgba(34,197,94,0.15)"
                                        : "none",
                                      opacity: !avail && !isTemp ? 0.5 : 1,
                                    }}
                                    onMouseEnter={(e) => {
                                      if (avail) {
                                        e.currentTarget.style.transform =
                                          "translateY(-2px)";
                                        e.currentTarget.style.boxShadow = isTemp
                                          ? "0 0 0 3px rgba(34,197,94,0.2),0 4px 12px rgba(0,0,0,.08)"
                                          : "0 4px 14px rgba(0,0,0,.08)";
                                      }
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.transform = "none";
                                      e.currentTarget.style.boxShadow = isTemp
                                        ? "0 0 0 3px rgba(34,197,94,0.15)"
                                        : "none";
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 7,
                                        }}
                                      >
                                        <BedIcon
                                          status={bed.status}
                                          size={14}
                                        />
                                        <span
                                          style={{
                                            fontWeight: 800,
                                            fontSize: 13,
                                            color: isTemp
                                              ? "#15803d"
                                              : "#0f172a",
                                          }}
                                        >
                                          {bed.bedNumber}
                                        </span>
                                        {isTemp && (
                                          <span
                                            style={{
                                              fontSize: 10,
                                              fontWeight: 700,
                                              background: "#22c55e",
                                              color: "#fff",
                                              borderRadius: 20,
                                              padding: "1px 7px",
                                            }}
                                          >
                                            ✓
                                          </span>
                                        )}
                                      </div>
                                      <span
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 3,
                                          padding: "2px 8px",
                                          borderRadius: 20,
                                          fontSize: 10,
                                          fontWeight: 600,
                                          background: sbg.bg,
                                          color: sbg.color,
                                        }}
                                      >
                                        <span
                                          style={{
                                            width: 5,
                                            height: 5,
                                            borderRadius: "50%",
                                            background: col,
                                            display: "inline-block",
                                          }}
                                        />
                                        {bed.status}
                                      </span>
                                    </div>
                                    {avail && !isTemp && (
                                      <div
                                        style={{
                                          fontSize: 11,
                                          color: "#94a3b8",
                                          marginTop: 4,
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 3,
                                        }}
                                      >
                                        <i
                                          className="pi pi-plus-circle"
                                          style={{
                                            color: "#22c55e",
                                            fontSize: 10,
                                          }}
                                        />
                                        Click to select
                                      </div>
                                    )}
                                    {!avail && (
                                      <div
                                        style={{
                                          fontSize: 11,
                                          color: "#ef4444",
                                          marginTop: 4,
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 3,
                                        }}
                                      >
                                        <i
                                          className="pi pi-ban"
                                          style={{ fontSize: 10 }}
                                        />{" "}
                                        {bed.status}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
              )}
            </div>

            {/* ── Footer ── */}
            <div
              style={{
                padding: "12px 18px",
                borderTop: "1px solid #e2e8f0",
                background: "#fff",
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", gap: 10, flex: 1 }}>
                {[
                  ["Available", "#22c55e"],
                  ["Occupied", "#ef4444"],
                  ["Maintenance", "#f59e0b"],
                ].map(([l, c]) => (
                  <span
                    key={l}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      color: "#475569",
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 9,
                        border: `2px solid ${c}`,
                        borderRadius: 2,
                        display: "inline-block",
                      }}
                    />
                    {l}
                  </span>
                ))}
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{
                  padding: "10px 20px",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: 10,
                  background: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#64748b",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!tempSel?.bedId}
                style={{
                  padding: "10px 24px",
                  borderRadius: 10,
                  border: "none",
                  background: tempSel?.bedId ? TEAL_GRAD : "#94a3b8",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: tempSel?.bedId ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  boxShadow: tempSel?.bedId
                    ? "0 4px 14px rgba(8,145,178,.3)"
                    : "none",
                  transition: "all .2s",
                }}
              >
                <i className="pi pi-check" />
                Confirm Selection
                {tempSel?.bedId ? ` — Bed ${tempSel.bedNumber}` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
