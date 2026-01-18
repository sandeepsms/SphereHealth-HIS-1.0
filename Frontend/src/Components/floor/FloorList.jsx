import React, { useState, useEffect, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { floorService } from "../../Services/floorService";
import { formatDateTime } from "../../utils/helpers";

const FloorList = ({ onEdit, onRefresh }) => {
  const [floors, setFloors] = useState([]);
  const [loading, setLoading] = useState(false);
  const toast = useRef(null);

  useEffect(() => {
    fetchFloors();
  }, [onRefresh]);

  const fetchFloors = async () => {
    setLoading(true);
    try {
      const data = await floorService.getAllFloors();
      setFloors(data);
    } catch (error) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load floors",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (floor) => {
    confirmDialog({
      message: `Are you sure you want to delete ${floor.floorName}?`,
      header: "Confirm Delete",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await floorService.deleteFloor(floor._id);
          toast.current?.show({
            severity: "success",
            summary: "Success",
            detail: "Floor deleted successfully",
            life: 3000,
          });
          fetchFloors();
        } catch (error) {
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: "Failed to delete floor",
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
        value={floors}
        loading={loading}
        paginator
        rows={10}
        rowsPerPageOptions={[5, 10, 25, 50]}
        tableStyle={{ minWidth: "50rem" }}
        emptyMessage="No floors found"
        stripedRows
      >
        <Column field="floorNumber" header="Floor Number" sortable />
        <Column field="floorName" header="Floor Name" sortable />
        <Column field="buildingName" header="Building" sortable />
        <Column field="totalWards" header="Total Wards" sortable />
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

export default FloorList;
