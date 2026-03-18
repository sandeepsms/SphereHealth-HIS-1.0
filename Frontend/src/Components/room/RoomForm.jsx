import React, { useState, useEffect } from "react";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { InputTextarea } from "primereact/inputtextarea";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { roomService } from "../../Services/roomService";
import { buildingService } from "../../Services/buildingService";
import { floorService } from "../../Services/floorService";
import { wardService } from "../../Services/wardService";
import { roomCategoryService } from "../../Services/roomCategoryService";

const genRoomCode = (roomNumber = "") => {
  const base = roomNumber ? roomNumber.toUpperCase().replace(/\s+/g, "-") : "";
  const rand = Math.floor(Math.random() * 900 + 100);
  const ts = Date.now().toString().slice(-4);
  return base ? `${base}-${ts}${rand}` : `R-${ts}${rand}`;
};

const parseRoomRange = (from, to) => {
  const split = (str) => {
    const m = str.match(/^(.*?)(\d+)$/);
    return m ? { prefix: m[1], num: m[2] } : null;
  };
  const f = split(from.trim().toUpperCase());
  const t = split(to.trim().toUpperCase());
  if (!f || !t)
    return { error: "Invalid format. Use e.g. 101 to 110 or A01 to A10" };
  if (f.prefix !== t.prefix)
    return { error: "Prefix must be same for both (e.g. both A)" };
  const start = parseInt(f.num, 10);
  const end = parseInt(t.num, 10);
  if (isNaN(start) || isNaN(end)) return { error: "Invalid numbers" };
  if (start > end) return { error: "Start must be ≤ End" };
  if (end - start + 1 > 50) return { error: "Max 50 rooms per batch" };
  const padLen = f.num.length;
  const rooms = [];
  for (let i = start; i <= end; i++)
    rooms.push(`${f.prefix}${String(i).padStart(padLen, "0")}`);
  return { rooms };
};

