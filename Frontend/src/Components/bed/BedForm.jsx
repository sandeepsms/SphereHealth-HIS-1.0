import React, { useState, useEffect } from "react";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { InputTextarea } from "primereact/inputtextarea";
import { Toast } from "primereact/toast";
import { Tag } from "primereact/tag";
import { bedService } from "../../Services/bedService";
import { buildingService } from "../../Services/buildingService";
import { floorService } from "../../Services/floorService";
import { wardService } from "../../Services/wardService";
import { roomService } from "../../Services/roomService";
import { BED_STATUS } from "../../utils/constants";

/* ─────────────────────────────────────────────────────────────────────────
   HELPER — Parse a range string like "B001" to "B010" → ["B001"..."B010"]
   Supports:
     • Pure numeric prefix:  "101" to "110"  → 101,102,...110
     • Letter + number:      "B01" to "B10"  → B01,B02,...B10  (zero-padded)
     • Any prefix + number:  "ICU-001" to "ICU-005"
───────────────────────────────────────────────────────────────────────── */
const parseBedRange = (from, to) => {
  // Split into (prefix, numericPart)
  const splitNum = (str) => {
    const match = str.match(/^(.*?)(\d+)$/);
    if (!match) return null;
    return { prefix: match[1], num: match[2] };
  };

  const f = splitNum(from.trim().toUpperCase());
  const t = splitNum(to.trim().toUpperCase());

  if (!f || !t) return { error: "Invalid format. Use e.g. B001 to B010" };
  if (f.prefix !== t.prefix)
    return { error: "Prefix must be same (e.g. both start with B)" };

  const start = parseInt(f.num, 10);
  const end = parseInt(t.num, 10);

  if (isNaN(start) || isNaN(end)) return { error: "Invalid numbers" };
  if (start > end) return { error: "Start must be ≤ End" };
  if (end - start + 1 > 100) return { error: "Max 100 beds per batch" };

  const padLen = f.num.length; // preserve zero-padding from 'from'
  const beds = [];
  for (let i = start; i <= end; i++) {
    beds.push(`${f.prefix}${String(i).padStart(padLen, "0")}`);
  }
  return { beds };
};

/* ─────────────────────────────────────────────────────────────────────── */

