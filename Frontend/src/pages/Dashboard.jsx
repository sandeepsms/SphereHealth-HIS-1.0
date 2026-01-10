import React from "react";
import { Card } from "primereact/card";
import { Chart } from "primereact/chart";

const Dashboard = () => {
  const chartData = {
    labels: ["Buildings", "Floors", "Wards", "Rooms", "Beds"],
    datasets: [
      {
        label: "Total Count",
        data: [5, 25, 40, 150, 500],
        backgroundColor: [
          "#3b82f6",
          "#10b981",
          "#f59e0b",
          "#ef4444",
          "#8b5cf6",
        ],
      },
    ],
  };

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: "20px",
          marginBottom: "20px",
        }}
      >
        <Card
          style={{
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <i
              className="pi pi-building"
              style={{ fontSize: "3rem", marginBottom: "10px" }}
            ></i>
            <h2 style={{ margin: "10px 0", fontSize: "2.5rem" }}>5</h2>
            <p style={{ margin: 0, fontSize: "1.2rem" }}>Buildings</p>
          </div>
        </Card>

        <Card
          style={{
            background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            color: "white",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <i
              className="pi pi-arrows-v"
              style={{ fontSize: "3rem", marginBottom: "10px" }}
            ></i>
            <h2 style={{ margin: "10px 0", fontSize: "2.5rem" }}>25</h2>
            <p style={{ margin: 0, fontSize: "1.2rem" }}>Floors</p>
          </div>
        </Card>

        <Card
          style={{
            background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
            color: "white",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <i
              className="pi pi-home"
              style={{ fontSize: "3rem", marginBottom: "10px" }}
            ></i>
            <h2 style={{ margin: "10px 0", fontSize: "2.5rem" }}>40</h2>
            <p style={{ margin: 0, fontSize: "1.2rem" }}>Wards</p>
          </div>
        </Card>

        <Card
          style={{
            background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
            color: "white",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <i
              className="pi pi-box"
              style={{ fontSize: "3rem", marginBottom: "10px" }}
            ></i>
            <h2 style={{ margin: "10px 0", fontSize: "2.5rem" }}>150</h2>
            <p style={{ margin: 0, fontSize: "1.2rem" }}>Rooms</p>
          </div>
        </Card>

        <Card
          style={{
            background: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
            color: "white",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <i
              className="pi pi-th-large"
              style={{ fontSize: "3rem", marginBottom: "10px" }}
            ></i>
            <h2 style={{ margin: "10px 0", fontSize: "2.5rem" }}>500</h2>
            <p style={{ margin: 0, fontSize: "1.2rem" }}>Total Beds</p>
          </div>
        </Card>
      </div>

      <Card title="Overview Statistics">
        <Chart type="bar" data={chartData} />
      </Card>
    </div>
  );
};

export default Dashboard;
