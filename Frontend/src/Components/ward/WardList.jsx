import React, { useState, useEffect, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { wardService } from "../../services/wardService";
import { formatDateTime } from "../../utils/helpers";

const WardList = ({ onEdit, onRefresh }) => {
  const [wards, setWards] = useState([]);
  const [loading, setLoading] = useState(false);
  const toast = useRef(null);

  // Fetch wards on mount and when onRefresh changes
  useEffect(() => {
    console.log("Fetching wards, refresh key:", onRefresh);
    fetchWards();
  }, [onRefresh]);

  const fetchWards = async () => {
    setLoading(true);
    try {
      console.log("Calling ward service...");
      const data = await wardService.getAllWards();
      console.log("Wards fetched:", data);

      // Map the data to include building and floor names
      const mappedWards = data.map((ward) => ({
        ...ward,
        buildingName: ward.building?.buildingName || "N/A",
        floorName: ward.floor?.floorName || "N/A",
      }));

      setWards(mappedWards);

      toast.current?.show({
        severity: "success",
        summary: "Success",
        detail: `${data.length} wards loaded`,
        life: 2000,
      });
    } catch (error) {
      console.error("Error fetching wards:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load wards",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (ward) => {
    confirmDialog({
      message: `Are you sure you want to delete ${ward.wardName}?`,
      header: "Confirm Delete",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await wardService.deleteWard(ward._id);
          toast.current?.show({
            severity: "success",
            summary: "Success",
            detail: "Ward deleted successfully",
            life: 3000,
          });
          fetchWards(); // Refresh after delete
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

  const actionBodyTemplate = (rowData) => {
    return (
      <div style={{ display: "flex", gap: "5px" }}>
        <Button
          icon="pi pi-pencil"
          className="p-button-rounded p-button-text p-button-info"
          onClick={() => onEdit(rowData)}
          tooltip="Edit"
          tooltipOptions={{ position: "top" }}
        />
        <Button
          icon="pi pi-trash"
          className="p-button-rounded p-button-text p-button-danger"
          onClick={() => handleDelete(rowData)}
          tooltip="Delete"
          tooltipOptions={{ position: "top" }}
        />
      </div>
    );
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

  const dateBodyTemplate = (rowData) => {
    return formatDateTime(rowData.createdAt);
  };

  const bedsTemplate = (rowData) => {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
        <i className="pi pi-bed" style={{ color: "#3b82f6" }}></i>
        <span>{rowData.totalBeds || 0}</span>
      </div>
    );
  };

  const roomsTemplate = (rowData) => {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
        <i className="pi pi-home" style={{ color: "#10b981" }}></i>
        <span>{rowData.totalRooms || 0}</span>
      </div>
    );
  };

  return (
    <>
      <Toast ref={toast} />
      <ConfirmDialog />

      <div
        style={{
          marginBottom: "10px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <span style={{ fontSize: "14px", color: "#666" }}>
            Total Wards: <strong>{wards.length}</strong>
          </span>
        </div>
        <Button
          icon="pi pi-refresh"
          label="Refresh"
          className="p-button-outlined p-button-sm"
          onClick={fetchWards}
          loading={loading}
        />
      </div>

      <DataTable
        value={wards}
        loading={loading}
        paginator
        rows={10}
        rowsPerPageOptions={[5, 10, 25, 50]}
        tableStyle={{ minWidth: "50rem" }}
        emptyMessage="No wards found. Click 'Add Ward' to create one."
        stripedRows
        showGridlines
        responsiveLayout="scroll"
      >
        <Column
          field="wardCode"
          header="Ward Code"
          sortable
          style={{ width: "120px", fontWeight: "bold" }}
        />
        <Column
          field="wardName"
          header="Ward Name"
          sortable
          style={{ minWidth: "200px" }}
        />
        <Column
          field="wardType"
          header="Ward Type"
          sortable
          style={{ width: "150px" }}
        />
        <Column
          field="buildingName"
          header="Building"
          sortable
          style={{ width: "150px" }}
        />
        <Column
          field="floorName"
          header="Floor"
          sortable
          style={{ width: "120px" }}
        />
        <Column
          field="totalBeds"
          header="Total Beds"
          body={bedsTemplate}
          sortable
          style={{ width: "120px", textAlign: "center" }}
        />
        <Column
          field="totalRooms"
          header="Total Rooms"
          body={roomsTemplate}
          sortable
          style={{ width: "120px", textAlign: "center" }}
        />
        <Column
          field="isActive"
          header="Status"
          body={statusBodyTemplate}
          sortable
          style={{ width: "100px", textAlign: "center" }}
        />
        <Column
          field="createdAt"
          header="Created At"
          body={dateBodyTemplate}
          sortable
          style={{ width: "180px" }}
        />
        <Column
          header="Actions"
          body={actionBodyTemplate}
          style={{ width: "120px", textAlign: "center" }}
        />
      </DataTable>
    </>
  );
};

export default WardList;
