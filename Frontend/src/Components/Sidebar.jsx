import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Sidebar as PrimeSidebar } from "primereact/sidebar";
import { PanelMenu } from "primereact/panelmenu";
import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";

export default function Sidebar({ isOpen, toggleSidebar }) {
  const navigate = useNavigate();
  const location = useLocation();

  const menuModel = [
    {
      label: "Patient Management",
      icon: "pi pi-users",
      items: [
        {
          label: "Registration",
          icon: "pi pi-user-plus",
          command: () => {
            navigate("/registration");
            toggleSidebar();
          },
        },
        {
          label: "Find Patient",
          icon: "pi pi-search",
          command: () => {
            navigate("/allpatient");
            toggleSidebar();
          },
        },
      ],
    },

    {
      label: "Billing",
      icon: "pi pi-money-bill",
      items: [
        {
          label: "Bills List",
          icon: "pi pi-list",
          command: () => {
            navigate("/billing");
            toggleSidebar();
          },
        },
        {
          label: "Generate Bill",
          icon: "pi pi-file-plus",
          command: () => {
            navigate("/billing/create");
            toggleSidebar();
          },
        },
      ],
    },

    {
      label: "Patient Billing",
      icon: "pi pi-receipt",
      items: [
        {
          label: "Patient Bill",
          icon: "pi pi-user",
          command: () => {
            navigate("/patient-billing");
            toggleSidebar();
          },
        },
        {
          label: "Service Master",
          icon: "pi pi-cog",
          command: () => {
            navigate("/service-master");
            toggleSidebar();
          },
        },
      ],
    },

    // ══════════════════════════════════════════════════════════════════════
    // DEPARTMENT MANAGEMENT (NEW — ALAG SECTION)
    // ══════════════════════════════════════════════════════════════════════
    {
      label: "Department",
      icon: "pi pi-sitemap",
      items: [
        {
          label: "Manage Departments",
          icon: "pi pi-list",
          command: () => {
            navigate("/department");
            toggleSidebar();
          },
        },
      ],
    },

    {
      label: "Master Data",
      icon: "pi pi-database",
      items: [
        {
          label: "Buildings",
          icon: "pi pi-building",
          command: () => {
            navigate("/buildings");
            toggleSidebar();
          },
        },
        {
          label: "Floors",
          icon: "pi pi-arrows-v",
          command: () => {
            navigate("/floors");
            toggleSidebar();
          },
        },
        {
          label: "Wards",
          icon: "pi pi-home",
          command: () => {
            navigate("/wards");
            toggleSidebar();
          },
        },
        {
          label: "Rooms",
          icon: "pi pi-box",
          command: () => {
            navigate("/rooms");
            toggleSidebar();
          },
        },
        {
          label: "Room Category",
          icon: "pi pi-th-large",
          command: () => {
            navigate("/roomcategory");
            toggleSidebar();
          },
        },
      ],
    },

    {
      label: "Bed Management",
      icon: "pi pi-table",
      items: [
        {
          label: "Manage Beds",
          icon: "pi pi-list",
          command: () => {
            navigate("/beds");
            toggleSidebar();
          },
        },
        {
          label: "Bed Visual Layout",
          icon: "pi pi-eye",
          command: () => {
            navigate("/bed-visual");
            toggleSidebar();
          },
        },
      ],
    },

    {
      label: "Doctor Management",
      icon: "pi pi-user-edit",
      items: [
        {
          label: "Create Doctor",
          icon: "pi pi-user-plus",
          command: () => {
            navigate("/doctors");
            toggleSidebar();
          },
        },
      ],
    },

    {
      label: "TPA Services",
      icon: "pi pi-briefcase",
      items: [
        {
          label: "Add Service",
          icon: "pi pi-plus-circle",
          command: () => {
            navigate("/addservice");
            toggleSidebar();
          },
        },
        {
          label: "Add TPA",
          icon: "pi pi-building",
          command: () => {
            navigate("/addtpa");
            toggleSidebar();
          },
        },
      ],
    },

    {
      label: "Hospital Charges",
      icon: "pi pi-dollar",
      items: [
        {
          label: "Charges List",
          icon: "pi pi-list",
          command: () => {
            navigate("/hospital-charges");
            toggleSidebar();
          },
        },
        {
          label: "Create Charges",
          icon: "pi pi-plus",
          command: () => {
            navigate("/hospital-charges/create");
            toggleSidebar();
          },
        },
      ],
    },
  ];

  return (
    <PrimeSidebar
      visible={isOpen}
      onHide={toggleSidebar}
      position="left"
      style={{ width: "280px" }}
      className="modern-sidebar"
    >
      {/* ═══ Header ═══ */}
      <div
        style={{
          padding: "25px 20px",
          background: "linear-gradient(135deg, #0891b2 0%, #0e7490 100%)",
          marginBottom: "15px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        }}
      >
        <h3
          style={{
            margin: 0,
            color: "white",
            fontSize: "22px",
            fontWeight: "700",
            letterSpacing: "0.5px",
          }}
        >
          HMS Menu
        </h3>
        <p
          style={{
            margin: "8px 0 0 0",
            fontSize: "13px",
            color: "rgba(255,255,255,0.9)",
            fontWeight: "500",
          }}
        >
          Spherehealth Medical
        </p>
      </div>

      {/* ═══ Menu ═══ */}
      <div style={{ padding: "0 10px", paddingBottom: "80px" }}>
        <PanelMenu
          model={menuModel}
          style={{ width: "100%", border: "none" }}
        />
      </div>

      {/* ═══ Footer ═══ */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "20px",
          background: "linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)",
          textAlign: "center",
          boxShadow: "0 -2px 8px rgba(0,0,0,0.05)",
        }}
      >
        <div
          style={{
            fontSize: "15px",
            fontWeight: "700",
            color: "#0891b2",
            marginBottom: "5px",
          }}
        >
          Dr. Sandeep
        </div>
        <div style={{ fontSize: "12px", color: "#6c757d" }}>Version 1.0.0</div>
      </div>

      {/* ═══ Custom Styles ═══ */}
      <style>{`
        .modern-sidebar .p-sidebar-content { padding: 0 !important; background: #ffffff !important; }
        .modern-sidebar .p-panelmenu { border: none !important; background: transparent !important; }
        .modern-sidebar .p-panelmenu-panel { margin-bottom: 4px !important; border: none !important; }
        .modern-sidebar .p-panelmenu-header-link {
          background-color: transparent !important; border: none !important;
          color: #374151 !important; padding: 14px 15px !important;
          border-radius: 10px !important; font-weight: 600 !important;
          font-size: 15px !important; transition: all 0.3s ease !important;
          text-decoration: none !important; box-shadow: none !important;
        }
        .modern-sidebar .p-panelmenu-header-link:hover {
          background-color: #f0f9ff !important; color: #0891b2 !important; transform: translateX(3px);
        }
        .modern-sidebar .p-panelmenu-header-link:focus { box-shadow: none !important; outline: none !important; }
        .modern-sidebar .p-panelmenu-header-link.p-highlight {
          background: linear-gradient(135deg, #0891b2 0%, #0e7490 100%) !important;
          color: white !important; box-shadow: 0 2px 8px rgba(8, 145, 178, 0.3) !important;
        }
        .modern-sidebar .p-panelmenu-header-link.p-highlight .p-menuitem-icon { color: white !important; }
        .modern-sidebar .p-panelmenu-content {
          background-color: #f8f9fa !important; border: none !important;
          border-radius: 10px !important; padding: 8px 5px !important; margin-top: 5px !important;
        }
        .modern-sidebar .p-menuitem-link {
          color: #4b5563 !important; padding: 11px 15px 11px 40px !important;
          border-radius: 8px !important; margin: 2px 8px !important;
          font-size: 14px !important; font-weight: 500 !important;
          transition: all 0.25s ease !important; text-decoration: none !important;
          border: none !important; box-shadow: none !important;
        }
        .modern-sidebar .p-menuitem-link:hover {
          background-color: #e0f2fe !important; color: #0891b2 !important; transform: translateX(3px);
        }
        .modern-sidebar .p-menuitem-link:focus { box-shadow: none !important; outline: none !important; }
        .modern-sidebar .p-menuitem-link.p-menuitem-link-active {
          background: linear-gradient(135deg, #0891b2 0%, #0e7490 100%) !important;
          color: white !important; box-shadow: 0 2px 6px rgba(8, 145, 178, 0.25) !important;
        }
        .modern-sidebar .p-menuitem-link.p-menuitem-link-active .p-menuitem-icon { color: white !important; }
        .modern-sidebar .p-menuitem-icon {
          margin-right: 12px !important; font-size: 16px !important;
          color: #0891b2 !important; transition: all 0.3s ease !important;
        }
        .modern-sidebar .p-panelmenu-header-link .p-menuitem-icon { color: #0891b2 !important; font-size: 18px !important; }
        .modern-sidebar .p-panelmenu-header-link:hover .p-menuitem-icon { color: #0891b2 !important; transform: scale(1.1); }
        .modern-sidebar * { outline: none !important; }
        .modern-sidebar .p-panelmenu-content { animation: slideDown 0.3s ease-out; }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        .modern-sidebar a, .modern-sidebar button,
        .modern-sidebar .p-menuitem-link, .modern-sidebar .p-panelmenu-header-link { text-decoration: none !important; }
      `}</style>
    </PrimeSidebar>
  );
}
