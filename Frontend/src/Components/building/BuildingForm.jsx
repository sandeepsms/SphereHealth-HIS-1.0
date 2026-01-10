import React, { useState, useEffect } from "react";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { InputTextarea } from "primereact/inputtextarea";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { buildingService } from "../../services/buildingService";

const BuildingForm = ({ visible, onHide, building, onSave }) => {
  const [formData, setFormData] = useState({
    buildingName: "",
    buildingCode: "",
    totalFloors: 1,
    address: "",
    isActive: true,
    notes: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (building) {
      setFormData(building);
    } else {
      resetForm();
    }
  }, [building]);

  const resetForm = () => {
    setFormData({
      buildingName: "",
      buildingCode: "",
      totalFloors: 1,
      address: "",
      isActive: true,
      notes: "",
    });
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      if (building?._id) {
        await buildingService.updateBuilding(building._id, formData);
      } else {
        await buildingService.createBuilding(formData);
      }
      onSave();
      onHide();
      resetForm();
    } catch (error) {
      console.error("Error saving building:", error);
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
        disabled={!formData.buildingName || !formData.buildingCode}
      />
    </div>
  );

  return (
    <Dialog
      visible={visible}
      style={{ width: "500px" }}
      header={building ? "Edit Building" : "Add New Building"}
      modal
      footer={footer}
      onHide={onHide}
    >
      <div className="p-fluid">
        <div className="p-field mb-3">
          <label htmlFor="buildingName">Building Name *</label>
          <InputText
            id="buildingName"
            value={formData.buildingName}
            onChange={(e) =>
              setFormData({ ...formData, buildingName: e.target.value })
            }
            placeholder="Enter building name"
          />
        </div>

        <div className="p-field mb-3">
          <label htmlFor="buildingCode">Building Code *</label>
          <InputText
            id="buildingCode"
            value={formData.buildingCode}
            onChange={(e) =>
              setFormData({
                ...formData,
                buildingCode: e.target.value.toUpperCase(),
              })
            }
            placeholder="Enter building code"
          />
        </div>

        <div className="p-field mb-3">
          <label htmlFor="totalFloors">Total Floors *</label>
          <InputNumber
            id="totalFloors"
            value={formData.totalFloors}
            onValueChange={(e) =>
              setFormData({ ...formData, totalFloors: e.value })
            }
            min={1}
            showButtons
          />
        </div>

        <div className="p-field mb-3">
          <label htmlFor="address">Address</label>
          <InputTextarea
            id="address"
            value={formData.address}
            onChange={(e) =>
              setFormData({ ...formData, address: e.target.value })
            }
            rows={3}
            placeholder="Enter address"
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
            rows={2}
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

export default BuildingForm;
