import React, { useState, useEffect, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { ProgressBar } from "primereact/progressbar";
import { roomService } from "../../Services/roomService";
import { formatDateTime } from "../../utils/helpers";

const RoomList = ({ onEdit, onRefresh }) => {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const toast = useRef(null);

  useEffect(() => {
    fetchRooms();
  }, [onRefresh]);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const data = await roomService.getAllRooms();
      setRooms(data);
    } catch (error) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load rooms",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (room) => {
    confirmDialog({
      message: `Are you sure you want to delete Room ${room.roomNumber}?`,
      header: "Confirm Delete",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await roomService.deleteRoom(room._id);
          toast.current?.show({
            severity: "success",
            summary: "Success",
            detail: "Room deleted successfully",
            life: 3000,
          });
          fetchRooms();
        } catch (error) {
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: "Failed to delete room",
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
    const statusMap = {
      Active: "success",
      Inactive: "danger",
      "Under Maintenance": "warning",
      Blocked: "secondary",
    };
    return <Tag value={rowData.status} severity={statusMap[rowData.status]} />;
  };

  const occupancyBodyTemplate = (rowData) => {
    const rate = parseFloat(rowData.occupancyRate || 0);
    let severity = "success";
    if (rate > 80) severity = "danger";
    else if (rate > 50) severity = "warning";

    return (
      <div>
        <ProgressBar
          value={rate}
          showValue={false}
          style={{ height: "8px" }}
          color={severity}
        />
        <small>
          {rate}% ({rowData.occupiedBeds}/{rowData.totalBeds})
        </small>
      </div>
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
        value={rooms}
        loading={loading}
        paginator
        rows={10}
        rowsPerPageOptions={[5, 10, 25, 50]}
        tableStyle={{ minWidth: "50rem" }}
        emptyMessage="No rooms found"
        stripedRows
      >
        <Column field="roomCode" header="Room Code" sortable />
        <Column field="roomNumber" header="Room Number" sortable />
        <Column field="roomName" header="Room Name" sortable />
        <Column field="buildingName" header="Building" sortable />
        <Column field="floorNumber" header="Floor" sortable />
        <Column field="wardName" header="Ward" sortable />
        <Column header="Occupancy" body={occupancyBodyTemplate} sortable />
        <Column
          field="status"
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

export default RoomList;
