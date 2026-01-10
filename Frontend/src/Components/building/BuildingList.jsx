import React, { useState, useEffect, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { buildingService } from "../../services/buildingService";
import { formatDateTime } from "../../utils/helpers";

const BuildingList = ({ onEdit, onRefresh }) => {
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(false);
  const toast = useRef(null);

  useEffect(() => {
    fetchBuildings();
  }, [onRefresh]);

  const fetchBuildings = async () => {
    setLoading(true);
    try {
      const data = await buildingService.getAllBuildings();
      setBuildings(data);
    } catch (error) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load buildings",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (building) => {
    confirmDialog({
      message: `Are you sure you want to delete ${building.buildingName}?`,
      header: "Confirm Delete",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await buildingService.deleteBuilding(building._id);
          toast.current?.show({
            severity: "success",
            summary: "Success",
            detail: "Building deleted successfully",
            life: 3000,
          });
          fetchBuildings();
        } catch (error) {
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: "Failed to delete building",
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
        />
        <Button
          icon="pi pi-trash"
          className="p-button-rounded p-button-text p-button-danger"
          onClick={() => handleDelete(rowData)}
          tooltip="Delete"
        />
      </div>
    );
  };

  const statusBodyTemplate = (rowData) => {
    return (
      <Tag
        value={rowData.isActive ? "Active" : "Inactive"}
        severity={rowData.isActive ? "success" : "danger"}
      />
    );
  };

  const dateBodyTemplate = (rowData) => {
    return formatDateTime(rowData.createdAt);
  };

  return (
    <>
      <Toast ref={toast} />
      <ConfirmDialog />
      <DataTable
        value={buildings}
        loading={loading}
        paginator
        rows={10}
        rowsPerPageOptions={[5, 10, 25, 50]}
        tableStyle={{ minWidth: "50rem" }}
        emptyMessage="No buildings found"
        stripedRows
      >
        <Column field="buildingCode" header="Building Code" sortable />
        <Column field="buildingName" header="Building Name" sortable />
        <Column field="totalFloors" header="Total Floors" sortable />
        <Column field="address" header="Address" />
        <Column
          field="isActive"
          header="Status"
          body={statusBodyTemplate}
          sortable
        />
        <Column
          field="createdAt"
          header="Created At"
          body={dateBodyTemplate}
          sortable
        />
        <Column
          header="Actions"
          body={actionBodyTemplate}
          style={{ width: "120px" }}
        />
      </DataTable>
    </>
  );
};

export default BuildingList;
