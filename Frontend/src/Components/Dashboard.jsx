import React, { useState } from "react";
import Sidebar from "./Sidebar";
import Registration from "./Registration";

export default function Dashboard() {
  const [isOpen, setIsOpen] = useState(true);

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="dashboard">
      <Sidebar isOpen={isOpen} toggleSidebar={toggleSidebar} />

      <div className="main-content">
        <div className="topbar">
          <button className="btn btn-primary" onClick={toggleSidebar}>
            ☰
          </button>
          <h1 className="ms-3">Hospital Dashboard</h1>
        </div>

        <div className="content-area">
          <Registration />
        </div>
      </div>
    </div>
  );
}
