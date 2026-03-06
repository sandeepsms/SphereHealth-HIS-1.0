import React, { useState, useEffect, useRef } from "react";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { ProgressBar } from "primereact/progressbar";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { roomService } from "../../Services/roomService";
import { buildingService } from "../../Services/buildingService";
import { floorService } from "../../Services/floorService";

const getId = (v) => {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v.$oid) return v.$oid;
  if (v._id) return getId(v._id);
  return String(v);
};

const STATUS_CONFIG = {
  Active: { color: "#0369a1", border: "#e0f2fe", dot: "#38bdf8" },
  Inactive: { color: "#64748b", border: "#f1f5f9", dot: "#cbd5e1" },
  "Under Maintenance": { color: "#b45309", border: "#fef3c7", dot: "#fbbf24" },
  Blocked: { color: "#b91c1c", border: "#fee2e2", dot: "#f87171" },
};

/* ── Room Detail Modal ── */
const RoomDetailModal = ({ visible, room, onHide, onEdit }) => {
  if (!room) return null;
  const rate = parseFloat(room.occupancyRate || 0);

  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      style={{ width: 460 }}
      header={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <i className="pi pi-building" style={{ color: "#0891b2" }} />
          Room {room.roomNumber}
          {room.roomName && (
            <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 13 }}>
              · {room.roomName}
            </span>
          )}
        </div>
      }
      modal
      draggable={false}
    >
      <div
        style={{
          background: "linear-gradient(135deg,#0891b2,#0e7490)",
          borderRadius: 8,
          padding: "14px 18px",
          marginBottom: 16,
          color: "#fff",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
        }}
      >
        {[
          ["Building", room.buildingName || "—"],
          ["Floor", room.floorNumber ? `Floor ${room.floorNumber}` : "—"],
          ["Ward", room.wardName || "—"],
        ].map(([k, v]) => (
          <div key={k}>
            <div
              style={{
                fontSize: 10,
                opacity: 0.7,
                textTransform: "uppercase",
                letterSpacing: 0.8,
              }}
            >
              {k}
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>
              {v}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: "11px 14px",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 6,
            fontSize: 13,
          }}
        >
          <span style={{ color: "#64748b" }}>Bed Occupancy</span>
          <span style={{ fontWeight: 700, color: "#0f172a" }}>
            {room.occupiedBeds || 0}/{room.totalBeds || 0} ({rate}%)
          </span>
        </div>
        <ProgressBar
          value={rate}
          showValue={false}
          style={{ height: 6, borderRadius: 999 }}
        />
      </div>

      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          overflow: "hidden",
          marginBottom: 16,
        }}
      >
        {[
          ["Room Code", room.roomCode],
          ["Category", room.categoryName || room.roomCategoryName],
          ["Status", room.status],
          ["Total Beds", room.totalBeds],
          ["Active", room.isActive ? "Yes" : "No"],
          ["Notes", room.notes],
          [
            "Created",
            room.createdAt
              ? new Date(room.createdAt).toLocaleString("en-IN")
              : null,
          ],
        ]
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v], i, arr) => (
            <div
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 14px",
                fontSize: 13,
                background: i % 2 === 0 ? "#fff" : "#f8fafc",
                borderBottom: i < arr.length - 1 ? "1px solid #f1f5f9" : "none",
              }}
            >
              <span style={{ color: "#64748b" }}>{k}</span>
              <span style={{ fontWeight: 600, color: "#0f172a" }}>
                {String(v)}
              </span>
            </div>
          ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button
          label="Close"
          onClick={onHide}
          className="p-button-text p-button-sm"
        />
        <Button
          label="Edit"
          icon="pi pi-pencil"
          onClick={() => {
            onEdit(room);
            onHide();
          }}
          className="p-button-sm"
          style={{ background: "#0891b2", border: "none", borderRadius: 6 }}
        />
      </div>
    </Dialog>
  );
};

