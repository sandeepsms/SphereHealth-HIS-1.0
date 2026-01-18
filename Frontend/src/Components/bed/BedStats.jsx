import React, { useState, useEffect } from "react";
import { Card } from "primereact/card";
import { Chart } from "primereact/chart";
import { ProgressBar } from "primereact/progressbar";
import { bedService } from "../../Services/bedService";
import { BED_STATUS_COLORS } from "../../utils/constants";

const BedStats = () => {
  const [beds, setBeds] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    available: 0,
    occupied: 0,
    maintenance: 0,
    blocked: 0,
    reserved: 0,
    occupancyRate: 0,
  });

  useEffect(() => {
    loadBeds();
  }, []);

  const loadBeds = async () => {
    try {
      const data = await bedService.getAllBeds();
      setBeds(data);
      calculateStats(data);
    } catch (error) {
      console.error("Error loading beds:", error);
    }
  };

  const calculateStats = (bedsData) => {
    const available = bedsData.filter((b) => b.status === "Available").length;
    const occupied = bedsData.filter((b) => b.status === "Occupied").length;
    const maintenance = bedsData.filter(
      (b) => b.status === "Maintenance"
    ).length;
    const blocked = bedsData.filter((b) => b.status === "Blocked").length;
    const reserved = bedsData.filter((b) => b.status === "Reserved").length;
    const total = bedsData.length;
    const occupancyRate = total > 0 ? ((occupied / total) * 100).toFixed(2) : 0;

    setStats({
      total,
      available,
      occupied,
      maintenance,
      blocked,
      reserved,
      occupancyRate,
    });
  };

  const chartData = {
    labels: ["Available", "Occupied", "Maintenance", "Blocked", "Reserved"],
    datasets: [
      {
        data: [
          stats.available,
          stats.occupied,
          stats.maintenance,
          stats.blocked,
          stats.reserved,
        ],
        backgroundColor: [
          BED_STATUS_COLORS.Available,
          BED_STATUS_COLORS.Occupied,
          BED_STATUS_COLORS.Maintenance,
          BED_STATUS_COLORS.Blocked,
          BED_STATUS_COLORS.Reserved,
        ],
      },
    ],
  };

  const chartOptions = {
    plugins: {
      legend: {
        position: "bottom",
      },
    },
    maintainAspectRatio: false,
  };

  return (
    <div>
      {/* Stats Cards Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "20px",
          marginBottom: "30px",
        }}
      >
        {/* Total Beds Card */}
        <Card
          style={{
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <i
              className="pi pi-th-large"
              style={{ fontSize: "3rem", marginBottom: "10px" }}
            ></i>
            <h2 style={{ margin: "10px 0", fontSize: "2.5rem" }}>
              {stats.total}
            </h2>
            <p style={{ margin: 0, fontSize: "1.2rem", opacity: 0.9 }}>
              Total Beds
            </p>
          </div>
        </Card>

        {/* Available Beds Card */}
        <Card
          style={{
            background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            color: "white",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <i
              className="pi pi-check-circle"
              style={{ fontSize: "3rem", marginBottom: "10px" }}
            ></i>
            <h2 style={{ margin: "10px 0", fontSize: "2.5rem" }}>
              {stats.available}
            </h2>
            <p style={{ margin: 0, fontSize: "1.2rem", opacity: 0.9 }}>
              Available Beds
            </p>
          </div>
        </Card>

        {/* Occupied Beds Card */}
        <Card
          style={{
            background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
            color: "white",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <i
              className="pi pi-times-circle"
              style={{ fontSize: "3rem", marginBottom: "10px" }}
            ></i>
            <h2 style={{ margin: "10px 0", fontSize: "2.5rem" }}>
              {stats.occupied}
            </h2>
            <p style={{ margin: 0, fontSize: "1.2rem", opacity: 0.9 }}>
              Occupied Beds
            </p>
          </div>
        </Card>

        {/* Maintenance Beds Card */}
        <Card
          style={{
            background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
            color: "white",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <i
              className="pi pi-wrench"
              style={{ fontSize: "3rem", marginBottom: "10px" }}
            ></i>
            <h2 style={{ margin: "10px 0", fontSize: "2.5rem" }}>
              {stats.maintenance}
            </h2>
            <p style={{ margin: 0, fontSize: "1.2rem", opacity: 0.9 }}>
              Under Maintenance
            </p>
          </div>
        </Card>

        {/* Blocked Beds Card */}
        <Card
          style={{
            background: "linear-gradient(135deg, #6b7280 0%, #4b5563 100%)",
            color: "white",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <i
              className="pi pi-ban"
              style={{ fontSize: "3rem", marginBottom: "10px" }}
            ></i>
            <h2 style={{ margin: "10px 0", fontSize: "2.5rem" }}>
              {stats.blocked}
            </h2>
            <p style={{ margin: 0, fontSize: "1.2rem", opacity: 0.9 }}>
              Blocked Beds
            </p>
          </div>
        </Card>

        {/* Reserved Beds Card */}
        <Card
          style={{
            background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
            color: "white",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <i
              className="pi pi-lock"
              style={{ fontSize: "3rem", marginBottom: "10px" }}
            ></i>
            <h2 style={{ margin: "10px 0", fontSize: "2.5rem" }}>
              {stats.reserved}
            </h2>
            <p style={{ margin: 0, fontSize: "1.2rem", opacity: 0.9 }}>
              Reserved Beds
            </p>
          </div>
        </Card>
      </div>

      {/* Occupancy Rate Card */}
      <Card style={{ marginBottom: "30px" }}>
        <h3 style={{ marginTop: 0, marginBottom: "15px", color: "#374151" }}>
          <i className="pi pi-chart-line" style={{ marginRight: "10px" }}></i>
          Overall Occupancy Rate
        </h3>
        <div
          style={{
            marginBottom: "10px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: "1.5rem",
              fontWeight: "bold",
              color:
                stats.occupancyRate > 80
                  ? "#ef4444"
                  : stats.occupancyRate > 50
                  ? "#f59e0b"
                  : "#10b981",
            }}
          >
            {stats.occupancyRate}%
          </span>
          <span style={{ color: "#6b7280" }}>
            {stats.occupied} / {stats.total} beds occupied
          </span>
        </div>
        <ProgressBar
          value={parseFloat(stats.occupancyRate)}
          showValue={false}
          color={
            stats.occupancyRate > 80
              ? "#ef4444"
              : stats.occupancyRate > 50
              ? "#f59e0b"
              : "#10b981"
          }
        />
      </Card>

      {/* Charts Section */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          gap: "20px",
        }}
      >
        {/* Pie Chart */}
        <Card>
          <h3 style={{ marginTop: 0, marginBottom: "20px", color: "#374151" }}>
            <i className="pi pi-chart-pie" style={{ marginRight: "10px" }}></i>
            Bed Distribution
          </h3>
          <div style={{ height: "300px" }}>
            <Chart type="pie" data={chartData} options={chartOptions} />
          </div>
        </Card>

        {/* Doughnut Chart */}
        <Card>
          <h3 style={{ marginTop: 0, marginBottom: "20px", color: "#374151" }}>
            <i className="pi pi-chart-bar" style={{ marginRight: "10px" }}></i>
            Bed Status Overview
          </h3>
          <div style={{ height: "300px" }}>
            <Chart type="doughnut" data={chartData} options={chartOptions} />
          </div>
        </Card>
      </div>

      {/* Status Breakdown Table */}
      <Card style={{ marginTop: "30px" }}>
        <h3 style={{ marginTop: 0, marginBottom: "20px", color: "#374151" }}>
          <i className="pi pi-list" style={{ marginRight: "10px" }}></i>
          Detailed Status Breakdown
        </h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  backgroundColor: "#f3f4f6",
                  borderBottom: "2px solid #e5e7eb",
                }}
              >
                <th
                  style={{
                    padding: "12px",
                    textAlign: "left",
                    fontWeight: "600",
                    color: "#374151",
                  }}
                >
                  Status
                </th>
                <th
                  style={{
                    padding: "12px",
                    textAlign: "center",
                    fontWeight: "600",
                    color: "#374151",
                  }}
                >
                  Count
                </th>
                <th
                  style={{
                    padding: "12px",
                    textAlign: "center",
                    fontWeight: "600",
                    color: "#374151",
                  }}
                >
                  Percentage
                </th>
                <th
                  style={{
                    padding: "12px",
                    textAlign: "left",
                    fontWeight: "600",
                    color: "#374151",
                  }}
                >
                  Visual
                </th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <td style={{ padding: "12px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "12px",
                      height: "12px",
                      backgroundColor: BED_STATUS_COLORS.Available,
                      borderRadius: "50%",
                      marginRight: "8px",
                    }}
                  ></span>
                  Available
                </td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "center",
                    fontWeight: "600",
                  }}
                >
                  {stats.available}
                </td>
                <td style={{ padding: "12px", textAlign: "center" }}>
                  {stats.total > 0
                    ? ((stats.available / stats.total) * 100).toFixed(1)
                    : 0}
                  %
                </td>
                <td style={{ padding: "12px" }}>
                  <ProgressBar
                    value={
                      stats.total > 0
                        ? (stats.available / stats.total) * 100
                        : 0
                    }
                    showValue={false}
                    color={BED_STATUS_COLORS.Available}
                    style={{ height: "8px" }}
                  />
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <td style={{ padding: "12px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "12px",
                      height: "12px",
                      backgroundColor: BED_STATUS_COLORS.Occupied,
                      borderRadius: "50%",
                      marginRight: "8px",
                    }}
                  ></span>
                  Occupied
                </td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "center",
                    fontWeight: "600",
                  }}
                >
                  {stats.occupied}
                </td>
                <td style={{ padding: "12px", textAlign: "center" }}>
                  {stats.total > 0
                    ? ((stats.occupied / stats.total) * 100).toFixed(1)
                    : 0}
                  %
                </td>
                <td style={{ padding: "12px" }}>
                  <ProgressBar
                    value={
                      stats.total > 0 ? (stats.occupied / stats.total) * 100 : 0
                    }
                    showValue={false}
                    color={BED_STATUS_COLORS.Occupied}
                    style={{ height: "8px" }}
                  />
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <td style={{ padding: "12px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "12px",
                      height: "12px",
                      backgroundColor: BED_STATUS_COLORS.Maintenance,
                      borderRadius: "50%",
                      marginRight: "8px",
                    }}
                  ></span>
                  Maintenance
                </td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "center",
                    fontWeight: "600",
                  }}
                >
                  {stats.maintenance}
                </td>
                <td style={{ padding: "12px", textAlign: "center" }}>
                  {stats.total > 0
                    ? ((stats.maintenance / stats.total) * 100).toFixed(1)
                    : 0}
                  %
                </td>
                <td style={{ padding: "12px" }}>
                  <ProgressBar
                    value={
                      stats.total > 0
                        ? (stats.maintenance / stats.total) * 100
                        : 0
                    }
                    showValue={false}
                    color={BED_STATUS_COLORS.Maintenance}
                    style={{ height: "8px" }}
                  />
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <td style={{ padding: "12px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "12px",
                      height: "12px",
                      backgroundColor: BED_STATUS_COLORS.Blocked,
                      borderRadius: "50%",
                      marginRight: "8px",
                    }}
                  ></span>
                  Blocked
                </td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "center",
                    fontWeight: "600",
                  }}
                >
                  {stats.blocked}
                </td>
                <td style={{ padding: "12px", textAlign: "center" }}>
                  {stats.total > 0
                    ? ((stats.blocked / stats.total) * 100).toFixed(1)
                    : 0}
                  %
                </td>
                <td style={{ padding: "12px" }}>
                  <ProgressBar
                    value={
                      stats.total > 0 ? (stats.blocked / stats.total) * 100 : 0
                    }
                    showValue={false}
                    color={BED_STATUS_COLORS.Blocked}
                    style={{ height: "8px" }}
                  />
                </td>
              </tr>
              <tr>
                <td style={{ padding: "12px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "12px",
                      height: "12px",
                      backgroundColor: BED_STATUS_COLORS.Reserved,
                      borderRadius: "50%",
                      marginRight: "8px",
                    }}
                  ></span>
                  Reserved
                </td>
                <td
                  style={{
                    padding: "12px",
                    textAlign: "center",
                    fontWeight: "600",
                  }}
                >
                  {stats.reserved}
                </td>
                <td style={{ padding: "12px", textAlign: "center" }}>
                  {stats.total > 0
                    ? ((stats.reserved / stats.total) * 100).toFixed(1)
                    : 0}
                  %
                </td>
                <td style={{ padding: "12px" }}>
                  <ProgressBar
                    value={
                      stats.total > 0 ? (stats.reserved / stats.total) * 100 : 0
                    }
                    showValue={false}
                    color={BED_STATUS_COLORS.Reserved}
                    style={{ height: "8px" }}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default BedStats;
