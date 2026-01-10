import React, { useState, useEffect } from "react";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { floorService } from "../../services/floorService";
import { buildingService } from "../../services/buildingService";

const FloorForm = ({ visible, onHide, floor, onSave }) => {
  const [formData, setFormData] = useState({
    building: "",
    floorNumber: "",
    floorName: "",
    totalWards: 0,
    isActive: true,
    notes: "",
  });
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBuildings();
  }, []);

  useEffect(() => {
    if (floor) {
      setFormData(floor);
    } else {
      resetForm();
    }
  }, [floor]);

  const loadBuildings = async () => {
    try {
      const data = await buildingService.getAllBuildings();
      setBuildings(data);
    } catch (error) {
      console.error("Error loading buildings:", error);
    }
  };

  const resetForm = () => {
    setFormData({
      building: "",
      floorNumber: "",
      floorName: "",
      totalWards: 0,
      isActive: true,
      notes: "",
    });
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      if (floor?._id) {
        await floorService.updateFloor(floor._id, formData);
      } else {
        await floorService.createFloor(formData);
      }
      onSave();
      onHide();
      resetForm();
    } catch (error) {
      console.error("Error saving floor:", error);
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
          !formData.floorNumber || !formData.floorName || !formData.building
        }
      />
    </div>
  );

  return (
    <Dialog
      visible={visible}
      style={{ width: "500px" }}
      header={floor ? "Edit Floor" : "Add New Floor"}
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
            onChange={(e) => setFormData({ ...formData, building: e.value })}
            placeholder="Select Building"
          />
        </div>

        <div className="p-field mb-3">
          <label htmlFor="floorNumber">Floor Number *</label>
          <InputText
            id="floorNumber"
            value={formData.floorNumber}
            onChange={(e) =>
              setFormData({ ...formData, floorNumber: e.target.value })
            }
            placeholder="e.g., 1, 2, G, B1"
          />
        </div>

        <div className="p-field mb-3">
          <label htmlFor="floorName">Floor Name *</label>
          <InputText
            id="floorName"
            value={formData.floorName}
            onChange={(e) =>
              setFormData({ ...formData, floorName: e.target.value })
            }
            placeholder="e.g., First Floor, Ground Floor"
          />
        </div>

        <div className="p-field mb-3">
          <label htmlFor="totalWards">Total Wards</label>
          <InputNumber
            id="totalWards"
            value={formData.totalWards}
            onValueChange={(e) =>
              setFormData({ ...formData, totalWards: e.value })
            }
            min={0}
            showButtons
          />
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

export default FloorForm;