/* ══ MAIN ══ */
const RoomVisualLayout = ({ onEdit, onRefresh }) => {
  const [rooms, setRooms] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [floors, setFloors] = useState([]);
  const [loading, setLoading] = useState(false);

  const [fBldg, setFBldg] = useState("");
  const [fFloor, setFFloor] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [search, setSearch] = useState("");

  const [collBldg, setCollBldg] = useState({});
  const [collFloor, setCollFloor] = useState({});
  const [viewRoom, setViewRoom] = useState(null);

  const toast = useRef(null);

  useEffect(() => {
    loadAll();
  }, [onRefresh]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [r, b, f] = await Promise.all([
        roomService.getAllRooms(),
        buildingService.getAllBuildings(),
        floorService.getAllFloors(),
      ]);
      setRooms(Array.isArray(r) ? r : r?.data || []);
      setBuildings(Array.isArray(b) ? b : b?.data || []);
      setFloors(Array.isArray(f) ? f : f?.data || []);
    } catch {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load data",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  /* ── FILTER — normalize both sides with getId ── */
  const filtered = rooms.filter((r) => {
    if (fBldg && getId(r.building) !== fBldg) return false;
    if (fFloor && getId(r.floor) !== fFloor) return false;
    if (fStatus && r.status !== fStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !`${r.roomNumber} ${r.roomName} ${r.wardName} ${r.buildingName}`
          .toLowerCase()
          .includes(q)
      )
        return false;
    }
    return true;
  });

  /* ── HIERARCHY ── */
  const visibleBuildings = fBldg
    ? buildings.filter((b) => b._id === fBldg)
    : buildings;

  const hierarchy = visibleBuildings
    .map((bldg) => {
      const visibleFloors = floors
        .filter((f) => getId(f.building) === bldg._id)
        .filter((f) => !fFloor || f._id === fFloor);

      const bFloors = visibleFloors
        .map((floor) => {
          const fRooms = filtered.filter((r) => getId(r.floor) === floor._id);
          const wardMap = {};
          fRooms.forEach((r) => {
            const wId = r.ward ? String(getId(r.ward)) : "__none__";
            const wName = r.wardName || "General";
            if (!wardMap[wId]) wardMap[wId] = { wId, wName, rooms: [] };
            wardMap[wId].rooms.push(r);
          });
          return { floor, fRooms, wards: Object.values(wardMap) };
        })
        .filter((f) => f.fRooms.length > 0);

      return { bldg, bFloors };
    })
    .filter((b) => b.bFloors.length > 0);

  const toggleB = (id) => setCollBldg((p) => ({ ...p, [id]: !p[id] }));
  const toggleF = (id) => setCollFloor((p) => ({ ...p, [id]: !p[id] }));

  const clearFilters = () => {
    setFBldg("");
    setFFloor("");
    setFStatus("");
    setSearch("");
  };

  const stats = [
    { label: "Total", val: filtered.length },
    {
      label: "Active",
      val: filtered.filter((r) => r.status === "Active").length,
    },
    {
      label: "Maint.",
      val: filtered.filter((r) => r.status === "Under Maintenance").length,
    },
    {
      label: "Full",
      val: filtered.filter(
        (r) => r.totalBeds > 0 && (r.occupiedBeds || 0) >= r.totalBeds,
      ).length,
    },
  ];

  /* ── filtered floors for floor dropdown ── */
  const floorOptions = fBldg
    ? floors.filter((f) => getId(f.building) === fBldg)
    : floors;

  return (
    <div>
      <Toast ref={toast} />
      <ConfirmDialog />

      {/* ── FILTER BAR ── */}
      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          border: "1px solid #e2e8f0",
          padding: "12px 18px",
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          boxShadow: "0 1px 6px rgba(0,0,0,.06)",
        }}
      >
        {/* Stats */}
        <div style={{ display: "flex", gap: 24 }}>
          {stats.map(({ label, val }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: "#0891b2",
                  lineHeight: 1,
                }}
              >
                {val}
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <i
              className="pi pi-search"
              style={{
                position: "absolute",
                left: 9,
                color: "#94a3b8",
                fontSize: 12,
                zIndex: 1,
              }}
            />
            <InputText
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              style={{
                paddingLeft: 28,
                width: 150,
                fontSize: 13,
                borderRadius: 7,
                height: 34,
              }}
            />
          </span>

          <select
            value={fBldg}
            onChange={(e) => {
              setFBldg(e.target.value);
              setFFloor("");
            }}
            style={{
              padding: "5px 10px",
              borderRadius: 7,
              border: "1px solid #e2e8f0",
              fontSize: 12,
              color: "#374151",
              cursor: "pointer",
              height: 34,
              background: "#fff",
            }}
          >
            <option value="">All Buildings</option>
            {buildings.map((b) => (
              <option key={b._id} value={b._id}>
                {b.buildingName}
              </option>
            ))}
          </select>

          <select
            value={fFloor}
            onChange={(e) => setFFloor(e.target.value)}
            style={{
              padding: "5px 10px",
              borderRadius: 7,
              border: "1px solid #e2e8f0",
              fontSize: 12,
              color: "#374151",
              cursor: "pointer",
              height: 34,
              background: "#fff",
            }}
          >
            <option value="">All Floors</option>
            {floorOptions.map((f) => (
              <option key={f._id} value={f._id}>
                {f.floorName || `Floor ${f.floorNumber}`}
              </option>
            ))}
          </select>

          <select
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
            style={{
              padding: "5px 10px",
              borderRadius: 7,
              border: "1px solid #e2e8f0",
              fontSize: 12,
              color: "#374151",
              cursor: "pointer",
              height: 34,
              background: "#fff",
            }}
          >
            <option value="">All Status</option>
            {Object.keys(STATUS_CONFIG).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <Button
            icon="pi pi-refresh"
            onClick={loadAll}
            loading={loading}
            className="p-button-sm p-button-outlined"
            style={{
              borderColor: "#0891b2",
              color: "#0891b2",
              borderRadius: 7,
              height: 34,
              width: 34,
              padding: 0,
            }}
          />
          <Button
            icon="pi pi-filter-slash"
            onClick={clearFilters}
            className="p-button-sm p-button-text"
            tooltip="Clear filters"
            style={{ color: "#94a3b8", height: 34, width: 34, padding: 0 }}
          />
        </div>
      </div>

      {/* ── HIERARCHY ── */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
          <i className="pi pi-spin pi-spinner" style={{ fontSize: 32 }} />
          <p style={{ marginTop: 8 }}>Loading…</p>
        </div>
      ) : hierarchy.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 60,
            background: "#fff",
            borderRadius: 10,
            border: "1px solid #e2e8f0",
            color: "#94a3b8",
            boxShadow: "0 1px 6px rgba(0,0,0,.06)",
          }}
        >
          <i
            className="pi pi-inbox"
            style={{ fontSize: 40, display: "block", marginBottom: 8 }}
          />
          <p>No rooms found. Try adjusting filters.</p>
          <Button
            label="Clear Filters"
            onClick={clearFilters}
            className="p-button-sm p-button-outlined"
            style={{ marginTop: 8 }}
          />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {hierarchy.map(({ bldg, bFloors }) => {
            const bCollapsed = collBldg[bldg._id];
            const totalRooms = bFloors.reduce((a, f) => a + f.fRooms.length, 0);
            const activeRooms = bFloors.reduce(
              (a, f) =>
                a + f.fRooms.filter((r) => r.status === "Active").length,
              0,
            );

            return (
              <div
                key={bldg._id}
                style={{
                  background: "#fff",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                  overflow: "hidden",
                  boxShadow: "0 2px 10px rgba(0,0,0,.07)",
                }}
              >
                {/* Building header */}
                <div
                  onClick={() => toggleB(bldg._id)}
                  style={{
                    background: "linear-gradient(135deg,#38bdf8,#0891b2)",
                    padding: "11px 18px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    userSelect: "none",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        background: "rgba(255,255,255,.2)",
                        borderRadius: 7,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <i
                        className="pi pi-building"
                        style={{ color: "#fff", fontSize: 15 }}
                      />
                    </div>
                    <div>
                      <div
                        style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}
                      >
                        {bldg.buildingName}
                      </div>
                      <div
                        style={{ color: "rgba(255,255,255,.75)", fontSize: 11 }}
                      >
                        {bFloors.length} floor{bFloors.length !== 1 ? "s" : ""}{" "}
                        · {totalRooms} rooms · {activeRooms} active
                      </div>
                    </div>
                  </div>
                  <i
                    className={`pi pi-chevron-${bCollapsed ? "down" : "up"}`}
                    style={{ color: "rgba(255,255,255,.8)", fontSize: 12 }}
                  />
                </div>

                {/* Building body */}
                {!bCollapsed && (
                  <div
                    style={{
                      padding: "12px 14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {bFloors.map(({ floor, fRooms, wards }) => {
                      const fCollapsed = collFloor[floor._id];
                      const fActive = fRooms.filter(
                        (r) => r.status === "Active",
                      ).length;

                      return (
                        <div
                          key={floor._id}
                          style={{
                            border: "1px solid #e2e8f0",
                            borderRadius: 8,
                            overflow: "hidden",
                            boxShadow: "0 1px 4px rgba(0,0,0,.04)",
                          }}
                        >
                          {/* Floor header */}
                          <div
                            onClick={() => toggleF(floor._id)}
                            style={{
                              background: "#f0f9ff",
                              borderBottom: fCollapsed
                                ? "none"
                                : "1px solid #e0f2fe",
                              padding: "8px 14px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              userSelect: "none",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <i
                                className="pi pi-layers"
                                style={{ color: "#38bdf8", fontSize: 12 }}
                              />
                              <span
                                style={{
                                  fontWeight: 600,
                                  fontSize: 13,
                                  color: "#0c4a6e",
                                }}
                              >
                                {floor.floorName ||
                                  `Floor ${floor.floorNumber}`}
                              </span>
                              <span style={{ fontSize: 11, color: "#64748b" }}>
                                · {fRooms.length} rooms · {fActive} active
                              </span>
                            </div>
                            <i
                              className={`pi pi-chevron-${fCollapsed ? "down" : "up"}`}
                              style={{ color: "#38bdf8", fontSize: 11 }}
                            />
                          </div>

                          {/* Floor body */}
                          {!fCollapsed && (
                            <div
                              style={{
                                padding: "10px 12px",
                                background: "#fafcff",
                                display: "flex",
                                flexDirection: "column",
                                gap: 10,
                              }}
                            >
                              {wards.map(({ wId, wName, rooms: wRooms }) => (
                                <div key={wId}>
                                  {/* Ward label */}
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      marginBottom: 8,
                                    }}
                                  >
                                    <i
                                      className={
                                        wId === "__none__"
                                          ? "pi pi-minus-circle"
                                          : "pi pi-home"
                                      }
                                      style={{
                                        fontSize: 10,
                                        color:
                                          wId === "__none__"
                                            ? "#cbd5e1"
                                            : "#38bdf8",
                                      }}
                                    />
                                    <span
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 700,
                                        color:
                                          wId === "__none__"
                                            ? "#94a3b8"
                                            : "#0369a1",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.5,
                                      }}
                                    >
                                      {wName}
                                    </span>
                                    <span
                                      style={{ fontSize: 11, color: "#cbd5e1" }}
                                    >
                                      ({wRooms.length})
                                    </span>
                                    <div
                                      style={{
                                        flex: 1,
                                        height: 1,
                                        background: "#e2e8f0",
                                      }}
                                    />
                                  </div>

                                  {/* Room cards */}
                                  <div
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns:
                                        "repeat(auto-fill, minmax(180px,1fr))",
                                      gap: 8,
                                    }}
                                  >
                                    {wRooms.map((room) => {
                                      const sc =
                                        STATUS_CONFIG[room.status] ||
                                        STATUS_CONFIG.Active;
                                      const rate = parseFloat(
                                        room.occupancyRate || 0,
                                      );
                                      const full =
                                        room.totalBeds > 0 &&
                                        (room.occupiedBeds || 0) >=
                                          room.totalBeds;

                                      return (
                                        <div
                                          key={room._id}
                                          onClick={() => setViewRoom(room)}
                                          style={{
                                            background: "#fff",
                                            border: `1px solid ${sc.border}`,
                                            borderLeft: `3px solid ${sc.dot}`,
                                            borderRadius: 8,
                                            padding: "10px 12px",
                                            cursor: "pointer",
                                            transition:
                                              "box-shadow .15s, transform .15s",
                                            position: "relative",
                                            boxShadow:
                                              "0 1px 4px rgba(0,0,0,.05)",
                                          }}
                                          onMouseEnter={(e) => {
                                            e.currentTarget.style.boxShadow =
                                              "0 4px 14px rgba(56,189,248,.18)";
                                            e.currentTarget.style.transform =
                                              "translateY(-2px)";
                                          }}
                                          onMouseLeave={(e) => {
                                            e.currentTarget.style.boxShadow =
                                              "0 1px 4px rgba(0,0,0,.05)";
                                            e.currentTarget.style.transform =
                                              "none";
                                          }}
                                        >
                                          {full && (
                                            <span
                                              style={{
                                                position: "absolute",
                                                top: 7,
                                                right: 7,
                                                background: "#ef4444",
                                                color: "#fff",
                                                fontSize: 9,
                                                fontWeight: 700,
                                                padding: "1px 5px",
                                                borderRadius: 10,
                                              }}
                                            >
                                              FULL
                                            </span>
                                          )}

                                          <div
                                            style={{
                                              fontSize: 16,
                                              fontWeight: 800,
                                              color: "#0f172a",
                                              lineHeight: 1,
                                              marginBottom: 2,
                                            }}
                                          >
                                            {room.roomNumber}
                                          </div>
                                          {room.roomName && (
                                            <div
                                              style={{
                                                fontSize: 11,
                                                color: "#64748b",
                                                marginBottom: 6,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                              }}
                                            >
                                              {room.roomName}
                                            </div>
                                          )}

                                          <div
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: 4,
                                              marginBottom: 7,
                                            }}
                                          >
                                            <span
                                              style={{
                                                width: 6,
                                                height: 6,
                                                borderRadius: "50%",
                                                background: sc.dot,
                                                flexShrink: 0,
                                              }}
                                            />
                                            <span
                                              style={{
                                                fontSize: 10,
                                                color: sc.color,
                                                fontWeight: 600,
                                              }}
                                            >
                                              {room.status}
                                            </span>
                                          </div>

                                          <div style={{ marginBottom: 7 }}>
                                            <div
                                              style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                fontSize: 11,
                                                color: "#64748b",
                                                marginBottom: 3,
                                              }}
                                            >
                                              <span>Beds</span>
                                              <span
                                                style={{
                                                  fontWeight: 700,
                                                  color: "#374151",
                                                }}
                                              >
                                                {room.occupiedBeds || 0}/
                                                {room.totalBeds || 0}
                                              </span>
                                            </div>
                                            <div
                                              style={{
                                                background: "#e2e8f0",
                                                borderRadius: 999,
                                                height: 4,
                                              }}
                                            >
                                              <div
                                                style={{
                                                  background: "#38bdf8",
                                                  height: "100%",
                                                  width: `${Math.min(rate, 100)}%`,
                                                  borderRadius: 999,
                                                }}
                                              />
                                            </div>
                                          </div>

                                          {(room.categoryName ||
                                            room.roomCategoryName) && (
                                            <div
                                              style={{
                                                fontSize: 10,
                                                color: "#94a3b8",
                                                marginBottom: 7,
                                              }}
                                            >
                                              <i
                                                className="pi pi-tag"
                                                style={{
                                                  fontSize: 9,
                                                  marginRight: 3,
                                                }}
                                              />
                                              {room.categoryName ||
                                                room.roomCategoryName}
                                            </div>
                                          )}

                                          <div
                                            style={{ display: "flex", gap: 4 }}
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <button
                                              onClick={() => setViewRoom(room)}
                                              style={{
                                                flex: 1,
                                                border: "1px solid #e0f2fe",
                                                background: "#f0f9ff",
                                                color: "#0891b2",
                                                borderRadius: 5,
                                                padding: "4px 0",
                                                cursor: "pointer",
                                                fontSize: 11,
                                                fontWeight: 600,
                                              }}
                                            >
                                              <i
                                                className="pi pi-eye"
                                                style={{
                                                  fontSize: 10,
                                                  marginRight: 3,
                                                }}
                                              />
                                              View
                                            </button>
                                            <button
                                              onClick={() => onEdit(room)}
                                              style={{
                                                flex: 1,
                                                border: "1px solid #e2e8f0",
                                                background: "#f8fafc",
                                                color: "#475569",
                                                borderRadius: 5,
                                                padding: "4px 0",
                                                cursor: "pointer",
                                                fontSize: 11,
                                                fontWeight: 600,
                                              }}
                                            >
                                              <i
                                                className="pi pi-pencil"
                                                style={{
                                                  fontSize: 10,
                                                  marginRight: 3,
                                                }}
                                              />
                                              Edit
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          marginTop: 12,
          background: "#fff",
          borderRadius: 8,
          padding: "8px 16px",
          border: "1px solid #e2e8f0",
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "center",
          boxShadow: "0 1px 4px rgba(0,0,0,.04)",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>
          STATUS:
        </span>
        {Object.entries(STATUS_CONFIG).map(([key, sc]) => (
          <span
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              color: "#64748b",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: sc.dot,
              }}
            />
            {key}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#cbd5e1" }}>
          Click header to collapse · Click card to view
        </span>
      </div>

      <RoomDetailModal
        visible={!!viewRoom}
        room={viewRoom}
        onHide={() => setViewRoom(null)}
        onEdit={onEdit}
      />
    </div>
  );
};

export default RoomVisualLayout;
