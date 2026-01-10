import React from "react";
import { Card } from "primereact/card";

const Hierarchy = ({ building, floor, ward, room }) => {
  return (
    <Card className="mb-3">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        {building && (
          <>
            <div
              style={{
                padding: "8px 16px",
                backgroundColor: "#3b82f6",
                color: "white",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: "bold",
              }}
            >
              <i className="pi pi-building mr-2"></i>
              {building}
            </div>
            <i className="pi pi-angle-right" style={{ color: "#6b7280" }}></i>
          </>
        )}

        {floor && (
          <>
            <div
              style={{
                padding: "8px 16px",
                backgroundColor: "#10b981",
                color: "white",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: "bold",
              }}
            >
              <i className="pi pi-arrows-v mr-2"></i>
              {floor}
            </div>
            <i className="pi pi-angle-right" style={{ color: "#6b7280" }}></i>
          </>
        )}

        {ward && (
          <>
            <div
              style={{
                padding: "8px 16px",
                backgroundColor: "#f59e0b",
                color: "white",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: "bold",
              }}
            >
              <i className="pi pi-home mr-2"></i>
              {ward}
            </div>
            <i className="pi pi-angle-right" style={{ color: "#6b7280" }}></i>
          </>
        )}

        {room && (
          <div
            style={{
              padding: "8px 16px",
              backgroundColor: "#ef4444",
              color: "white",
              borderRadius: "6px",
              fontSize: "14px",
              fontWeight: "bold",
            }}
          >
            <i className="pi pi-box mr-2"></i>
            {room}
          </div>
        )}
      </div>
    </Card>
  );
};

export default Hierarchy;
