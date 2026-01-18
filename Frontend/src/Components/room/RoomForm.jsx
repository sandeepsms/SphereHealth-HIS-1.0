import React, { useState, useEffect } from "react";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { InputTextarea } from "primereact/inputtextarea";
import { roomService } from "../../Services/roomService";
import { buildingService } from "../../Services/buildingService";
import { floorService } from "../../Services/floorService";
import { wardService } from "../../Services/wardService";
import { roomCategoryService } from "../../Services/roomCategoryService";

const RoomForm = ({ visible, onHide, room, onSave }) => {
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
  const [floors, setFloors] = useState([]);
  const [wards, setWards] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);

  const statusOptions = [
    { label: "Active", value: "Active" },
    { label: "Inactive", value: "Inactive" },
    { label: "Under Maintenance", value: "Under Maintenance" },
    { label: "Blocked", value: "Blocked" },
  ];

  useEffect(() => {
    loadBuildings();
    loadCategories();
  }, []);

  useEffect(() => {
    if (formData.building) {
      loadFloors();
    }
  }, [formData.building]);

  useEffect(() => {
    if (formData.floor) {
      loadWards();
    }
  }, [formData.floor]);

  useEffect(() => {
    if (room) {
      setFormData(room);
    } else {
      resetForm();
    }
  }, [room]);

  const loadBuildings = async () => {
    try {
      const data = await buildingService.getAllBuildings();
      setBuildings(data);
    } catch (error) {
      console.error("Error loading buildings:", error);
    }
  };

  const loadFloors = async () => {
    try {
      const data = await floorService.getAllFloors();
      const filtered = data.filter((f) => f.building === formData.building);
      setFloors(filtered);
    } catch (error) {
      console.error("Error loading floors:", error);
    }
  };

  const loadWards = async () => {
    try {
      const data = await wardService.getAllWards();
      const filtered = data.filter((w) => w.floor === formData.floor);
      setWards(filtered);
    } catch (error) {
      console.error("Error loading wards:", error);
    }
  };

  const loadCategories = async () => {
    try {
      const data = await roomCategoryService.getAllCategories();
      setCategories(data);
    } catch (error) {
      console.error("Error loading categories:", error);
    }
  };

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
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      if (room?._id) {
        await roomService.updateRoom(room._id, formData);
      } else {
        await roomService.createRoom(formData);
      }
      onSave();
      onHide();
      resetForm();
    } catch (error) {
      console.error("Error saving room:", error);
    } finally {
      setLoading(false);
    }
  };

  const footer = (
    <div>
      <Button
        label="Cancel"
        icon="pi pi-times"
        onClick={() => {
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
        disabled={
          !formData.roomNumber ||
          !formData.building ||
          !formData.floor ||
          !formData.roomCategory
        }
      />
    </div>
  );

  return (
    <Dialog
      visible={visible}
      style={{ width: "600px" }}
      header={room ? "Edit Room" : "Add New Room"}
      modal
      footer={footer}
      onHide={onHide}
    >
      <div className="p-fluid">
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
              })
            }
            placeholder="Select Building"
          />
        </div>

        <div className="p-field mb-3">
          <label htmlFor="floor">Floor *</label>
          <Dropdown
            id="floor"
            value={formData.floor}
            options={floors.map((f) => ({ label: f.floorName, value: f._id }))}
            onChange={(e) =>
              setFormData({ ...formData, floor: e.value, ward: null })
            }
            placeholder="Select Floor"
            disabled={!formData.building}
          />
        </div>

        <div className="p-field mb-3">
          <label htmlFor="ward">Ward (Optional)</label>
          <Dropdown
            id="ward"
            value={formData.ward}
            options={wards.map((w) => ({ label: w.wardName, value: w._id }))}
            onChange={(e) => setFormData({ ...formData, ward: e.value })}
            placeholder="Select Ward"
            disabled={!formData.floor}
            showClear
          />
        </div>

        <div className="grid">
          <div className="col-6">
            <div className="p-field mb-3">
              <label htmlFor="roomNumber">Room Number *</label>
              <InputText
                id="roomNumber"
                value={formData.roomNumber}
                onChange={(e) =>
                  setFormData({ ...formData, roomNumber: e.target.value })
                }
                placeholder="Enter room number"
              />
            </div>
          </div>
          <div className="col-6">
            <div className="p-field mb-3">
              <label htmlFor="roomName">Room Name</label>
              <InputText
                id="roomName"
                value={formData.roomName}
                onChange={(e) =>
                  setFormData({ ...formData, roomName: e.target.value })
                }
                placeholder="Enter room name"
              />
            </div>
          </div>
        </div>

        <div className="p-field mb-3">
          <label htmlFor="roomCategory">Room Category *</label>
          <Dropdown
            id="roomCategory"
            value={formData.roomCategory}
            options={categories.map((c) => ({
              label: c.categoryName,
              value: c._id,
            }))}
            onChange={(e) =>
              setFormData({ ...formData, roomCategory: e.value })
            }
            placeholder="Select Category"
          />
        </div>

        <div className="grid">
          <div className="col-6">
            <div className="p-field mb-3">
              <label htmlFor="totalBeds">Total Beds *</label>
              <InputNumber
                id="totalBeds"
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
              <label htmlFor="status">Status</label>
              <Dropdown
                id="status"
                value={formData.status}
                options={statusOptions}
                onChange={(e) => setFormData({ ...formData, status: e.value })}
                placeholder="Select Status"
              />
            </div>
          </div>
        </div>

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

        <div className="p-field-checkbox mb-3">
          <Checkbox
            inputId="isActive"
            checked={formData.isActive}
            onChange={(e) => setFormData({ ...formData, isActive: e.checked })}
          />
          <label htmlFor="isActive" className="ml-2">
            Active
          </label>
        </div>
      </div>
    </Dialog>
  );
};

export default RoomForm;
