import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Menubar } from "primereact/menubar";
import { Sidebar } from "primereact/sidebar";
import { Button } from "primereact/button";

const Layout = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarVisible, setSidebarVisible] = useState(false);

  const menuItems = [
    {
      label: "Dashboard",
      icon: "pi pi-home",
      command: () => navigate("/"),
    },
    {
      label: "Patients",
      icon: "pi pi-users",
      items: [
        {
          label: "All Patients",
          icon: "pi pi-list",
          command: () => navigate("/patients"),
        },
        {
          label: "Register New",
          icon: "pi pi-user-plus",
          command: () => navigate("/patients/new"),
        },
      ],
    },
    {
      label: "OPD",
      icon: "pi pi-clipboard",
      items: [
        {
          label: "All Visits",
          icon: "pi pi-list",
          command: () => navigate("/opd"),
        },
        {
          label: "New Visit",
          icon: "pi pi-plus",
          command: () => navigate("/opd/new"),
        },
      ],
    },
    {
      label: "Emergency",
      icon: "pi pi-exclamation-triangle",
      items: [
        {
          label: "All Cases",
          icon: "pi pi-list",
          command: () => navigate("/emergency"),
        },
        {
          label: "New Case",
          icon: "pi pi-plus",
          command: () => navigate("/emergency/new"),
        },
      ],
    },
    {
      label: "Admissions",
      icon: "pi pi-building",
      items: [
        {
          label: "All Admissions",
          icon: "pi pi-list",
          command: () => navigate("/admissions"),
        },
        {
          label: "New Admission",
          icon: "pi pi-plus",
          command: () => navigate("/admissions/new"),
        },
        {
          label: "Bed Layout",
          icon: "pi pi-table",
          command: () => navigate("/admissions/bed-layout"),
        },
      ],
    },
  ];

  const start = (
    <div className="flex align-items-center gap-2">
      <i
        className="pi pi-heart-fill"
        style={{ fontSize: "1.5rem", color: "#dc3558" }}
      ></i>
      <span style={{ fontWeight: "700", fontSize: "1.2rem" }}>HMS</span>
    </div>
  );

  const end = (
    <div className="flex align-items-center gap-2">
      <Button icon="pi pi-bell" rounded text />
      <Button icon="pi pi-user" rounded text />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f8f9fa" }}>
      <Menubar
        model={menuItems}
        start={start}
        end={end}
        style={{
          borderRadius: 0,
          borderLeft: "none",
          borderRight: "none",
          borderTop: "none",
        }}
      />

      <div style={{ padding: "20px" }}>{children}</div>
    </div>
  );
};

export default Layout;
