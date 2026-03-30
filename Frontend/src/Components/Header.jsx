import React from "react";
import logo from "../assets/BIMSLOGO.png"; // apna logo ka path yahan import karo

export default function Header({ toggleSidebar }) {
  return (
    <div className="d-flex justify-content-between align-items-center  btn-custom text-white px-3 py-3 shadow fixed-top">
      {/* Left Section: Sidebar Toggle + Logo */}
      <div className="d-flex align-items-center">
        {/* Sidebar Toggle Button */}
        {/* <button
          onClick={toggleSidebar}
          className="btn btn-outline-light btn-sm me-2"
        >
          ☰
        </button> */}

        {/* Logo */}
        <img
          src={logo}
          alt="Logo"
          className="img-fluid me-2"
          style={{ width: "40px", height: "40px", borderRadius: "50%" }}
        />
      </div>

      {/* Hospital Name */}
      <h1 className="h5 text-center mb-0 fw-bold flex-grow-1">
        Spherehealth Medical Solutions
      </h1>

      {/* Doctor Name */}
      <span className="fw-semibold small">Dr. Sandeep</span>
    </div>
  );
}