const RoomForm = ({ visible, onHide, room, onSave }) => {
  const toast = React.useRef(null);

  const [mode, setMode] = useState("single");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [preview, setPreview] = useState([]);
  const [rangeErr, setRangeErr] = useState("");

  const [formData, setFormData] = useState({
    building: "",
    floor: "",
    ward: null,
    roomNumber: "",
    roomName: "",
    roomCategory: "",
    totalBeds: 1,
    status: "Active",
    isActive: true,
    notes: "",
  });

  const [buildings, setBuildings] = useState([]);
  const [allFloors, setAllFloors] = useState([]);
  const [allWards, setAllWards] = useState([]);
  const [filtFloors, setFiltFloors] = useState([]);
  const [filtWards, setFiltWards] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bulkProg, setBulkProg] = useState(null);

  const statusOptions = [
    { label: "Active", value: "Active" },
    { label: "Inactive", value: "Inactive" },
    { label: "Under Maintenance", value: "Under Maintenance" },
    { label: "Blocked", value: "Blocked" },
  ];

  useEffect(() => {
    if (visible) {
      loadAll();
      if (room) setMode("single");
    }
  }, [visible]);

  useEffect(() => {
    setFiltFloors(
      allFloors.filter((f) => String(f.building) === String(formData.building)),
    );
  }, [formData.building, allFloors]);

  useEffect(() => {
    setFiltWards(
      allWards.filter((w) => String(w.floor) === String(formData.floor)),
    );
  }, [formData.floor, allWards]);

  useEffect(() => {
    if (room && visible) setFormData(room);
    else if (!visible) resetForm();
  }, [room, visible]);

  useEffect(() => {
    if (mode !== "bulk" || !rangeFrom || !rangeTo) {
      setPreview([]);
      setRangeErr("");
      return;
    }
    const r = parseRoomRange(rangeFrom, rangeTo);
    if (r.error) {
      setRangeErr(r.error);
      setPreview([]);
    } else {
      setRangeErr("");
      setPreview(r.rooms);
    }
  }, [rangeFrom, rangeTo, mode]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [b, f, w, c] = await Promise.all([
        buildingService.getAllBuildings(),
        floorService.getAllFloors(),
        wardService.getAllWards(),
        roomCategoryService.getAllCategories(),
      ]);
      setBuildings(b || []);
      setAllFloors(f || []);
      setAllWards(w || []);
      setCategories(c || []);
    } catch {
      showToast("error", "Error", "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const showToast = (severity, summary, detail) =>
    toast.current?.show({ severity, summary, detail, life: 3500 });

  const resetForm = () => {
    setFormData({
      building: "",
      floor: "",
      ward: null,
      roomNumber: "",
      roomName: "",
      roomCategory: "",
      totalBeds: 1,
      status: "Active",
      isActive: true,
      notes: "",
    });
    setFiltFloors([]);
    setFiltWards([]);
    setMode("single");
    setRangeFrom("");
    setRangeTo("");
    setPreview([]);
    setRangeErr("");
    setBulkProg(null);
  };

  const validateLocation = () => {
    if (!formData.building) {
      showToast("warn", "Warning", "Please select a building");
      return false;
    }
    if (!formData.floor) {
      showToast("warn", "Warning", "Please select a floor");
      return false;
    }
    if (!formData.roomCategory) {
      showToast("warn", "Warning", "Please select a room category");
      return false;
    }
    return true;
  };

  const handleSingleSubmit = async () => {
    if (!formData.roomNumber)
      return showToast("warn", "Warning", "Please enter room number");
    if (!validateLocation()) return;
    setLoading(true);
    try {
      const payload = {
        building: formData.building,
        floor: formData.floor,
        ward: formData.ward || null,
        roomNumber: formData.roomNumber,
        roomName: formData.roomName?.trim() || `Room ${formData.roomNumber}`,
        roomCategory: formData.roomCategory,
        totalBeds: formData.totalBeds || 1,
        status: formData.status || "Active",
        isActive: formData.isActive ?? true,
        notes: formData.notes || "",
        roomCode: genRoomCode(formData.roomNumber),
      };
      if (room?._id) await roomService.updateRoom(room._id, payload);
      else await roomService.createRoom(payload);
      showToast(
        "success",
        "Success",
        room?._id ? "Room updated!" : "Room created!",
      );
      onSave();
      onHide();
      resetForm();
    } catch (e) {
      showToast("error", "Error", e.message || "Failed to save room");
    } finally {
      setLoading(false);
    }
  };

  const handleBulkSubmit = async () => {
    if (!validateLocation()) return;
    if (preview.length === 0 || rangeErr)
      return showToast("warn", "Warning", rangeErr || "Enter valid range");

    setLoading(true);
    const failed = [];
    setBulkProg({ done: 0, total: preview.length, failed: [] });

    for (let i = 0; i < preview.length; i++) {
      const rn = preview[i];
      try {
        const roomName = formData.roomName?.trim()
          ? `${formData.roomName.trim()} ${rn}`
          : `Room ${rn}`;
        await roomService.createRoom({
          building: formData.building,
          floor: formData.floor,
          ward: formData.ward || null,
          roomNumber: rn,
          roomName,
          roomCategory: formData.roomCategory,
          totalBeds: formData.totalBeds || 1,
          status: formData.status || "Active",
          isActive: formData.isActive ?? true,
          notes: formData.notes || "",
          roomCode: genRoomCode(rn),
        });
      } catch {
        failed.push(rn);
      }
      setBulkProg({ done: i + 1, total: preview.length, failed });
    }

    setLoading(false);
    const ok = preview.length - failed.length;
    if (failed.length === 0)
      showToast("success", "Bulk Created", `${ok} rooms created!`);
    else
      showToast(
        "warn",
        "Partial",
        `${ok} created, ${failed.length} failed: ${failed.join(", ")}`,
      );
    onSave();
    onHide();
    resetForm();
  };

  const footer = (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <Button
        label="Cancel"
        icon="pi pi-times"
        onClick={() => {
          onHide();
          resetForm();
        }}
        className="p-button-text"
        disabled={loading}
      />
      <Button
        label={
          mode === "bulk"
            ? `Create ${preview.length || ""} Rooms`
            : room
              ? "Update"
              : "Create Room"
        }
        icon={mode === "bulk" ? "pi pi-copy" : "pi pi-check"}
        onClick={mode === "bulk" ? handleBulkSubmit : handleSingleSubmit}
        loading={loading}
        disabled={mode === "bulk" && (preview.length === 0 || !!rangeErr)}
        style={
          mode === "bulk" && preview.length > 0
            ? { background: "#0891b2", border: "none" }
            : {}
        }
      />
    </div>
  );

  const LocationFields = () => (
    <>
      <div className="p-field mb-3">
        <label>Building *</label>
        <Dropdown
          value={formData.building}
          options={buildings.map((b) => ({
            label: b.buildingName,
            value: b._id,
          }))}
          onChange={(e) =>
            setFormData({
              ...formData,
              building: e.value,
              floor: "",
              ward: null,
            })
          }
          placeholder="Select Building"
          disabled={loading}
          className="w-full"
        />
      </div>
      <div className="p-field mb-3">
        <label>Floor *</label>
        <Dropdown
          value={formData.floor}
          options={filtFloors.map((f) => ({
            label: f.floorName || `Floor ${f.floorNumber}`,
            value: f._id,
          }))}
          onChange={(e) =>
            setFormData({ ...formData, floor: e.value, ward: null })
          }
          placeholder="Select Floor"
          disabled={!formData.building || loading}
          className="w-full"
        />
      </div>
      <div className="p-field mb-3">
        <label>Ward (Optional)</label>
        <Dropdown
          value={formData.ward}
          options={filtWards.map((w) => ({ label: w.wardName, value: w._id }))}
          onChange={(e) => setFormData({ ...formData, ward: e.value })}
          placeholder="Select Ward"
          disabled={!formData.floor || loading}
          showClear
          className="w-full"
        />
      </div>
      <div className="p-field mb-3">
        <label>Room Category *</label>
        <Dropdown
          value={formData.roomCategory}
          options={categories.map((c) => ({
            label: c.categoryName,
            value: c._id,
          }))}
          onChange={(e) => setFormData({ ...formData, roomCategory: e.value })}
          placeholder="Select Category"
          disabled={loading}
          className="w-full"
        />
      </div>
    </>
  );

  return (
    <>
      <Toast ref={toast} />
      <Dialog
        visible={visible}
        style={{ width: "620px", maxHeight: "90vh" }}
        header={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <i
              className="pi pi-building"
              style={{ color: "#0891b2", fontSize: 18 }}
            />
            <span>{room ? "Edit Room" : "Add Room(s)"}</span>
          </div>
        }
        modal
        footer={footer}
        onHide={() => {
          onHide();
          resetForm();
        }}
      >
        <div
          className="p-fluid"
          style={{ maxHeight: "70vh", overflowY: "auto", padding: "10px" }}
        >
          {/* MODE TOGGLE */}
          {!room && (
            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 20,
                background: "#f1f5f9",
                borderRadius: 10,
                padding: 4,
              }}
            >
              {[
                {
                  key: "single",
                  icon: "pi pi-plus-circle",
                  label: "Single Room",
                },
                {
                  key: "bulk",
                  icon: "pi pi-copy",
                  label: "Bulk Create (Range)",
                },
              ].map(({ key, icon, label }) => {
                const active = mode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMode(key)}
                    style={{
                      flex: 1,
                      padding: "9px 0",
                      borderRadius: 7,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 7,
                      background: active ? "#0891b2" : "transparent",
                      color: active ? "#fff" : "#64748b",
                      transition: "all .18s",
                    }}
                  >
                    <i className={icon} />
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {/* SINGLE MODE */}
          {mode === "single" && (
            <>
              <LocationFields />
              <div className="grid">
                <div className="col-6">
                  <div className="p-field mb-3">
                    <label>Room Number *</label>
                    <InputText
                      value={formData.roomNumber}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          roomNumber: e.target.value.toUpperCase(),
                        })
                      }
                      placeholder="e.g. 101"
                    />
                  </div>
                </div>
                <div className="col-6">
                  <div className="p-field mb-3">
                    <label>Room Name</label>
                    <InputText
                      value={formData.roomName}
                      onChange={(e) =>
                        setFormData({ ...formData, roomName: e.target.value })
                      }
                      placeholder="e.g. General Ward A (optional)"
                    />
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 8,
                  padding: "10px 14px",
                  marginBottom: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <i className="pi pi-info-circle" style={{ color: "#16a34a" }} />
                <span style={{ fontSize: 13, color: "#166534" }}>
                  Room Code will be <strong>auto-generated</strong> as a unique
                  ID on save.
                </span>
              </div>

              <div className="grid">
                <div className="col-6">
                  <div className="p-field mb-3">
                    <label>Total Beds *</label>
                    <InputNumber
                      value={formData.totalBeds}
                      onValueChange={(e) =>
                        setFormData({ ...formData, totalBeds: e.value })
                      }
                      min={1}
                      showButtons
                    />
                  </div>
                </div>
                <div className="col-6">
                  <div className="p-field mb-3">
                    <label>Status</label>
                    <Dropdown
                      value={formData.status}
                      options={statusOptions}
                      onChange={(e) =>
                        setFormData({ ...formData, status: e.value })
                      }
                      placeholder="Select Status"
                    />
                  </div>
                </div>
              </div>

              <div className="p-field mb-3">
                <label>Notes</label>
                <InputTextarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  rows={3}
                  placeholder="Enter notes"
                />
              </div>

              <div className="p-field-checkbox mb-3">
                <Checkbox
                  inputId="isActive"
                  checked={formData.isActive}
                  onChange={(e) =>
                    setFormData({ ...formData, isActive: e.checked })
                  }
                />
                <label htmlFor="isActive" className="ml-2">
                  Active
                </label>
              </div>
            </>
          )}

          {/* BULK MODE */}
          {mode === "bulk" && (
            <>
              <div
                style={{
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 8,
                  padding: "12px 16px",
                  marginBottom: 18,
                  fontSize: 13,
                  color: "#166534",
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                }}
              >
                <i
                  className="pi pi-lightbulb"
                  style={{ color: "#16a34a", marginTop: 2, flexShrink: 0 }}
                />
                <div>
                  <strong>Range Format:</strong> Enter start and end room
                  numbers with same prefix.
                  <br />
                  <span style={{ opacity: 0.8 }}>
                    Examples: &nbsp;<code>101</code> → <code>110</code>{" "}
                    &nbsp;|&nbsp; <code>A01</code> → <code>A20</code>{" "}
                    &nbsp;|&nbsp; <code>ICU-01</code> → <code>ICU-05</code>
                  </span>
                  <br />
                  <span style={{ opacity: 0.7 }}>
                    Room codes are auto-generated uniquely for each room. Room
                    name prefix optional — auto-filled if blank.
                  </span>
                </div>
              </div>

              <div className="grid mb-3">
                <div className="col-5">
                  <label
                    style={{
                      display: "block",
                      marginBottom: 4,
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    From (Start) *
                  </label>
                  <InputText
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value.toUpperCase())}
                    placeholder="e.g. 101"
                    className="w-full"
                  />
                </div>
                <div
                  className="col-2"
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    paddingBottom: 8,
                    fontSize: 22,
                    color: "#94a3b8",
                  }}
                >
                  →
                </div>
                <div className="col-5">
                  <label
                    style={{
                      display: "block",
                      marginBottom: 4,
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    To (End) *
                  </label>
                  <InputText
                    value={rangeTo}
                    onChange={(e) => setRangeTo(e.target.value.toUpperCase())}
                    placeholder="e.g. 110"
                    className="w-full"
                  />
                </div>
              </div>

              {rangeErr && (
                <div
                  style={{
                    color: "#dc2626",
                    fontSize: 13,
                    marginBottom: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <i className="pi pi-exclamation-circle" /> {rangeErr}
                </div>
              )}

              {preview.length > 0 && (
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: "12px 16px",
                    marginBottom: 18,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 10,
                    }}
                  >
                    <strong style={{ fontSize: 13 }}>
                      Preview — {preview.length} rooms will be created
                    </strong>
                    <Tag
                      value={`${preview.length} rooms`}
                      severity="info"
                      style={{ fontSize: 11 }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      maxHeight: 100,
                      overflowY: "auto",
                    }}
                  >
                    {preview.map((r) => (
                      <span
                        key={r}
                        style={{
                          background: "#e0f2fe",
                          color: "#0369a1",
                          borderRadius: 5,
                          padding: "3px 8px",
                          fontSize: 12,
                          fontWeight: 600,
                          fontFamily: "monospace",
                        }}
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <LocationFields />

              <div className="p-field mb-3">
                <label>Room Name Prefix (optional)</label>
                <InputText
                  value={formData.roomName}
                  onChange={(e) =>
                    setFormData({ ...formData, roomName: e.target.value })
                  }
                  placeholder="e.g. 'General Ward' → 'General Ward 101' (blank = auto)"
                />
              </div>

              <div className="grid">
                <div className="col-6">
                  <div className="p-field mb-3">
                    <label>Beds Per Room *</label>
                    <InputNumber
                      value={formData.totalBeds}
                      onValueChange={(e) =>
                        setFormData({ ...formData, totalBeds: e.value })
                      }
                      min={1}
                      showButtons
                    />
                  </div>
                </div>
                <div className="col-6">
                  <div className="p-field mb-3">
                    <label>Status</label>
                    <Dropdown
                      value={formData.status}
                      options={statusOptions}
                      onChange={(e) =>
                        setFormData({ ...formData, status: e.value })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="p-field-checkbox mb-3">
                <Checkbox
                  inputId="isActiveBulk"
                  checked={formData.isActive}
                  onChange={(e) =>
                    setFormData({ ...formData, isActive: e.checked })
                  }
                />
                <label htmlFor="isActiveBulk" className="ml-2">
                  Active
                </label>
              </div>

              {bulkProg && (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      color: "#64748b",
                      marginBottom: 4,
                    }}
                  >
                    <span>Creating rooms…</span>
                    <span>
                      {bulkProg.done} / {bulkProg.total}
                    </span>
                  </div>
                  <div
                    style={{
                      background: "#e2e8f0",
                      borderRadius: 999,
                      height: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        background:
                          bulkProg.failed.length > 0 ? "#f59e0b" : "#0891b2",
                        height: "100%",
                        width: `${(bulkProg.done / bulkProg.total) * 100}%`,
                        transition: "width .2s",
                        borderRadius: 999,
                      }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Dialog>
    </>
  );
};

export default RoomForm;
