import React, { useState, useEffect } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { Card } from "primereact/card";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import WardForm from "../Components/ward/WardForm";
import { wardService } from "../Services/wardService";

const WardManagement = () => {
  const [wards, setWards] = useState([]);
  const [selectedWard, setSelectedWard] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [globalFilter, setGlobalFilter] = useState("");
  const toast = React.useRef(null);

  useEffect(() => {
    console.log("Component mounted, loading wards...");
    loadWards();
  }, []);

  const loadWards = async () => {
    setLoading(true);
    try {
      console.log("Fetching wards from API...");
      const data = await wardService.getAllWards();
      console.log("Raw API response:", data);

      let wardsArray = [];

      // Handle different response formats
      if (Array.isArray(data)) {
        wardsArray = data;
      } else if (data && Array.isArray(data.data)) {
        wardsArray = data.data;
      } else if (data && Array.isArray(data.wards)) {
        wardsArray = data.wards;
      } else {
        console.warn("Unexpected data format:", data);
      }

      console.log("Processed wards array:", wardsArray);
      console.log("Total wards found:", wardsArray.length);

      // Map the data to extract populated fields
      const mappedWards = wardsArray.map((ward) => {
        console.log("Processing ward:", ward);
        return {
          ...ward,
          buildingName:
            ward.building?.buildingName || ward.buildingName || "N/A",
          floorName: ward.floor?.floorName || ward.floorName || "N/A",
          floorNumber: ward.floor?.floorNumber || ward.floorNumber || "N/A",
        };
      });

      console.log("Mapped wards:", mappedWards);
      setWards(mappedWards);

      if (mappedWards.length > 0) {
        toast.current?.show({
          severity: "success",
          summary: "Success",
          detail: `Loaded ${mappedWards.length} ward(s)`,
          life: 2000,
        });
      }
    } catch (error) {
      console.error("Error loading wards:", error);
      console.error("Error details:", error.response?.data);
      setWards([]);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: error.response?.data?.message || "Failed to load wards",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (ward) => {
    console.log("Editing ward:", ward);
    setSelectedWard(ward);
    setShowForm(true);
  };

  const handleDelete = (ward) => {
    confirmDialog({
      message: `Are you sure you want to delete ward ${ward.wardName}?`,
      header: "Confirmation",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          console.log("Deleting ward:", ward._id);
          await wardService.deleteWard(ward._id);
          toast.current?.show({
            severity: "success",
            summary: "Success",
            detail: "Ward deleted successfully",
            life: 3000,
          });
          loadWards();
        } catch (error) {
          console.error("Error deleting ward:", error);
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: "Failed to delete ward",
            life: 3000,
          });
        }
      },
    });
  };

  const handleSave = () => {
    console.log("Ward saved, reloading wards...");
    setShowForm(false);
    setSelectedWard(null);
    loadWards(); // Reload wards
    toast.current?.show({
      severity: "success",
      summary: "Success",
      detail: "Ward saved successfully",
      life: 3000,
    });
  };

  const handleFormHide = () => {
    console.log("Form hidden");
    setShowForm(false);
    setSelectedWard(null);
  };

  const wardTypeBodyTemplate = (rowData) => {
     return <Tag value={rowData.wardType || "N/A"}   severity={rowData.wardType === "Emergency" ? "danger" : "info"}/>;
  
  };

  const statusBodyTemplate = (rowData) => {
    return (
      <Tag
        value={rowData.isActive ? "Active" : "Inactive"}
        severity={rowData.isActive ? "success" : "danger"}
        icon={rowData.isActive ? "pi pi-check" : "pi pi-times"}
      />
    );
  };

  const actionBodyTemplate = (rowData) => {
    return (
      <div className="flex gap-2">
        <Button
          icon="pi pi-pencil"
          className="p-button-rounded p-button-success p-button-sm"
          onClick={() => handleEdit(rowData)}
          tooltip="Edit"
          tooltipOptions={{ position: "top" }}
        />
        <Button
          icon="pi pi-trash"
          className="p-button-rounded p-button-danger p-button-sm"
          onClick={() => handleDelete(rowData)}
          tooltip="Delete"
          tooltipOptions={{ position: "top" }}
        />
      </div>
    );
  };

  const header = (
    <div className="flex flex-wrap gap-2 align-items-center justify-content-between">
      <div>
        <h4 className="m-0">Ward Management</h4>
        <p className="text-sm text-600 mt-1">Total Wards: {wards.length}</p>
      </div>
      <div className="flex gap-2 align-items-center">
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText
            type="search"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Search..."
          />
        </span>
        <Button
          icon="pi pi-refresh"
          className="p-button-outlined"
          onClick={loadWards}
          loading={loading}
          tooltip="Refresh"
          tooltipOptions={{ position: "top" }}
        />
        <Button
          label="Add Ward"
          icon="pi pi-plus"
          onClick={() => {
            setSelectedWard(null);
            setShowForm(true);
          }}
          className="p-button-success"
        />
      </div>
    </div>
  );

  return (
    <div className="p-4" style={{ marginTop: "80px" }}>
      <Toast ref={toast} />
      <ConfirmDialog />

      <Card className="shadow-1">
        <DataTable
          value={wards}
          paginator
          rows={10}
          rowsPerPageOptions={[5, 10, 25, 50]}
          loading={loading}
          globalFilter={globalFilter}
          header={header}
          emptyMessage="No wards found. Click 'Add Ward' to create one."
          responsiveLayout="scroll"
          stripedRows
          showGridlines
        >
          <Column
            field="wardName"
            header="Ward Name"
            sortable
            style={{ minWidth: "200px" }}
          />
          <Column
            field="wardCode"
            header="Ward Code"
            sortable
            style={{ width: "120px", fontWeight: "bold" }}
          />
          <Column
            field="wardType"
            header="Ward Type"
            body={wardTypeBodyTemplate}
            sortable
            style={{ width: "150px" }}
          />
          <Column
            field="floorNumber"
            header="Floor"
            sortable
            style={{ width: "100px" }}
          />
          <Column
            field="buildingName"
            header="Building"
            sortable
            style={{ width: "150px" }}
          />
          <Column
            field="totalRooms"
            header="Total Rooms"
            sortable
            style={{ width: "120px", textAlign: "center" }}
          />
          <Column
            field="totalBeds"
            header="Total Beds"
            sortable
            style={{ width: "120px", textAlign: "center" }}
          />
          <Column
            field="isActive"
            header="Status"
            body={statusBodyTemplate}
            sortable
            style={{ width: "120px", textAlign: "center" }}
          />
          <Column
            header="Actions"
            body={actionBodyTemplate}
            style={{ width: "120px", textAlign: "center" }}
          />
        </DataTable>
      </Card>

      <WardForm
        visible={showForm}
        onHide={handleFormHide}
        ward={selectedWard}
        onSave={handleSave}
      />
    </div>
  );
};

export default WardManagement;
