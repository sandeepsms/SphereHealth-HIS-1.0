import React, { useState, useEffect } from "react";
import { Card } from "primereact/card";
import { Chart } from "primereact/chart";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { useNavigate } from "react-router-dom";
import { admissionService } from "../../Services/admissionService";
import opdService from "../../Services/patient/opdService";
import patientService from "../../Services/patient/patientService";

const Dashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    admissions: { total: 0, active: 0 },
    opd: { today: 0 },
    emergency: { active: 0 },
  });
  const [todayAdmissions, setTodayAdmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const [admissionStats, todayAdmissionsRes, opdToday, patientStats] =
        await Promise.all([
          admissionService.getAdmissionStats(),
          admissionService.getTodayAdmissions(),
          opdService.getTodayVisits(),
          patientService.getPatientStats(),
        ]);

      setStats({
        admissions: admissionStats.data.data,
        opd: { today: opdToday.data.data?.length || 0 },
        emergency: {
          active: patientStats.data.data?.totalEmergencyVisits || 0,
        },
      });

      setTodayAdmissions(todayAdmissionsRes.data.data || []);
    } catch (error) {
      console.error("Error loading dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: "Total Admissions",
      value: stats.admissions.total,
      icon: "pi-building",
      color: "#3b82f6",
      route: "/admissions",
    },
    {
      title: "Active Admissions",
      value: stats.admissions.active,
      icon: "pi-users",
      color: "#10b981",
      route: "/admissions?status=Active",
    },
    {
      title: "Today's OPD",
      value: stats.opd.today,
      icon: "pi-clipboard",
      color: "#f59e0b",
      route: "/opd",
    },
    {
      title: "Active Emergencies",
      value: stats.emergency.active,
      icon: "pi-exclamation-triangle",
      color: "#ef4444",
      route: "/emergency/active",
    },
  ];

  return (
    <div style={{ marginTop: "20px" }}>
      <div className="flex justify-content-between align-items-center mb-4">
        <h1 style={{ margin: 0, fontSize: "24px", fontWeight: "700" }}>
          Dashboard
        </h1>
        <div style={{ color: "#6c757d", fontSize: "14px" }}>
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </div>
      </div>

      <div className="grid">
        {statCards.map((card, index) => (
          <div key={index} className="col-12 md:col-6 lg:col-3">
            <Card
              className="shadow-2 cursor-pointer hover:shadow-4 transition-duration-200"
              onClick={() => navigate(card.route)}
              style={{ borderLeft: `4px solid ${card.color}` }}
            >
              <div className="flex justify-content-between align-items-center">
                <div>
                  <div
                    style={{
                      fontSize: "14px",
                      color: "#6c757d",
                      marginBottom: "8px",
                    }}
                  >
                    {card.title}
                  </div>
                  <div
                    style={{
                      fontSize: "32px",
                      fontWeight: "700",
                      color: card.color,
                    }}
                  >
                    {card.value}
                  </div>
                </div>
                <div
                  style={{
                    width: "60px",
                    height: "60px",
                    borderRadius: "50%",
                    background: `${card.color}20`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <i
                    className={`pi ${card.icon}`}
                    style={{ fontSize: "24px", color: card.color }}
                  ></i>
                </div>
              </div>
            </Card>
          </div>
        ))}
      </div>

      <div className="grid mt-4">
        <div className="col-12">
          <Card title="Today's Admissions" className="shadow-2">
            <DataTable
              value={todayAdmissions}
              paginator
              rows={5}
              loading={loading}
              emptyMessage="No admissions today"
            >
              <Column field="UHID" header="UHID" />
              <Column field="patientName" header="Patient Name" />
              <Column field="contactNumber" header="Contact" />
              <Column field="bedNumber" header="Bed" />
              <Column
                field="status"
                header="Status"
                body={(row) => (
                  <Tag
                    value={row.status}
                    severity={row.status === "Active" ? "success" : "info"}
                  />
                )}
              />
              <Column
                field="admissionDate"
                header="Admission Date"
                body={(row) => new Date(row.admissionDate).toLocaleString()}
              />
            </DataTable>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
