import React, { useState, useEffect, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { roomService } from "../../Services/roomService";

const RoomList = ({ onEdit, onRefresh, globalFilter }) => {
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
    } catch {
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
      message: `Delete Room ${room.roomNumber}?`,
      header: "Confirm Delete",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await roomService.deleteRoom(room._id);
          toast.current?.show({
            severity: "success",
            summary: "Deleted",
            detail: "Room deleted",
            life: 3000,
          });
          fetchRooms();
        } catch {
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: "Delete failed",
            life: 3000,
          });
        }
      },
    });
  };

  const statusTpl = (r) => {
    const map = {
      Active: "success",
      Inactive: "danger",
      "Under Maintenance": "warning",
      Blocked: "secondary",
    };
    return <Tag value={r.status} severity={map[r.status]} />;
  };

  const actionTpl = (r) => (
    <div style={{ display: "flex", gap: 4 }}>
      <Button
        icon="pi pi-pencil"
        className="p-button-rounded p-button-text p-button-info"
        onClick={() => onEdit(r)}
        tooltip="Edit"
        tooltipOptions={{ position: "top" }}
      />
      <Button
        icon="pi pi-trash"
        className="p-button-rounded p-button-text p-button-danger"
        onClick={() => handleDelete(r)}
        tooltip="Delete"
        tooltipOptions={{ position: "top" }}
      />
    </div>
  );

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
        globalFilter={globalFilter}
        emptyMessage="No rooms found"
        tableStyle={{ minWidth: "50rem" }}
      >
        <Column
          field="roomNumber"
          header="Room No."
          sortable
          style={{ fontWeight: 600 }}
        />
        <Column field="roomName" header="Room Name" sortable />
        <Column field="buildingName" header="Building" sortable />
        <Column field="floorNumber" header="Floor" sortable />
        <Column field="wardName" header="Ward" sortable />
        <Column field="roomCode" header="Code" sortable />
        <Column field="status" header="Status" body={statusTpl} sortable />
        <Column header="Actions" body={actionTpl} style={{ width: 90 }} />
      </DataTable>
    </>
  );
};

export default RoomList;
