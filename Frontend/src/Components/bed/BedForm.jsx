import React, { useState, useEffect } from "react";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { InputTextarea } from "primereact/inputtextarea";
import { Toast } from "primereact/toast";
import { bedService } from "../../services/bedService";
import { buildingService } from "../../services/buildingService";
import { floorService } from "../../services/floorService";
import { wardService } from "../../services/wardService";
import { roomService } from "../../services/roomService";
import { BED_STATUS } from "../../utils/constants";

const BedForm = ({ visible, onHide, bed, onSave }) => {
  const [formData, setFormData] = useState({
    building: "",
    floor: "",
    ward: null,
    room: "",
    bedNumber: "",
    status: "Available",
    pricing: {
      perBedDailyRate: 0,
      nursingCharges: 0,
      equipmentCharges: 0,
      securityDeposit: 0,
      currency: "INR",
    },
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
  const toast = React.useRef(null);

  const statusOptions = Object.values(BED_STATUS).map((status) => ({
    label: status,
    value: status,
  }));

  // Load all data on mount
  useEffect(() => {
    if (visible) {
      console.log("BedForm opened");
      loadAllData();
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

  // Filter wards and rooms when floor changes
  useEffect(() => {
    if (formData.floor && allWards.length > 0 && allRooms.length > 0) {
      console.log("Filtering wards and rooms for floor:", formData.floor);

      const filteredW = allWards.filter(
        (w) => String(w.floor) === String(formData.floor)
      );
      const filteredR = allRooms.filter(
        (r) => String(r.floor) === String(formData.floor)
      );

      console.log("Filtered wards:", filteredW);
      console.log("Filtered rooms:", filteredR);

      setFilteredWards(filteredW);
      setFilteredRooms(filteredR);
    } else {
      setFilteredWards([]);
      setFilteredRooms([]);
    }
  }, [formData.floor, allWards, allRooms]);

  // Filter rooms when ward changes
  useEffect(() => {
    if (formData.ward && formData.floor) {
      const filtered = allRooms.filter(
        (r) =>
          String(r.floor) === String(formData.floor) &&
          String(r.ward) === String(formData.ward)
      );
      console.log("Filtered rooms for ward:", filtered);
      setFilteredRooms(filtered);
    }
  }, [formData.ward, allRooms, formData.floor]);

  // Load form data when bed prop changes
  useEffect(() => {
    if (bed && visible) {
      console.log("Loading bed for edit:", bed);
      setFormData(bed);
    } else if (!visible) {
      resetForm();
    }
  }, [bed, visible]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      console.log("Loading all data...");

      const [buildingsData, floorsData, wardsData, roomsData] =
        await Promise.all([
          buildingService.getAllBuildings(),
          floorService.getAllFloors(),
          wardService.getAllWards(),
          roomService.getAllRooms(),
        ]);

      console.log("Data loaded:");
      console.log("- Buildings:", buildingsData);
      console.log("- Floors:", floorsData);
      console.log("- Wards:", wardsData);
      console.log("- Rooms:", roomsData);

      setBuildings(buildingsData);
      setAllFloors(floorsData);
      setAllWards(wardsData);
      setAllRooms(roomsData);
    } catch (error) {
      console.error("Error loading data:", error);
      showToast("error", "Error", "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const showToast = (severity, summary, detail) => {
    toast.current?.show({ severity, summary, detail, life: 3000 });
  };

  const resetForm = () => {
    console.log("Resetting form");
    setFormData({
      building: "",
      floor: "",
      ward: null,
      room: "",
      bedNumber: "",
      status: "Available",
      pricing: {
        perBedDailyRate: 0,
        nursingCharges: 0,
        equipmentCharges: 0,
        securityDeposit: 0,
        currency: "INR",
      },
      isActive: true,
      notes: "",
    });
    setFilteredFloors([]);
    setFilteredWards([]);
    setFilteredRooms([]);
  };

  const handleSubmit = async () => {
    console.log("=== SUBMIT STARTED ===");
    console.log("Current form data:", formData);

    // Validation
    if (!formData.bedNumber) {
      console.error("Validation failed: No bed number");
      showToast("warn", "Warning", "Please enter bed number");
      return;
    }
    if (!formData.building) {
      console.error("Validation failed: No building");
      showToast("warn", "Warning", "Please select a building");
      return;
    }
    if (!formData.floor) {
      console.error("Validation failed: No floor");
      showToast("warn", "Warning", "Please select a floor");
      return;
    }
    if (!formData.room) {
      console.error("Validation failed: No room");
      showToast("warn", "Warning", "Please select a room");
      return;
    }

    setLoading(true);
    try {
      console.log("Submitting bed data to API:", formData);

      let result;
      if (bed?._id) {
        console.log("Updating existing bed:", bed._id);
        result = await bedService.updateBed(bed._id, formData);
      } else {
        console.log("Creating new bed");
        result = await bedService.createBed(formData);
      }

      console.log("API Response:", result);
      showToast(
        "success",
        "Success",
        bed?._id ? "Bed updated successfully" : "Bed created successfully"
      );

      onSave();
      onHide();
      resetForm();
    } catch (error) {
      console.error("=== ERROR SAVING BED ===");
      console.error("Error object:", error);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);

      showToast(
        "error",
        "Error",
        `Failed to save bed: ${error.message || "Unknown error"}`
      );
    } finally {
      setLoading(false);
      console.log("=== SUBMIT ENDED ===");
    }
  };

  const footer = (
    <div>
      <Button
        label="Cancel"
        icon="pi pi-times"
        onClick={() => {
          console.log("Cancel clicked");
          onHide();
          resetForm();
        }}
        className="p-button-text"
      />
      <Button
        label="Save"
        icon="pi pi-check"
        onClick={handleSubmit}
        loading={loading}
      />
    </div>
  );

  return (
    <>
      <Toast ref={toast} />
      <Dialog
        visible={visible}
        style={{ width: "700px", maxHeight: "90vh" }}
        header={bed ? "Edit Bed" : "Add New Bed"}
        modal
        footer={footer}
        onHide={() => {
          console.log("Dialog closed");
          onHide();
          resetForm();
        }}
      >
        <div
          className="p-fluid"
          style={{ maxHeight: "70vh", overflowY: "auto", padding: "10px" }}
        >
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
              onChange={(e) => {
                console.log("Building selected:", e.value);
                setFormData({
                  ...formData,
                  building: e.value,
                  floor: "",
                  ward: null,
                  room: "",
                });
              }}
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
              onChange={(e) => {
                console.log("Floor selected:", e.value);
                setFormData({
                  ...formData,
                  floor: e.value,
                  ward: null,
                  room: "",
                });
              }}
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
              onChange={(e) => {
                console.log("Ward selected:", e.value);
                setFormData({ ...formData, ward: e.value });
              }}
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
              onChange={(e) => {
                console.log("Room selected:", e.value);
                setFormData({ ...formData, room: e.value });
              }}
              placeholder="Select Room"
              disabled={!formData.floor || loading}
            />
          </div>

          {/* Bed Number */}
          <div className="grid">
            <div className="col-6">
              <div className="p-field mb-3">
                <label htmlFor="bedNumber">Bed Number *</label>
                <InputText
                  id="bedNumber"
                  value={formData.bedNumber}
                  onChange={(e) => {
                    console.log("Bed number changed:", e.target.value);
                    setFormData({
                      ...formData,
                      bedNumber: e.target.value.toUpperCase(),
                    });
                  }}
                  placeholder="Enter bed number"
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

          <h4
            style={{
              marginTop: "20px",
              marginBottom: "10px",
              color: "#3b82f6",
            }}
          >
            <i className="pi pi-money-bill mr-2"></i>Pricing Details
          </h4>

          {/* Pricing */}
          <div className="grid">
            <div className="col-6">
              <div className="p-field mb-3">
                <label htmlFor="perBedDailyRate">Per Bed Daily Rate</label>
                <InputNumber
                  id="perBedDailyRate"
                  value={formData.pricing.perBedDailyRate}
                  onValueChange={(e) =>
                    setFormData({
                      ...formData,
                      pricing: {
                        ...formData.pricing,
                        perBedDailyRate: e.value || 0,
                      },
                    })
                  }
                  mode="currency"
                  currency="INR"
                  locale="en-IN"
                />
              </div>
            </div>
            <div className="col-6">
              <div className="p-field mb-3">
                <label htmlFor="nursingCharges">Nursing Charges</label>
                <InputNumber
                  id="nursingCharges"
                  value={formData.pricing.nursingCharges}
                  onValueChange={(e) =>
                    setFormData({
                      ...formData,
                      pricing: {
                        ...formData.pricing,
                        nursingCharges: e.value || 0,
                      },
                    })
                  }
                  mode="currency"
                  currency="INR"
                  locale="en-IN"
                />
              </div>
            </div>
          </div>

          <div className="grid">
            <div className="col-6">
              <div className="p-field mb-3">
                <label htmlFor="equipmentCharges">Equipment Charges</label>
                <InputNumber
                  id="equipmentCharges"
                  value={formData.pricing.equipmentCharges}
                  onValueChange={(e) =>
                    setFormData({
                      ...formData,
                      pricing: {
                        ...formData.pricing,
                        equipmentCharges: e.value || 0,
                      },
                    })
                  }
                  mode="currency"
                  currency="INR"
                  locale="en-IN"
                />
              </div>
            </div>
            <div className="col-6">
              <div className="p-field mb-3">
                <label htmlFor="securityDeposit">Security Deposit</label>
                <InputNumber
                  id="securityDeposit"
                  value={formData.pricing.securityDeposit}
                  onValueChange={(e) =>
                    setFormData({
                      ...formData,
                      pricing: {
                        ...formData.pricing,
                        securityDeposit: e.value || 0,
                      },
                    })
                  }
                  mode="currency"
                  currency="INR"
                  locale="en-IN"
                />
              </div>
            </div>
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

          {/* Active Checkbox */}
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
        </div>
      </Dialog>
    </>
  );
};

export default BedForm;
