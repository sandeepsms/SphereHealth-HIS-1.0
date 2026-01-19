import React, { useState, useEffect } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { Card } from "primereact/card";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import RoomForm from "../Components/room/RoomForm";
import { roomService } from "../Services/roomService";

const RoomManagement = () => {
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [globalFilter, setGlobalFilter] = useState("");
  const toast = React.useRef(null);

  useEffect(() => {
    loadRooms();
  }, []);

  const loadRooms = async () => {
    setLoading(true);
    try {
      const data = await roomService.getAllRooms();
      setRooms(data);
    } catch (error) {
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load rooms",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (room) => {
    setSelectedRoom(room);
    setShowForm(true);
  };

  const handleDelete = (room) => {
    confirmDialog({
      message: `Are you sure you want to delete room ${room.roomNumber}?`,
      header: "Confirmation",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await roomService.deleteRoom(room._id);
          toast.current.show({
            severity: "success",
            summary: "Success",
            detail: "Room deleted successfully",
          });
          loadRooms();
        } catch (error) {
          toast.current.show({
            severity: "error",
            summary: "Error",
            detail: "Failed to delete room",
          });
        }
      },
    });
  };

  const statusBodyTemplate = (rowData) => {
    const severity = {
      Active: "success",
      Inactive: "danger",
      "Under Maintenance": "warning",
      Blocked: "info",
    };
    return <Tag value={rowData.status} severity={severity[rowData.status]} />;
  };

  const occupancyBodyTemplate = (rowData) => {
    return `${rowData.occupiedBeds}/${rowData.totalBeds} (${rowData.occupancyRate}%)`;
  };

  const actionBodyTemplate = (rowData) => {
    return (
      <div className="flex gap-2">
        <Button
          icon="pi pi-pencil"
          className="p-button-rounded p-button-success"
          onClick={() => handleEdit(rowData)}
        />
        <Button
          icon="pi pi-trash"
          className="p-button-rounded p-button-danger"
          onClick={() => handleDelete(rowData)}
        />
      </div>
    );
  };

  const header = (
    <div className="flex flex-wrap gap-2 align-items-center justify-content-between">
      <h4 className="m-0">Room Management</h4>
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
        label="Add Room"
        icon="pi pi-plus"
        onClick={() => {
          setSelectedRoom(null);
          setShowForm(true);
        }}
      />
    </div>
  );

  return (
    <div className="p-4">
      <Toast ref={toast} />
      <ConfirmDialog />

      <Card>
        <DataTable
          value={rooms}
          paginator
          rows={10}
          loading={loading}
          globalFilter={globalFilter}
          header={header}
          emptyMessage="No rooms found"
          responsiveLayout="scroll"
        >
          <Column field="roomNumber" header="Room Number" sortable />
          <Column field="roomName" header="Room Name" sortable />
          <Column field="roomCode" header="Room Code" sortable />
          <Column field="wardName" header="Ward" sortable />
          <Column field="floorNumber" header="Floor" sortable />
          <Column field="buildingName" header="Building" sortable />
          <Column header="Occupancy" body={occupancyBodyTemplate} sortable />
          <Column
            field="status"
            header="Status"
            body={statusBodyTemplate}
            sortable
          />
          <Column header="Actions" body={actionBodyTemplate} />
        </DataTable>
      </Card>

      <RoomForm
        visible={showForm}
        onHide={() => setShowForm(false)}
        room={selectedRoom}
        onSave={() => {
          loadRooms();
          toast.current.show({
            severity: "success",
            summary: "Success",
            detail: "Room saved successfully",
          });
        }}
      />
    </div>
  );
};

export default RoomManagement;
