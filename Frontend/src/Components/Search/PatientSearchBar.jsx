// src/components/Search/PatientSearchBar.jsx
// ✅ Reusable Patient Search Component
// Kisi bhi page pe use karo - Registration, Dashboard, OPD, etc.

import React, { useState, useRef, useEffect } from "react";
import { InputText } from "primereact/inputtext";
import { ProgressSpinner } from "primereact/progressspinner";
import { Tag } from "primereact/tag";
import usePatientSearch from "../../hooks/usePatientSearch";
import "../../../src/App.css"
/**
 * PatientSearchBar
 *
 * Props:
 * @param {function} onPatientSelect - Patient select hone pe callback: (patientData) => void
 * @param {string} placeholder - Input placeholder
 * @param {boolean} disabled - Disable input
 * @param {string} className - Extra CSS class
 *
 * Usage in Registration form:
 *   <PatientSearchBar onPatientSelect={(p) => fillFormWithPatient(p)} />
 *
 * Usage in PatientsTable header:
 *   <PatientSearchBar onPatientSelect={(p) => navigate(`/registration/${p._id}`)} />
 */
const PatientSearchBar = ({
  onPatientSelect,
  placeholder = "Search by Name, UHID, Phone...",
  disabled = false,
  className = "",
}) => {
  const { searchTerm, setSearchTerm, results, loading, error, clearSearch } =
    usePatientSearch(400, 2, 10);

  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef(null);

  // Dropdown results aane pe show karo
  useEffect(() => {
    setShowDropdown(results.length > 0 || (searchTerm.length >= 2 && !loading));
  }, [results, searchTerm, loading]);

  // Outside click pe dropdown band karo
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (patient) => {
    onPatientSelect && onPatientSelect(patient);
    setShowDropdown(false);
    clearSearch();
  };

  const formatDOB = (dob) => {
    if (!dob) return "";
    const d = new Date(dob);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  };

  const getGenderSeverity = (gender) =>
    ({ Male: "info", Female: "danger", Other: "warning" })[gender] ||
    "secondary";

  return (
    <div
      ref={wrapperRef}
      className={`patient-search-wrapper ${className}`}
      style={{ position: "relative", minWidth: "320px" }}
    >
      {/* Search Input */}
      <span className="p-input-icon-left p-input-icon-right w-full">
        {/* <i className="pi pi-search" style={{ zIndex: 1 }} /> */}
        <InputText
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
          style={{
            width: "100%",  
            paddingLeft: "2.5rem",
            paddingRight: loading ? "2.5rem" : "1rem",
            borderRadius: "8px",
          }}
          autoComplete="off"
        />
        {loading && (
          <i className="pi pi-spin pi-spinner" style={{ right: "0.75rem" }} />
        )}
        {searchTerm && !loading && (
          <i
            className="pi pi-times"
            style={{ right: "0.75rem", cursor: "pointer", color: "#999" }}
            onClick={clearSearch}
          />
        )}
      </span>

      {/* Dropdown Results */}
      {showDropdown && (
        <div className="div-dropdown"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "#fff",
            border: "1px solid #dee2e6",
            borderRadius: "8px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            // zIndex: 9999 ,
            maxHeight: "360px",
            overflowY: "hidden",
          }}
        >
          {/* Loading State */}
          {loading && (
            <div
              style={{
                padding: "16px",
                textAlign: "center",
                color: "#6c757d",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              <i className="pi pi-spin pi-spinner" />
              <span>Searching...</span>
            </div>
          )}

          {/* Error State */}
          {error && !loading && (
            <div
              style={{
                padding: "12px 16px",
                color: "#dc3545",
                fontSize: "13px",
              }}
            >
              <i className="pi pi-exclamation-triangle mr-2" />
              {error}
            </div>
          )}

          {/* No Results */}
          {!loading &&
            !error &&
            results.length === 0 &&
            searchTerm.length >= 2 && (
              <div
                style={{
                  padding: "16px",
                  textAlign: "center",
                  color: "#6c757d",
                  fontSize: "13px",
                }}
              >
                <i className="pi pi-search mr-2" />
                No patients found for "{searchTerm}"
              </div>
            )}

          {/* Results List */}
          {!loading &&
            results.map((patient, idx) => (
              <div
                key={patient._id || idx}
                onClick={() => handleSelect(patient)}
                style={{
                  padding: "10px 16px",
                  cursor: "pointer",
                  borderBottom:
                    idx < results.length - 1 ? "1px solid #f0f0f0" : "none",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#f8f9fa")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "#fff")
                }
              >
                {/* Row 1: Name + UHID */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "4px",
                  }}
                >
                  <span
                    style={{
                      fontWeight: "600",
                      fontSize: "14px",
                      color: "#212529",
                    }}
                  >
                    <i
                      className="pi pi-user mr-2"
                      style={{ color: "#0d6efd" }}
                    />
                    {patient.fullName}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      background: "#e7f3ff",
                      color: "#0d6efd",
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontWeight: "600",
                    }}
                  >
                    {patient.UHID}
                  </span>
                </div>

                {/* Row 2: Phone + Gender + DOB */}
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    alignItems: "center",
                    fontSize: "12px",
                    color: "#6c757d",
                  }}
                >
                  <span>
                    <i className="pi pi-phone mr-1" />
                    {patient.contactNumber}
                  </span>
                  {patient.gender && (
                    <Tag
                      value={patient.gender}
                      severity={getGenderSeverity(patient.gender)}
                      style={{ fontSize: "10px", padding: "1px 6px" }}
                    />
                  )}
                  {patient.dateOfBirth && (
                    <span>
                      <i className="pi pi-calendar mr-1" />
                      {formatDOB(patient.dateOfBirth)}
                    </span>
                  )}
                  {patient.department?.departmentName && (
                    <span>
                      <i className="pi pi-building mr-1" />
                      {patient.department.departmentName}
                    </span>
                  )}
                </div>
              </div>
            ))}

          {/* Results count footer */}
          {!loading && results.length > 0 && (
            <div
              style={{
                padding: "6px 16px",
                fontSize: "11px",
                color: "#999",
                borderTop: "1px solid #f0f0f0",
                background: "#fafafa",
                borderRadius: "0 0 8px 8px",
              }}
            >
              {results.length} result{results.length !== 1 ? "s" : ""} found
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PatientSearchBar;