const BedForm = ({ visible, onHide, bed, onSave }) => {
  // ── Mode: "single" or "bulk" (bulk only when creating new)
  const [mode, setMode] = useState("single");

  // ── Bulk range inputs
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [previewBeds, setPreviewBeds] = useState([]); // string[]
  const [rangeError, setRangeError] = useState("");

  const [formData, setFormData] = useState({
    building: "",
    floor: "",
    ward: null,
    room: "",
    bedNumber: "",
    status: "Available",
    isActive: true,
    notes: "",
  });

  const [buildings, setBuildings] = useState([]);
  const [allFloors, setAllFloors] = useState([]);
  const [allWards, setAllWards] = useState([]);
  const [allRooms, setAllRooms] = useState([]);

  const [filteredFloors, setFilteredFloors] = useState([]);
  const [filteredWards, setFilteredWards] = useState([]);
  const [filteredRooms, setFilteredRooms] = useState([]);

  const [loading, setLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null); // { done, total, failed[] }
  const toast = React.useRef(null);

  const statusOptions = Object.values(BED_STATUS).map((s) => ({
    label: s,
    value: s,
  }));

  /* ── Load data on open ── */
  useEffect(() => {
    if (visible) {
      loadAllData();
      // Reset mode when opening for edit (bulk not allowed for edit)
      if (bed) setMode("single");
    }
  }, [visible]);

  /* ── Cascade filters ── */
  useEffect(() => {
    if (formData.building && allFloors.length > 0) {
      setFilteredFloors(
        allFloors.filter(
          (f) => String(f.building) === String(formData.building),
        ),
      );
    } else {
      setFilteredFloors([]);
    }
  }, [formData.building, allFloors]);

  useEffect(() => {
    if (formData.floor && allWards.length > 0 && allRooms.length > 0) {
      setFilteredWards(
        allWards.filter((w) => String(w.floor) === String(formData.floor)),
      );
      setFilteredRooms(
        allRooms.filter((r) => String(r.floor) === String(formData.floor)),
      );
    } else {
      setFilteredWards([]);
      setFilteredRooms([]);
    }
  }, [formData.floor, allWards, allRooms]);

  useEffect(() => {
    if (formData.ward && formData.floor) {
      setFilteredRooms(
        allRooms.filter(
          (r) =>
            String(r.floor) === String(formData.floor) &&
            String(r.ward) === String(formData.ward),
        ),
      );
    }
  }, [formData.ward, allRooms, formData.floor]);

  /* ── Pre-fill when editing ── */
  useEffect(() => {
    if (bed && visible) {
      const { pricing, services, ...rest } = bed;
      setFormData(rest);
    } else if (!visible) {
      resetForm();
    }
  }, [bed, visible]);

  /* ── Live range preview ── */
  useEffect(() => {
    if (mode !== "bulk") return;
    if (!rangeFrom || !rangeTo) {
      setPreviewBeds([]);
      setRangeError("");
      return;
    }
    const result = parseBedRange(rangeFrom, rangeTo);
    if (result.error) {
      setRangeError(result.error);
      setPreviewBeds([]);
    } else {
      setRangeError("");
      setPreviewBeds(result.beds);
    }
  }, [rangeFrom, rangeTo, mode]);

  /* ── Data loading ── */
  const loadAllData = async () => {
    setLoading(true);
    try {
      const [buildingsData, floorsData, wardsData, roomsData] =
        await Promise.all([
          buildingService.getAllBuildings(),
          floorService.getAllFloors(),
          wardService.getAllWards(),
          roomService.getAllRooms(),
        ]);
      setBuildings(buildingsData);
      setAllFloors(floorsData);
      setAllWards(wardsData);
      setAllRooms(roomsData);
    } catch (error) {
      showToast("error", "Error", "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const showToast = (severity, summary, detail) =>
    toast.current?.show({ severity, summary, detail, life: 3000 });

  const resetForm = () => {
    setFormData({
      building: "",
      floor: "",
      ward: null,
      room: "",
      bedNumber: "",
      status: "Available",
      isActive: true,
      notes: "",
    });
    setFilteredFloors([]);
    setFilteredWards([]);
    setFilteredRooms([]);
    setMode("single");
    setRangeFrom("");
    setRangeTo("");
    setPreviewBeds([]);
    setRangeError("");
    setBulkProgress(null);
  };

  /* ── Validate common location fields ── */
  const validateLocation = () => {
    if (!formData.building) {
      showToast("warn", "Warning", "Please select a building");
      return false;
    }
    if (!formData.floor) {
      showToast("warn", "Warning", "Please select a floor");
      return false;
    }
    if (!formData.room) {
      showToast("warn", "Warning", "Please select a room");
      return false;
    }
    return true;
  };

  /* ── Single bed save ── */
  const handleSingleSubmit = async () => {
    if (!formData.bedNumber)
      return showToast("warn", "Warning", "Please enter bed number");
    if (!validateLocation()) return;

    setLoading(true);
    try {
      if (bed?._id) {
        await bedService.updateBed(bed._id, formData);
        showToast("success", "Success", "Bed updated successfully");
      } else {
        await bedService.createBed(formData);
        showToast("success", "Success", "Bed created successfully");
      }
      onSave();
      onHide();
      resetForm();
    } catch (error) {
      showToast(
        "error",
        "Error",
        `Failed to save bed: ${error.message || "Unknown error"}`,
      );
    } finally {
      setLoading(false);
    }
  };

  /* ── Bulk bed save ── */
  const handleBulkSubmit = async () => {
    if (!validateLocation()) return;
    if (previewBeds.length === 0)
      return showToast("warn", "Warning", "Enter a valid range first");
    if (rangeError) return showToast("warn", "Warning", rangeError);

    setLoading(true);
    const failed = [];
    setBulkProgress({ done: 0, total: previewBeds.length, failed: [] });

    for (let i = 0; i < previewBeds.length; i++) {
      const bedNum = previewBeds[i];
      try {
        await bedService.createBed({ ...formData, bedNumber: bedNum });
      } catch {
        failed.push(bedNum);
      }
      setBulkProgress({ done: i + 1, total: previewBeds.length, failed });
    }

    setLoading(false);
    const success = previewBeds.length - failed.length;

    if (failed.length === 0) {
      showToast(
        "success",
        "Bulk Created",
        `${success} beds created successfully!`,
      );
    } else {
      showToast(
        "warn",
        "Partial Success",
        `${success} created, ${failed.length} failed: ${failed.join(", ")}`,
      );
    }

    onSave();
    onHide();
    resetForm();
  };

  /* ── Footer ── */
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
            ? `Create ${previewBeds.length || ""} Beds`
            : bed
              ? "Update"
              : "Create Bed"
        }
        icon={mode === "bulk" ? "pi pi-copy" : "pi pi-check"}
        onClick={mode === "bulk" ? handleBulkSubmit : handleSingleSubmit}
        loading={loading}
        disabled={mode === "bulk" && (previewBeds.length === 0 || !!rangeError)}
        style={
          mode === "bulk" && previewBeds.length > 0
            ? { background: "#0891b2", border: "none" }
            : {}
        }
      />
    </div>
  );

  /* ── Shared location fields ── */
  const LocationFields = () => (
    <>
      {/* Building */}
      <div className="p-field mb-3">
        <label htmlFor="building">Building *</label>
        <Dropdown
          id="building"
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
              room: "",
            })
          }
          placeholder="Select Building"
          disabled={loading}
        />
      </div>

      {/* Floor */}
      <div className="p-field mb-3">
        <label htmlFor="floor">Floor *</label>
        <Dropdown
          id="floor"
          value={formData.floor}
          options={filteredFloors.map((f) => ({
            label: `${f.floorName} (${f.floorNumber})`,
            value: f._id,
          }))}
          onChange={(e) =>
            setFormData({ ...formData, floor: e.value, ward: null, room: "" })
          }
          placeholder="Select Floor"
          disabled={!formData.building || loading}
        />
      </div>

      {/* Ward (Optional) */}
      <div className="p-field mb-3">
        <label htmlFor="ward">Ward (Optional)</label>
        <Dropdown
          id="ward"
          value={formData.ward}
          options={filteredWards.map((w) => ({
            label: w.wardName,
            value: w._id,
          }))}
          onChange={(e) => setFormData({ ...formData, ward: e.value })}
          placeholder="Select Ward"
          disabled={!formData.floor || loading}
          showClear
        />
      </div>

      {/* Room */}
      <div className="p-field mb-3">
        <label htmlFor="room">Room *</label>
        <Dropdown
          id="room"
          value={formData.room}
          options={filteredRooms.map((r) => ({
            label: `${r.roomNumber}${r.roomName ? ` - ${r.roomName}` : ""}`,
            value: r._id,
          }))}
          onChange={(e) => setFormData({ ...formData, room: e.value })}
          placeholder="Select Room"
          disabled={!formData.floor || loading}
        />
      </div>
    </>
  );

  /* ── Render ── */
  return (
    <>
      <Toast ref={toast} />
      <Dialog
        visible={visible}
        style={{ width: "620px", maxHeight: "90vh" }}
        header={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <i
              className="pi pi-th-large"
              style={{ color: "#0891b2", fontSize: 18 }}
            />
            <span>{bed ? "Edit Bed" : "Add Bed(s)"}</span>
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
          {/* ── MODE TOGGLE (only when creating) ── */}
          {!bed && (
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
                  label: "Single Bed",
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

          {/* ══ SINGLE MODE ══ */}
          {mode === "single" && (
            <>
              <LocationFields />

              {/* Bed Number & Status */}
              <div className="grid">
                <div className="col-6">
                  <div className="p-field mb-3">
                    <label htmlFor="bedNumber">Bed Number *</label>
                    <InputText
                      id="bedNumber"
                      value={formData.bedNumber}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          bedNumber: e.target.value.toUpperCase(),
                        })
                      }
                      placeholder="e.g. B-101"
                    />
                  </div>
                </div>
                <div className="col-6">
                  <div className="p-field mb-3">
                    <label htmlFor="status">Status</label>
                    <Dropdown
                      id="status"
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

              {/* Pricing note */}
              <div
                style={{
                  backgroundColor: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: 6,
                  padding: "12px 16px",
                  marginBottom: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <i
                  className="pi pi-info-circle"
                  style={{ color: "#3b82f6", fontSize: 16 }}
                />
                <span style={{ fontSize: 13, color: "#1e40af" }}>
                  Pricing is managed through TPA configuration and applied at
                  the time of billing.
                </span>
              </div>

              {/* Notes */}
              <div className="p-field mb-3">
                <label htmlFor="notes">Notes</label>
                <InputTextarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  rows={3}
                  placeholder="Enter notes"
                />
              </div>

              {/* Active */}
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

          {/* ══ BULK MODE ══ */}
          {mode === "bulk" && (
            <>
              {/* How-to tip */}
              <div
                style={{
                  backgroundColor: "#f0fdf4",
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
                  <strong>Range Format:</strong> Enter start and end bed numbers
                  with the same prefix. Zero-padding is preserved automatically.
                  <br />
                  <span style={{ opacity: 0.8 }}>
                    Examples: &nbsp;<code>B001</code> → <code>B010</code>{" "}
                    &nbsp;|&nbsp;
                    <code>ICU-01</code> → <code>ICU-20</code>
                  </span>
                </div>
              </div>

              {/* Range inputs */}
              <div className="grid mb-3">
                <div className="col-5">
                  <div className="p-field">
                    <label>From (Start) *</label>
                    <InputText
                      value={rangeFrom}
                      onChange={(e) =>
                        setRangeFrom(e.target.value.toUpperCase())
                      }
                      placeholder="e.g. B001"
                    />
                  </div>
                </div>
                <div
                  className="col-2"
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    paddingBottom: 8,
                    fontSize: 20,
                    color: "#94a3b8",
                  }}
                >
                  →
                </div>
                <div className="col-5">
                  <div className="p-field">
                    <label>To (End) *</label>
                    <InputText
                      value={rangeTo}
                      onChange={(e) => setRangeTo(e.target.value.toUpperCase())}
                      placeholder="e.g. B010"
                    />
                  </div>
                </div>
              </div>

              {/* Range error */}
              {rangeError && (
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
                  <i className="pi pi-exclamation-circle" />
                  {rangeError}
                </div>
              )}

              {/* Preview */}
              {previewBeds.length > 0 && (
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
                    <strong style={{ fontSize: 13, color: "#0f172a" }}>
                      Preview — {previewBeds.length} beds will be created
                    </strong>
                    <Tag
                      value={`${previewBeds.length} beds`}
                      severity="info"
                      style={{ fontSize: 11 }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      maxHeight: 120,
                      overflowY: "auto",
                    }}
                  >
                    {previewBeds.map((b) => (
                      <span
                        key={b}
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
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Location fields */}
              <LocationFields />

              {/* Status for all bulk beds */}
              <div className="p-field mb-3">
                <label>Status (applied to all beds)</label>
                <Dropdown
                  value={formData.status}
                  options={statusOptions}
                  onChange={(e) =>
                    setFormData({ ...formData, status: e.value })
                  }
                  placeholder="Select Status"
                />
              </div>

              {/* Notes */}
              <div className="p-field mb-3">
                <label>Notes (applied to all beds)</label>
                <InputTextarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  rows={2}
                  placeholder="Optional notes for all beds"
                />
              </div>

              {/* Active checkbox */}
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

              {/* Progress bar while creating */}
              {bulkProgress && (
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
                    <span>Creating beds…</span>
                    <span>
                      {bulkProgress.done} / {bulkProgress.total}
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
                          bulkProgress.failed.length > 0
                            ? "#f59e0b"
                            : "#0891b2",
                        height: "100%",
                        width: `${(bulkProgress.done / bulkProgress.total) * 100}%`,
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

export default BedForm;
