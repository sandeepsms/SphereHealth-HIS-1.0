import React, { useState, useEffect } from "react";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { Chips } from "primereact/chips";
import { Toast } from "primereact/toast";
import { wardService } from "../../Services/wardService";
import { buildingService } from "../../Services/buildingService";
import { floorService } from "../../Services/floorService";
import { WARD_TYPES } from "../../utils/constants";

const WardForm = ({ visible, onHide, ward, onSave }) => {
  const [formData, setFormData] = useState({
    building: "",
    floor: "",
    wardName: "",
    wardCode: "",
    wardType: "",
    totalBeds: 0,
    totalRooms: 0,
    hourlyCharge: 0,
    dailyCharge: 0,
    facilities: [],
    isActive: true,
  });

  const [buildings, setBuildings] = useState([]);
  const [allFloors, setAllFloors] = useState([]);
  const [filteredFloors, setFilteredFloors] = useState([]);
  const [loading, setLoading] = useState(false);
  const toast = React.useRef(null);

  // Load initial data
  useEffect(() => {
    if (visible) {
      loadBuildings();
      loadAllFloors();
    }
  }, [visible]);

  // Filter floors when building changes
  useEffect(() => {
    if (formData.building && allFloors.length > 0) {
      console.log("Filtering floors for building:", formData.building);
      const filtered = allFloors.filter(
        (f) => String(f.building) === String(formData.building)
      );
      console.log("Filtered floors:", filtered);
      setFilteredFloors(filtered);
    } else {
      setFilteredFloors([]);
    }
  }, [formData.building, allFloors]);

  // Load ward data for editing
  useEffect(() => {
    if (ward && visible) {
      console.log("Loading ward for edit:", ward);
      setFormData({
        building: ward.building?._id || ward.building || "",
        floor: ward.floor?._id || ward.floor || "",
        wardName: ward.wardName || "",
        wardCode: ward.wardCode || "",
        wardType: ward.wardType || "",
        totalBeds: ward.totalBeds || 0,
        totalRooms: ward.totalRooms || 0,
        hourlyCharge: ward.hourlyCharge || 0,
        dailyCharge: ward.dailyCharge || 0,
        facilities: ward.facilities || [],
        isActive: ward.isActive !== undefined ? ward.isActive : true,
      });
    } else if (!visible) {
      resetForm();
    }
  }, [ward, visible]);

  const loadBuildings = async () => {
    try {
      const data = await buildingService.getAllBuildings();
      console.log("Buildings loaded:", data);
      setBuildings(data);
    } catch (error) {
      console.error("Error loading buildings:", error);
      showToast("error", "Error", "Failed to load buildings");
    }
  };

  const loadAllFloors = async () => {
    try {
      const data = await floorService.getAllFloors();
      console.log("All floors loaded:", data);
      setAllFloors(data);
    } catch (error) {
      console.error("Error loading floors:", error);
      showToast("error", "Error", "Failed to load floors");
    }
  };

  const showToast = (severity, summary, detail) => {
    toast.current?.show({ severity, summary, detail, life: 3000 });
  };

  const resetForm = () => {
    setFormData({
      building: "",
      floor: "",
      wardName: "",
      wardCode: "",
      wardType: "",
      totalBeds: 0,
      totalRooms: 0,
      hourlyCharge: 0,
      dailyCharge: 0,
      facilities: [],
      isActive: true,
    });
    setFilteredFloors([]);
  };

  const handleSubmit = async () => {
    // Validation
    if (!formData.building) {
      showToast("warn", "Warning", "Please select a building");
      return;
    }
    if (!formData.floor) {
      showToast("warn", "Warning", "Please select a floor");
      return;
    }
    if (!formData.wardName) {
      showToast("warn", "Warning", "Please enter ward name");
      return;
    }
    if (!formData.wardCode) {
      showToast("warn", "Warning", "Please enter ward code");
      return;
    }

    setLoading(true);
    try {
      console.log("Submitting ward data:", formData);

      if (ward?._id) {
        await wardService.updateWard(ward._id, formData);
        showToast("success", "Success", "Ward updated successfully");
      } else {
        await wardService.createWard(formData);
        showToast("success", "Success", "Ward created successfully");
      }

      // ✅ CRITICAL FIX: Call onSave and onHide properly
      setTimeout(() => {
        if (typeof onSave === "function") {
          onSave(); // Notify parent to refresh
        }
        if (typeof onHide === "function") {
          onHide(); // Close dialog
        }
        resetForm(); // Reset form
      }, 500); // Small delay to show toast
    } catch (error) {
      console.error("Error saving ward:", error);
      const errorMessage =
        error.response?.data?.message || error.message || "Failed to save ward";
      showToast("error", "Error", errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    if (typeof onHide === "function") {
      onHide();
    }
  };

  const footer = (
    <div>
      <Button
        label="Cancel"
        icon="pi pi-times"
        onClick={handleCancel}
        className="p-button-text"
        disabled={loading}
      />
      <Button
        label="Save"
        icon="pi pi-check"
        onClick={handleSubmit}
        loading={loading}
        disabled={loading}
      />
    </div>
  );

  return (
    <>
      <Toast ref={toast} />
      <Dialog
        visible={visible}
        style={{ width: "650px", maxHeight: "90vh" }}
        header={
          <div className="flex align-items-center gap-2">
            <i className="pi pi-home text-primary"></i>
            <span>{ward ? "Edit Ward" : "Add New Ward"}</span>
          </div>
        }
        modal
        footer={footer}
        onHide={handleCancel}
        closable={!loading}
      >
        <div
          className="p-fluid"
          style={{ maxHeight: "70vh", overflowY: "auto", padding: "5px" }}
        >
          {/* Building Selection */}
          <div className="p-field mb-3">
            <label htmlFor="building">
              <i
                className="pi pi-building mr-2"
                style={{ color: "#3b82f6" }}
              ></i>
              Building *
            </label>
            <Dropdown
              id="building"
              value={formData.building}
              options={buildings.map((b) => ({
                label: b.buildingName,
                value: b._id,
              }))}
              onChange={(e) => {
                console.log("Building selected:", e.value);
                setFormData({ ...formData, building: e.value, floor: "" });
              }}
              placeholder="Select Building"
              disabled={loading}
            />
            {buildings.length === 0 && (
              <small
                style={{ color: "#ef4444", marginTop: "5px", display: "block" }}
              >
                No buildings available. Please add a building first.
              </small>
            )}
          </div>

          {/* Floor Selection */}
          <div className="p-field mb-3">
            <label htmlFor="floor">
              <i
                className="pi pi-arrows-v mr-2"
                style={{ color: "#10b981" }}
              ></i>
              Floor *
            </label>
            <Dropdown
              id="floor"
              value={formData.floor}
              options={filteredFloors.map((f) => ({
                label: `${f.floorName} (${f.floorNumber})`,
                value: f._id,
              }))}
              onChange={(e) => {
                console.log("Floor selected:", e.value);
                setFormData({ ...formData, floor: e.value });
              }}
              placeholder="Select Floor"
              disabled={!formData.building || loading}
            />
            {formData.building && filteredFloors.length === 0 && (
              <small
                style={{ color: "#ef4444", marginTop: "5px", display: "block" }}
              >
                No floors available for this building. Please add floors first.
              </small>
            )}
          </div>

          {/* Ward Name */}
          <div className="p-field mb-3">
            <label htmlFor="wardName">Ward Name *</label>
            <InputText
              id="wardName"
              value={formData.wardName}
              onChange={(e) =>
                setFormData({ ...formData, wardName: e.target.value })
              }
              placeholder="e.g., General Ward A, ICU Ward"
              disabled={loading}
            />
          </div>

          {/* Ward Code */}
          <div className="p-field mb-3">
            <label htmlFor="wardCode">Ward Code *</label>
            <InputText
              id="wardCode"
              value={formData.wardCode}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  wardCode: e.target.value.toUpperCase(),
                })
              }
              placeholder="e.g., GWA, ICUW"
              disabled={loading}
            />
          </div>

          {/* Ward Type */}
          <div className="p-field mb-3">
            <label htmlFor="wardType">Ward Type</label>
            <Dropdown
              id="wardType"
              value={formData.wardType}
              options={WARD_TYPES}
              onChange={(e) => setFormData({ ...formData, wardType: e.value })}
              placeholder="Select Ward Type"
              disabled={loading}
            />
          </div>

          {/* Total Beds and Rooms */}
          <div className="grid">
            <div className="col-6">
              <div className="p-field mb-3">
                <label htmlFor="totalBeds">Total Beds</label>
                <InputNumber
                  id="totalBeds"
                  value={formData.totalBeds}
                  onValueChange={(e) =>
                    setFormData({ ...formData, totalBeds: e.value || 0 })
                  }
                  min={0}
                  showButtons
                  disabled={loading}
                />
              </div>
            </div>
            <div className="col-6">
              <div className="p-field mb-3">
                <label htmlFor="totalRooms">Total Rooms</label>
                <InputNumber
                  id="totalRooms"
                  value={formData.totalRooms}
                  onValueChange={(e) =>
                    setFormData({ ...formData, totalRooms: e.value || 0 })
                  }
                  min={0}
                  showButtons
                  disabled={loading}
                />
              </div>
            </div>
          </div>

          {/* Charges */}
          <div className="grid">
            <div className="col-6">
              <div className="p-field mb-3">
                <label htmlFor="hourlyCharge">Hourly Charge</label>
                <InputNumber
                  id="hourlyCharge"
                  value={formData.hourlyCharge}
                  onValueChange={(e) =>
                    setFormData({ ...formData, hourlyCharge: e.value || 0 })
                  }
                  mode="currency"
                  currency="INR"
                  locale="en-IN"
                  disabled={loading}
                />
              </div>
            </div>
            <div className="col-6">
              <div className="p-field mb-3">
                <label htmlFor="dailyCharge">Daily Charge</label>
                <InputNumber
                  id="dailyCharge"
                  value={formData.dailyCharge}
                  onValueChange={(e) =>
                    setFormData({ ...formData, dailyCharge: e.value || 0 })
                  }
                  mode="currency"
                  currency="INR"
                  locale="en-IN"
                  disabled={loading}
                />
              </div>
            </div>
          </div>

          {/* Facilities */}
          <div className="p-field mb-3">
            <label htmlFor="facilities">
              <i className="pi pi-star mr-2" style={{ color: "#f59e0b" }}></i>
              Facilities
            </label>
            <Chips
              id="facilities"
              value={formData.facilities}
              onChange={(e) =>
                setFormData({ ...formData, facilities: e.value || [] })
              }
              placeholder="Add facilities (press Enter)"
              disabled={loading}
            />
            <small
              style={{ color: "#666", display: "block", marginTop: "5px" }}
            >
              Type facility name and press Enter (e.g., AC, TV, WiFi,
              Ventilator)
            </small>
          </div>

          {/* Active Checkbox */}
          <div className="p-field-checkbox mb-3">
            <Checkbox
              inputId="isActive"
              checked={formData.isActive}
              onChange={(e) =>
                setFormData({ ...formData, isActive: e.checked })
              }
              disabled={loading}
            />
            <label htmlFor="isActive" className="ml-2">
              Active
            </label>
          </div>

          {/* Info Box */}
          <div
            style={{
              backgroundColor: "#f0f9ff",
              padding: "15px",
              borderRadius: "8px",
              border: "2px solid #3b82f6",
              marginTop: "15px",
            }}
          >
            <h4 style={{ margin: "0 0 10px 0", color: "#1e40af" }}>
              <i className="pi pi-info-circle mr-2"></i>Hospital Hierarchy
            </h4>
            <div
              style={{ fontSize: "14px", color: "#1e40af", lineHeight: "1.6" }}
            >
              <div>
                📍 <strong>Building</strong> → Main structure
              </div>
              <div>
                📍 <strong>Floor</strong> → Level in building
              </div>
              <div>
                📍 <strong>Ward</strong> → Section in floor (groups rooms)
              </div>
              <div>
                📍 <strong>Room</strong> → Individual room in ward
              </div>
              <div>
                📍 <strong>Bed</strong> → Bed in room
              </div>
            </div>
            <small
              style={{
                color: "#1e40af",
                display: "block",
                marginTop: "10px",
                fontStyle: "italic",
              }}
            >
              * Ward groups multiple rooms together. Some rooms can exist
              without ward.
            </small>
          </div>
        </div>
      </Dialog>
    </>
  );
};

export default WardForm;
