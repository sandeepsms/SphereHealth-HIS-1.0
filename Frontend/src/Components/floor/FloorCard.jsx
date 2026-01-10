import React from "react";
import { Card } from "primereact/card";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";

const FloorCard = ({ floor, onEdit, onDelete }) => {
  const header = (
    <div
      style={{
        background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
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
          <h3 style={{ margin: 0, fontSize: "24px" }}>{floor.floorName}</h3>
          <p style={{ margin: "5px 0 0 0", opacity: 0.9 }}>
            Floor: {floor.floorNumber}
          </p>
        </div>
        <Tag
          value={floor.isActive ? "Active" : "Inactive"}
          severity={floor.isActive ? "success" : "danger"}
          style={{ fontSize: "14px" }}
        />
      </div>
    </div>
  );

  const footer = (
    <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
      <Button
        label="Edit"
        icon="pi pi-pencil"
        onClick={() => onEdit(floor)}
        className="p-button-outlined"
      />
      <Button
        label="Delete"
        icon="pi pi-trash"
        onClick={() => onDelete(floor)}
        className="p-button-outlined p-button-danger"
      />
    </div>
  );

  return (
    <Card header={header} footer={footer} style={{ marginBottom: "20px" }}>
      <div style={{ padding: "10px 0" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "15px",
          }}
        >
          <div
            style={{
              padding: "15px",
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
            <div style={{ marginTop: "5px", color: "#666", fontSize: "16px" }}>
              {floor.buildingName || "N/A"}
            </div>
          </div>

          <div
            style={{
              padding: "15px",
              backgroundColor: "#fef3c7",
              borderRadius: "6px",
              borderLeft: "4px solid #f59e0b",
            }}
          >
            <i
              className="pi pi-home"
              style={{ color: "#f59e0b", marginRight: "8px" }}
            ></i>
            <strong>Total Wards:</strong>
            <div style={{ marginTop: "5px", color: "#666", fontSize: "16px" }}>
              {floor.totalWards || 0}
            </div>
          </div>
        </div>

        {floor.notes && (
          <div
            style={{
              marginTop: "15px",
              padding: "15px",
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
            <div style={{ marginTop: "5px", color: "#666" }}>{floor.notes}</div>
          </div>
        )}
      </div>
    </Card>
  );
};

export default FloorCard;
