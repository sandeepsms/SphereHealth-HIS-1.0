import React from "react";
import { Card } from "primereact/card";
import { Tag } from "primereact/tag";
import { ProgressBar } from "primereact/progressbar";
import { Button } from "primereact/button";

const RoomCard = ({ room, onEdit, onViewBeds }) => {
  const occupancyRate = parseFloat(room.occupancyRate || 0);

  const getOccupancyColor = () => {
    if (occupancyRate > 80) return "danger";
    if (occupancyRate > 50) return "warning";
    return "success";
  };

  const getStatusSeverity = () => {
    const statusMap = {
      Active: "success",
      Inactive: "danger",
      "Under Maintenance": "warning",
      Blocked: "secondary",
    };
    return statusMap[room.status] || "info";
  };

  const header = (
    <div
      style={{
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        padding: "20px",
        color: "white",
        borderRadius: "8px 8px 0 0",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "24px" }}>{room.roomNumber}</h3>
          <p style={{ margin: "5px 0 0 0", opacity: 0.9 }}>
            {room.roomName || "No Name"}
          </p>
        </div>
        <Tag
          value={room.status}
          severity={getStatusSeverity()}
          style={{ fontSize: "14px" }}
        />
      </div>
    </div>
  );

  const footer = (
    <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
      <Button
        label="View Beds"
        icon="pi pi-eye"
        className="p-button-outlined"
        onClick={() => onViewBeds(room)}
      />
      <Button label="Edit" icon="pi pi-pencil" onClick={() => onEdit(room)} />
    </div>
  );

  return (
    <Card header={header} footer={footer} style={{ marginBottom: "20px" }}>
      <div style={{ padding: "10px 0" }}>
        <div style={{ marginBottom: "15px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "5px",
            }}
          >
            <span style={{ fontWeight: "bold", color: "#666" }}>Occupancy</span>
            <span style={{ fontWeight: "bold" }}>
              {room.occupiedBeds}/{room.totalBeds} Beds
            </span>
          </div>
          <ProgressBar
            value={occupancyRate}
            showValue={false}
            style={{ height: "12px" }}
            color={getOccupancyColor()}
          />
          <small style={{ color: "#888" }}>{occupancyRate}% Occupied</small>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px",
            marginTop: "15px",
          }}
        >
          <div
            style={{
              padding: "10px",
              backgroundColor: "#f0f9ff",
              borderRadius: "6px",
              borderLeft: "4px solid #3b82f6",
            }}
          >
            <i
              className="pi pi-building"
              style={{ color: "#3b82f6", marginRight: "8px" }}
            ></i>
            <strong>Building:</strong>
            <div style={{ marginTop: "5px", color: "#666" }}>
              {room.buildingName || "N/A"}
            </div>
          </div>

          <div
            style={{
              padding: "10px",
              backgroundColor: "#f0fdf4",
              borderRadius: "6px",
              borderLeft: "4px solid #10b981",
            }}
          >
            <i
              className="pi pi-arrows-v"
              style={{ color: "#10b981", marginRight: "8px" }}
            ></i>
            <strong>Floor:</strong>
            <div style={{ marginTop: "5px", color: "#666" }}>
              {room.floorNumber || "N/A"}
            </div>
          </div>

          <div
            style={{
              padding: "10px",
              backgroundColor: "#fef3c7",
              borderRadius: "6px",
              borderLeft: "4px solid #f59e0b",
            }}
          >
            <i
              className="pi pi-home"
              style={{ color: "#f59e0b", marginRight: "8px" }}
            ></i>
            <strong>Ward:</strong>
            <div style={{ marginTop: "5px", color: "#666" }}>
              {room.wardName || "N/A"}
            </div>
          </div>

          <div
            style={{
              padding: "10px",
              backgroundColor: "#fce7f3",
              borderRadius: "6px",
              borderLeft: "4px solid #ec4899",
            }}
          >
            <i
              className="pi pi-tag"
              style={{ color: "#ec4899", marginRight: "8px" }}
            ></i>
            <strong>Code:</strong>
            <div style={{ marginTop: "5px", color: "#666" }}>
              {room.roomCode || "N/A"}
            </div>
          </div>
        </div>

        {room.notes && (
          <div
            style={{
              marginTop: "15px",
              padding: "10px",
              backgroundColor: "#f9fafb",
              borderRadius: "6px",
              borderLeft: "4px solid #6b7280",
            }}
          >
            <i
              className="pi pi-info-circle"
              style={{ color: "#6b7280", marginRight: "8px" }}
            ></i>
            <strong>Notes:</strong>
            <div style={{ marginTop: "5px", color: "#666" }}>{room.notes}</div>
          </div>
        )}
      </div>
    </Card>
  );
};

export default RoomCard;
